import { getDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getDashboardData(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Dashboard data could not be loaded", error);
    return Response.json({ error: "Nie udało się pobrać danych domu." }, { status: 500 });
  }
}
