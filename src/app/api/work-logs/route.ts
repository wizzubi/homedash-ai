import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { workLogs } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

function parseClock(value: unknown) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return value;
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as {
      hours?: unknown;
      startTime?: unknown;
      endTime?: unknown;
      note?: unknown;
      date?: unknown;
    };
    const startTime = parseClock(body.startTime);
    const endTime = parseClock(body.endTime);
    let hours = typeof body.hours === "number" ? body.hours : Number(body.hours);

    if ((!Number.isFinite(hours) || hours <= 0) && startTime && endTime) {
      const [startHour, startMinute] = startTime.split(":").map(Number);
      const [endHour, endMinute] = endTime.split(":").map(Number);
      hours = (endHour * 60 + endMinute - startHour * 60 - startMinute) / 60;
    }

    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      return Response.json({ error: "Wpisz poprawną liczbę godzin (maksymalnie 24)." }, { status: 400 });
    }

    const date = typeof body.date === "string" && body.date ? new Date(body.date) : new Date();
    if (Number.isNaN(date.getTime())) return Response.json({ error: "Nieprawidłowa data wpisu." }, { status: 400 });

    const [entry] = await db
      .insert(workLogs)
      .values({
        hours: Math.round(hours * 100) / 100,
        date,
        startTime,
        endTime,
        note: typeof body.note === "string" ? body.note.trim().slice(0, 180) || null : null,
      })
      .returning();
    return Response.json(entry, { status: 201 });
  } catch (error) {
    console.error("Work log create failed", error);
    return Response.json({ error: "Nie udało się zapisać godzin." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as { id?: unknown };
    if (typeof body.id !== "string") return Response.json({ error: "Brak identyfikatora wpisu." }, { status: 400 });
    await db.delete(workLogs).where(eq(workLogs.id, body.id)).run();
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Work log delete failed", error);
    return Response.json({ error: "Nie udało się usunąć wpisu." }, { status: 500 });
  }
}
