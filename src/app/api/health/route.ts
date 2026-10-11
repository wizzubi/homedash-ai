import { client, databaseTarget } from "@/db";
import { ensureSchema } from "@/db/migrate";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSchema();
    await client.execute("SELECT 1");
    return Response.json({ ok: true, database: databaseTarget });
  } catch (error) {
    console.error("Health check failed", error);
    return Response.json({ ok: false, database: databaseTarget }, { status: 500 });
  }
}
