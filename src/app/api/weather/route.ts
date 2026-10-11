import { NextRequest } from "next/server";
import { resolveHomeLocation } from "@/lib/location";

export const dynamic = "force-dynamic";

function usable(lat: number, lon: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

export async function GET(request: NextRequest) {
  const rawLat = request.nextUrl.searchParams.get("lat");
  const rawLon = request.nextUrl.searchParams.get("lon");
  const rawCity = request.nextUrl.searchParams.get("city");

  let latitude = Number(rawLat ?? Number.NaN);
  let longitude = Number(rawLon ?? Number.NaN);
  let locationSource: "query" | "config" | "geocoded" = "query";

  // Brak współrzędnych albo zerowe (0/0) → ustal lokalizację z konfiguracji
  // domu lub z nazwy miejscowości. Dzięki temu widget działa również po
  // pierwszej konfiguracji, gdy kreator nie zapisał współrzędnych.
  if (!usable(latitude, longitude)) {
    const resolved = await resolveHomeLocation({
      city: rawCity && rawCity.length <= 80 ? rawCity : undefined,
    });
    if (!resolved) {
      return Response.json(
        { error: "Ustaw lokalizację domu w panelu administratora (nazwa miejscowości)." },
        { status: 400 },
      );
    }
    latitude = resolved.latitude;
    longitude = resolved.longitude;
    locationSource = resolved.source;
  }

  try {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current:
        "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min",
      timezone: "auto",
      forecast_days: "1",
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
    const data = await response.json();
    return Response.json(
      {
        current: data.current,
        daily: data.daily,
        timezone: data.timezone,
        latitude,
        longitude,
        locationSource,
      },
      { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" } },
    );
  } catch (error) {
    console.error("Weather request failed", error);
    return Response.json({ error: "Dane pogodowe są chwilowo niedostępne." }, { status: 503 });
  }
}
