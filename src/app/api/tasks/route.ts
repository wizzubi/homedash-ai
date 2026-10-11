import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { tasks } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as { title?: unknown; assignedTo?: unknown; dueDate?: unknown };
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 140) : "";
    if (!title) return Response.json({ error: "Podaj treść zadania." }, { status: 400 });

    const dueDate = typeof body.dueDate === "string" && body.dueDate ? new Date(body.dueDate) : null;
    if (dueDate && Number.isNaN(dueDate.getTime())) {
      return Response.json({ error: "Nieprawidłowa data zadania." }, { status: 400 });
    }

    const [task] = await db
      .insert(tasks)
      .values({
        title,
        assignedTo: typeof body.assignedTo === "string" ? body.assignedTo.trim().slice(0, 48) || null : null,
        dueDate,
      })
      .returning();

    return Response.json(task, { status: 201 });
  } catch (error) {
    console.error("Task create failed", error);
    return Response.json({ error: "Nie udało się dodać zadania." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as { id?: unknown; isCompleted?: unknown };
    if (typeof body.id !== "string" || typeof body.isCompleted !== "boolean") {
      return Response.json({ error: "Brak identyfikatora lub statusu." }, { status: 400 });
    }
    const [task] = await db
      .update(tasks)
      .set({ isCompleted: body.isCompleted })
      .where(eq(tasks.id, body.id))
      .returning();
    if (!task) return Response.json({ error: "Nie znaleziono zadania." }, { status: 404 });
    return Response.json(task);
  } catch (error) {
    console.error("Task update failed", error);
    return Response.json({ error: "Nie udało się zmienić zadania." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as { id?: unknown };
    if (typeof body.id !== "string") return Response.json({ error: "Brak identyfikatora zadania." }, { status: 400 });
    await db.delete(tasks).where(eq(tasks.id, body.id)).run();
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Task delete failed", error);
    return Response.json({ error: "Nie udało się usunąć zadania." }, { status: 500 });
  }
}
