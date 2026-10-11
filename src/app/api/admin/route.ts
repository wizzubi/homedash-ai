import { db, databaseTarget } from "@/db";
import { ensureSchema } from "@/db/migrate";
import {
  documentReminders,
  garbageSchedules,
  timetable,
  workLogs,
} from "@/db/schema";
import {
  getAdminPin,
  getDashboardData,
  parseFamilyMembers,
  setConfigValues,
} from "@/lib/dashboard-data";
import { FRACTION_KEYS, importGarbageCalendar } from "@/lib/ics";
import { geocodeCity } from "@/lib/location";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const voices = new Set(["pl-PL-ZofiaNeural", "pl-PL-MarekNeural"]);

function text(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function dateValue(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function atNoon(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

function bad(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

async function verifyAdminPin(pin: unknown) {
  if (typeof pin !== "string" || !pin) return false;
  await ensureSchema();
  const expected = await getAdminPin();
  if (!expected) return false;
  return pin === expected;
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as Record<string, unknown>;
    if (!(await verifyAdminPin(body.pin))) {
      return Response.json({ error: "Nieprawidłowy PIN administratora." }, { status: 401 });
    }
    const action = text(body.action, 40);

    if (action === "load") {
      const data = await getDashboardData();
      return Response.json({ ...data, family: parseFamilyMembers(data.config.family_members), databaseTarget });
    }

    if (action === "config-save") {
      const city = text(body.home_city, 80);
      const wakeWord = text(body.wake_word, 48);
      const latitude = Number(body.city_lat);
      const longitude = Number(body.city_lon);
      const ttsVoice = text(body.tts_voice, 40);
      if (!city || !wakeWord) return bad("Uzupełnij miejscowość i słowo wybudzające.");
      if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) return bad("Nieprawidłowa szerokość geograficzna.");
      if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) return bad("Nieprawidłowa długość geograficzna.");

      let resolvedLat = latitude;
      let resolvedLon = longitude;
      if (latitude === 0 && longitude === 0) {
        const geocoded = await geocodeCity(city);
        if (!geocoded) return bad(`Nie udało się ustalić współrzędnych dla „${city}”. Podaj je ręcznie.`);
        resolvedLat = geocoded.latitude;
        resolvedLon = geocoded.longitude;
      }

      await setConfigValues({
        home_city: city,
        wake_word: wakeWord,
        city_lat: String(resolvedLat),
        city_lon: String(resolvedLon),
        tts_voice: voices.has(ttsVoice) ? ttsVoice : "pl-PL-ZofiaNeural",
      });
      return Response.json({ ok: true });
    }

    if (action === "family-save") {
      const raw = Array.isArray(body.members) ? body.members : [];
      const members = raw
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({ name: text(item.name, 48), role: item.role === "child" ? "child" : "parent" }))
        .filter((item) => item.name.length > 0)
        .slice(0, 12);
      if (members.length === 0) return bad("Lista domowników nie może być pusta.");
      await setConfigValues({ family_members: JSON.stringify(members) });
      return Response.json({ ok: true });
    }

    if (action === "pin-change") {
      if (process.env.ADMIN_PIN) {
        return Response.json({ error: "PIN jest zarządzany przez zmienną środowiskową ADMIN_PIN." }, { status: 409 });
      }
      const nextPin = text(body.newPin, 8);
      if (!/^\d{4,8}$/.test(nextPin)) return bad("PIN musi mieć od 4 do 8 cyfr.");
      await setConfigValues({ admin_pin: nextPin });
      return Response.json({ ok: true });
    }

    if (action === "lesson-save") {
      const childName = text(body.childName, 48);
      const subject = text(body.subject, 80);
      const startTime = text(body.startTime, 5);
      const endTime = text(body.endTime, 5);
      const dayOfWeek = Number(body.dayOfWeek);
      if (!childName || !subject) return bad("Uzupełnij dziecko i przedmiot.");
      if (!timePattern.test(startTime) || !timePattern.test(endTime)) return bad("Podaj godziny w formacie HH:MM.");
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 5) return bad("Dzień tygodnia musi być w zakresie 1–5.");
      const values = { childName, subject, startTime, endTime, dayOfWeek, classroom: text(body.classroom, 30) || null };
      if (typeof body.id === "string" && body.id) {
        const [lesson] = await db.update(timetable).set(values).where(eq(timetable.id, body.id)).returning();
        if (!lesson) return Response.json({ error: "Nie znaleziono lekcji." }, { status: 404 });
        return Response.json({ ok: true, item: lesson });
      }
      const [lesson] = await db.insert(timetable).values(values).returning();
      return Response.json({ ok: true, item: lesson });
    }

    if (action === "lesson-delete") {
      if (typeof body.id !== "string") return bad("Brak identyfikatora lekcji.");
      await db.delete(timetable).where(eq(timetable.id, body.id)).run();
      return Response.json({ ok: true });
    }

    if (action === "waste-save") {
      const fraction = text(body.fraction, 24);
      const date = dateValue(body.pickupDate);
      if (!(FRACTION_KEYS as readonly string[]).includes(fraction)) return bad("Wybierz frakcję odpadów.");
      if (!date) return bad("Podaj prawidłową datę odbioru.");
      const pickupDate = atNoon(date);
      if (typeof body.id === "string" && body.id) {
        const [item] = await db.update(garbageSchedules).set({ fraction, pickupDate }).where(eq(garbageSchedules.id, body.id)).returning();
        if (!item) return Response.json({ error: "Nie znaleziono terminu." }, { status: 404 });
        return Response.json({ ok: true, item });
      }
      const [item] = await db.insert(garbageSchedules).values({ fraction, pickupDate }).returning();
      return Response.json({ ok: true, item });
    }

    if (action === "waste-delete") {
      if (typeof body.id !== "string") return bad("Brak identyfikatora terminu.");
      await db.delete(garbageSchedules).where(eq(garbageSchedules.id, body.id)).run();
      return Response.json({ ok: true });
    }

    if (action === "document-save") {
      const title = text(body.title, 100);
      const date = dateValue(body.expirationDate);
      if (!title) return bad("Podaj nazwę dokumentu.");
      if (!date) return bad("Podaj prawidłową datę ważności.");
      const values = { title, category: text(body.category, 36) || "DOKUMENT", expirationDate: atNoon(date) };
      if (typeof body.id === "string" && body.id) {
        const [item] = await db.update(documentReminders).set(values).where(eq(documentReminders.id, body.id)).returning();
        if (!item) return Response.json({ error: "Nie znaleziono dokumentu." }, { status: 404 });
        return Response.json({ ok: true, item });
      }
      const [item] = await db.insert(documentReminders).values(values).returning();
      return Response.json({ ok: true, item });
    }

    if (action === "document-delete") {
      if (typeof body.id !== "string") return bad("Brak identyfikatora dokumentu.");
      await db.delete(documentReminders).where(eq(documentReminders.id, body.id)).run();
      return Response.json({ ok: true });
    }

    if (action === "worklog-save") {
      const hours = Number(body.hours);
      const date = dateValue(body.date);
      const startTime = text(body.startTime, 5);
      const endTime = text(body.endTime, 5);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return bad("Podaj liczbę godzin (0,25–24).");
      if (!date) return bad("Podaj prawidłową datę wpisu.");
      const values = {
        hours: Math.round(hours * 100) / 100,
        date,
        startTime: timePattern.test(startTime) ? startTime : null,
        endTime: timePattern.test(endTime) ? endTime : null,
        note: text(body.note, 180) || null,
      };
      if (typeof body.id === "string" && body.id) {
        const [item] = await db.update(workLogs).set(values).where(eq(workLogs.id, body.id)).returning();
        if (!item) return Response.json({ error: "Nie znaleziono wpisu pracy." }, { status: 404 });
        return Response.json({ ok: true, item });
      }
      const [item] = await db.insert(workLogs).values(values).returning();
      return Response.json({ ok: true, item });
    }

    if (action === "worklog-delete") {
      if (typeof body.id !== "string") return bad("Brak identyfikatora wpisu pracy.");
      await db.delete(workLogs).where(eq(workLogs.id, body.id)).run();
      return Response.json({ ok: true });
    }

    if (action === "ics-import") {
      const content = text(body.content, 1_500_000);
      try {
        const result = await importGarbageCalendar(content);
        return Response.json({ ok: true, ...result });
      } catch (error) {
        return bad(error instanceof Error ? error.message : "Nie udało się odczytać pliku ICS.");
      }
    }

    if (action === "setup-reopen") {
      await setConfigValues({ setup_completed: "false" });
      return Response.json({ ok: true });
    }

    return bad("Nieznana operacja administratora.");
  } catch (error) {
    console.error("Admin request failed", error);
    return Response.json({ error: "Wystąpił błąd panelu administracyjnego." }, { status: 500 });
  }
}
