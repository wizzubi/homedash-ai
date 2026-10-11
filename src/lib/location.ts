import { getConfig, setConfigValues } from "@/lib/dashboard-data";

export type ResolvedLocation = {
  latitude: number;
  longitude: number;
  source: "config" | "geocoded";
  label?: string;
};

function isUsableCoordinate(lat: number, lon: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    // 0/0 to punkt w Zatoce Gwinei — efekt nieustawionych współrzędnych.
    !(lat === 0 && lon === 0)
  );
}

/**
 * Współrzędne miejscowości przez API geokodowania Open-Meteo.
 * Zwraca `null`, gdy miejscowości nie udało się znaleźć.
 */
export async function geocodeCity(city: string): Promise<{ latitude: number; longitude: number; label: string } | null> {
  const name = city.trim();
  if (!name) return null;
  try {
    const params = new URLSearchParams({
      name,
      count: "1",
      language: "pl",
      format: "json",
    });
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, {
      cache: "force-cache",
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error(`geocoding ${response.status}`);
    const data = (await response.json()) as {
      results?: Array<{ latitude?: number; longitude?: number; name?: string; admin1?: string; country?: string }>;
    };
    const first = data.results?.[0];
    if (!first || typeof first.latitude !== "number" || typeof first.longitude !== "number") return null;
    const parts = [first.name, first.admin1].filter(Boolean).join(", ");
    return { latitude: first.latitude, longitude: first.longitude, label: parts || name };
  } catch (error) {
    console.warn("Geocoding failed for", name, error);
    return null;
  }
}

/**
 * Ustala współrzędne domu: najpierw z zapisanej konfiguracji, a gdy brak
 * (albo są zerowe, bo kreator pominął wybór lokalizacji) — z nazwy miejscowości.
 * Wynik geokodowania dopisywany jest do konfiguracji, żeby nie pytać ponownie.
 */
export async function resolveHomeLocation(
  overrides?: { latitude?: number; longitude?: number; city?: string },
): Promise<ResolvedLocation | null> {
  const config = await getConfig();

  const overrideLat = overrides?.latitude;
  const overrideLon = overrides?.longitude;
  if (typeof overrideLat === "number" && typeof overrideLon === "number" && isUsableCoordinate(overrideLat, overrideLon)) {
    return { latitude: overrideLat, longitude: overrideLon, source: "config" };
  }

  const storedLat = Number(config.city_lat);
  const storedLon = Number(config.city_lon);
  if (isUsableCoordinate(storedLat, storedLon)) {
    return { latitude: storedLat, longitude: storedLon, source: "config" };
  }

  const city = overrides?.city?.trim() || config.home_city || "";
  const geocoded = await geocodeCity(city);
  if (!geocoded) return null;

  await setConfigValues({
    city_lat: String(geocoded.latitude),
    city_lon: String(geocoded.longitude),
  });

  return {
    latitude: geocoded.latitude,
    longitude: geocoded.longitude,
    source: "geocoded",
    label: geocoded.label,
  };
}
