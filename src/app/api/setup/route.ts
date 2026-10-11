import { db, databaseTarget } from "@/db";
import { ensureSchema } from "@/db/migrate";
import {
  documentReminders,
  garbageSchedules,
  timetable,
  workLogs,
} from "@/db/schema";
import {
  getConfig,
  getPublicConfig,
  parseFamilyMembers,
  setConfigValues,
} from "@/lib/dashboard-data";
import { FRACTION_KEYS, importGarbageCalendar, previewGarbageCalendar } from "@/lib/ics";
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

async function setupState() {
  await ensureSchema();
  const config = await getConfig();
  return {
    completed: config.setup_completed === "true",
    databaseTarget,
    config: getPublicConfig(config),
    family: parseFamilyMembers(config.family_members),
    hasPin: Boolean(process.env.ADMIN_PIN) || /^\d{4,8}$/.test(config.admin_pin || ""),
  };
}

export async function GET() {
  try {
    return Response.json(await setupState(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Setup status failed", error);
    return Response.json({ error: "Nie udało się odczytać stanu konfiguracji." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as Record<string, unknown>;
    const action = text(body.action, 40);
    const state = await setupState();

    // Once the wizard is finished only the admin panel (PIN protected) may write.
    if (state.completed && action !== "status") {
      return Response.json(
        { error: "Konfiguracja jest już zakończona. Zmiany wprowadzisz w panelu administratora." },
        { status: 403 },
      );
    }

    if (action === "status") return Response.json(state);

    if (action === "profile") {
      const city = text(body.home_city, 80);
      const latitude = Number(body.city_lat);
      const longitude = Number(body.city_lon);
      const wakeWord = text(body.wake_word, 48);
      const ttsVoice = text(body.tts_voice, 40);
      if (!city) return bad("Podaj miejscowość, w której jest dom.");
      if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) return bad("Nieprawidłowa szerokość geograficzna.");
      if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) return bad("Nieprawidłowa długość geograficzna.");
      if (!wakeWord) return bad("Podaj słowo wybudzające asystenta.");

      // 0/0 oznacza, że kreator nie ustalił lokalizacji — wtedy pobieramy
      // współrzędne z nazwy miejscowości, żeby widget pogody nie pokazywał
      // danych dla Zatoki Gwinei.
      let resolvedLat = latitude;
      let resolvedLon = longitude;
      if (latitude === 0 && longitude === 0) {
        const geocoded = await geocodeCity(city);
        if (!geocoded) {
          return bad(
            `Nie udało się ustalić współrzędnych dla „${city}”. Podaj je ręcznie albo popraw nazwę miejscowości.`,
          );
        }
        resolvedLat = geocoded.latitude;
        resolvedLon = geocoded.longitude;
      }

      await setConfigValues({
        home_city: city,
        city_lat: String(resolvedLat),
        city_lon: String(resolvedLon),
        wake_word: wakeWord,
        tts_voice: voices.has(ttsVoice) ? ttsVoice : "pl-PL-ZofiaNeural",
      });
      return Response.json(await setupState());
    }

    if (action === "family") {
      const raw = Array.isArray(body.members) ? body.members : [];
      const members = raw
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          name: text(item.name, 48),
          role: item.role === "child" ? "child" : "parent",
        }))
        .filter((item) => item.name.length > 0)
        .slice(0, 12);
      if (members.length === 0) return bad("Dodaj przynajmniej jednego domownika.");
      await setConfigValues({ family_members: JSON.stringify(members) });
      return Response.json(await setupState());
    }

    if (action === "lesson-add") {
      const childName = text(body.childName, 48);
      const subject = text(body.subject, 80);
      const startTime = text(body.startTime, 5);
      const endTime = text(body.endTime, 5);
      const dayOfWeek = Number(body.dayOfWeek);
      if (!childName) return bad("Wybierz dziecko.");
      if (!subject) return bad("Podaj nazwę przedmiotu.");
      if (!timePattern.test(startTime) || !timePattern.test(endTime)) return bad("Uzupełnij godziny lekcji (HH:MM).");
      if (minutesOf(endTime) <= minutesOf(startTime)) return bad("Koniec lekcji musi być późniejszy niż początek.");
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 5) return bad("Wybierz dzień tygodnia (poniedziałek–piątek).");
      const [lesson] = await db
        .insert(timetable)
        .values({ childName, subject, startTime, endTime, dayOfWeek, classroom: text(body.classroom, 30) || null })
        .returning();
      return Response.json({ ok: true, item: lesson });
    }

    if (action === "lesson-delete") {
      if (typeof body.id !== "string") return bad("Brak identyfikatora lekcji.");
      await db.delete(timetable).where(eq(timetable.id, body.id)).run();
      return Response.json({ ok: true });
    }

    if (action === "waste-add") {
      const fraction = text(body.fraction, 24);
      const date = dateValue(body.pickupDate);
      if (!(FRACTION_KEYS as readonly string[]).includes(fraction)) return bad("Wybierz frakcję odpadów.");
      if (!date) return bad("Podaj prawidłową datę odbioru.");
      const [item] = await db
        .insert(garbageSchedules)
        .values({ fraction, pickupDate: atNoon(date) })
        .returning();
      return Response.json({ ok: true, item });
    }

    if (action === "waste-delete") {
      if (typeof body.id !== "string") return bad("Brak identyfikatora terminu.");
      await db.delete(garbageSchedules).where(eq(garbageSchedules.id, body.id)).run();
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

    if (action === "ics-detect") {
      const content = text(body.content, 1_500_000);
      try {
        const preview = await previewGarbageCalendar(content);
        return Response.json({ ok: true, ...preview });
      } catch (error) {
        return bad(error instanceof Error ? error.message : "Nie udało się odczytać pliku ICS.");
      }
    }

    if (action === "document-add") {
      const title = text(body.title, 100);
      const date = dateValue(body.expirationDate);
      if (!title) return bad("Podaj nazwę dokumentu.");
      if (!date) return bad("Podaj prawidłową datę ważności.");
      const [item] = await db
        .insert(documentReminders)
        .values({ title, expirationDate: atNoon(date), category: text(body.category, 36) || "DOKUMENT" })
        .returning();
      return Response.json({ ok: true, item });
    }

    if (action === "document-delete") {
      if (typeof body.id !== "string") return bad("Brak identyfikatora dokumentu.");
      await db.delete(documentReminders).where(eq(documentReminders.id, body.id)).run();
      return Response.json({ ok: true });
    }

    if (action === "worklog-add") {
      const hours = Number(body.hours);
      const date = dateValue(body.date);
      const startTime = text(body.startTime, 5);
      const endTime = text(body.endTime, 5);
      let value = hours;
      if ((!Number.isFinite(value) || value <= 0) && timePattern.test(startTime) && timePattern.test(endTime)) {
        value = (minutesOf(endTime) - minutesOf(startTime)) / 60;
      }
      if (!Number.isFinite(value) || value <= 0 || value > 24) return bad("Podaj liczbę godzin (0,25–24) lub poprawny przedział czasowy.");
      if (!date) return bad("Podaj prawidłową datę wpisu.");
      const [item] = await db
        .insert(workLogs)
        .values({
          hours: Math.round(value * 100) / 100,
          date,
          startTime: timePattern.test(startTime) ? startTime : null,
          endTime: timePattern.test(endTime) ? endTime : null,
          note: text(body.note, 180) || null,
        })
        .returning();
      return Response.json({ ok: true, item });
    }

    if (action === "pin") {
      if (process.env.ADMIN_PIN) {
        return Response.json({ error: "PIN jest już zarządzany przez zmienną środowiskową ADMIN_PIN." }, { status: 409 });
      }
      const nextPin = text(body.admin_pin, 8);
      if (!/^\d{4,8}$/.test(nextPin)) return bad("PIN musi mieć od 4 do 8 cyfr.");
      await setConfigValues({ admin_pin: nextPin });
      return Response.json({ ok: true });
    }

    if (action === "finish") {
      const config = await getConfig();
      if (!config.home_city) return bad("Najpierw uzupełnij krok „Dom i lokalizacja”.");
      if (!parseFamilyMembers(config.family_members).length) return bad("Dodaj przynajmniej jednego domownika.");
      if (!process.env.ADMIN_PIN && !/^\d{4,8}$/.test(config.admin_pin || "")) {
        return bad("Ustaw PIN administratora (4–8 cyfr), aby zabezpieczyć panel.");
      }
      await setConfigValues({ setup_completed: "true" });
      return Response.json(await setupState());
    }

    if (action === "reset") {
      await setConfigValues({ setup_completed: "false" });
      return Response.json(await setupState());
    }

    return bad("Nieznany krok konfiguracji.");
  } catch (error) {
    console.error("Setup request failed", error);
    return Response.json({ error: "Wystąpił błąd podczas konfiguracji." }, { status: 500 });
  }
}

function minutesOf(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}
