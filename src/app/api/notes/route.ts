import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { notes } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
const noteColors = new Set(["amber", "violet", "mint", "sky", "rose"]);

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as { title?: unknown; content?: unknown; color?: unknown };
    const content = typeof body.content === "string" ? body.content.trim().slice(0, 360) : "";
    if (!content) return Response.json({ error: "Notatka nie może być pusta." }, { status: 400 });
    const [note] = await db
      .insert(notes)
      .values({
        title: typeof body.title === "string" ? body.title.trim().slice(0, 80) || null : null,
        content,
        color: typeof body.color === "string" && noteColors.has(body.color) ? body.color : "amber",
        isPinned: true,
      })
      .returning();
    return Response.json(note, { status: 201 });
  } catch (error) {
    console.error("Note create failed", error);
    return Response.json({ error: "Nie udało się zapisać notatki." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as {
      id?: unknown;
      title?: unknown;
      content?: unknown;
      color?: unknown;
      isPinned?: unknown;
    };
    if (typeof body.id !== "string") return Response.json({ error: "Brak identyfikatora notatki." }, { status: 400 });
    const updates: Partial<typeof notes.$inferInsert> = {};
    if (typeof body.title === "string") updates.title = body.title.trim().slice(0, 80) || null;
    if (typeof body.content === "string" && body.content.trim()) updates.content = body.content.trim().slice(0, 360);
    if (typeof body.color === "string" && noteColors.has(body.color)) updates.color = body.color;
    if (typeof body.isPinned === "boolean") updates.isPinned = body.isPinned;
    const [note] = await db.update(notes).set(updates).where(eq(notes.id, body.id)).returning();
    if (!note) return Response.json({ error: "Nie znaleziono notatki." }, { status: 404 });
    return Response.json(note);
  } catch (error) {
    console.error("Note update failed", error);
    return Response.json({ error: "Nie udało się zmienić notatki." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as { id?: unknown };
    if (typeof body.id !== "string") return Response.json({ error: "Brak identyfikatora notatki." }, { status: 400 });
    await db.delete(notes).where(eq(notes.id, body.id)).run();
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Note delete failed", error);
    return Response.json({ error: "Nie udało się usunąć notatki." }, { status: 500 });
  }
}
