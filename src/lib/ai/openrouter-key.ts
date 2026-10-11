/**
 * HomeDash AI — rotacja kluczy OpenRouter (Round-Robin + Fallback).
 *
 * Konfiguracja w `.env` / `.env.local`:
 *   OPENROUTER_API_KEYS="key1,key2,key3"   // wiele kluczy (przecinek/średnik/nowa linia)
 *   OPENROUTER_API_KEY="key1"               // wsteczna kompatybilność: pojedynczy klucz
 *
 * Oba zapisy można łączyć — klucze są deduplikowane.
 *
 * Strategia:
 *  - każde żądanie startuje od kolejnego klucza (Round-Robin, wskaźnik na proces),
 *    dzięki czemu dzienne limity darmowych modeli rozkładają się równomiernie;
 *  - przy błędzie limitu/autoryzacji (429 / 401 / 403 / 402, quota, zły klucz)
 *    pętle w `/api/chat` i `/api/assistant` automatycznie próbują następnego
 *    klucza z listy (`isKeyRotatableError`).
 */

function cleanKey(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/^"|"$/g, "") : "";
}

/** Wszystkie skonfigurowane klucze OpenRouter (bez wycieków — tylko do użytku serwera). */
export function getOpenRouterKeys(): string[] {
  const split = (value: string | undefined) =>
    (value || "")
      .split(/[,;\n]+/)
      .map(cleanKey)
      .filter(Boolean);
  // Obie zmienne akceptują listę — użytkownik może wkleić klucze po przecinku
  // także do pojedynczego OPENROUTER_API_KEY.
  return [...new Set([...split(process.env.OPENROUTER_API_KEYS), ...split(process.env.OPENROUTER_API_KEY)])];
}

let cursor = 0;

/** Następny klucz w rotacji Round-Robin albo `null`, gdy brak kluczy. */
export function getOpenRouterKey(): string | null {
  const keys = getOpenRouterKeys();
  if (keys.length === 0) return null;
  const key = keys[cursor % keys.length] as string;
  cursor += 1;
  return key;
}

/**
 * Kolejność prób kluczy dla jednego żądania: lista od bieżącego wskaźnika
 * rotacji (wskaźnik przesuwa się raz na żądanie, nie na kandydata).
 * Pusta lista = brak kluczy, działa tylko tryb lokalny.
 */
export function getOpenRouterKeyRotation(): string[] {
  const keys = getOpenRouterKeys();
  if (keys.length === 0) return [];
  const start = cursor % keys.length;
  cursor += 1;
  return [...keys.slice(start), ...keys.slice(0, start)];
}

/** Zeruje wskaźnik rotacji — przydatne w testach. */
export function resetOpenRouterRotation(): void {
  cursor = 0;
}

function errorStatus(error: unknown): number | null {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    for (const field of ["statusCode", "status"]) {
      const value = record[field];
      if (typeof value === "number" && Number.isInteger(value)) return value;
    }
  }
  return null;
}

/**
 * Czy błąd kwalifikuje się do próby z następnym kluczem?
 * Tak: limity i autoryzacja (429 / 401 / 403 / 402, quota, wyczerpane kredyty,
 * nieprawidłowy klucz). Nie: błędy zapytania/modelu (400, 404) — inny klucz
 * tego samego modelu zwróciłby to samo, więc pętle przeskakują od razu
 * do kolejnego modelu/dostawcy.
 */
export function isKeyRotatableError(error: unknown): boolean {
  const status = errorStatus(error);
  if (status !== null) {
    // Limity i autoryzacja: następny klucz (inne konto/limit) może pomóc.
    if (status === 429 || status === 401 || status === 402 || status === 403) return true;
    // Błędy zapytania/modelu (400, 404…): ten sam model na innym kluczu
    // zwróciłby to samo — pętle przeskakują do kolejnego modelu/dostawcy.
    if (status >= 400 && status < 500) return false;
    // 5xx i inne: ponowienie na kolejnej ścieżce ma sens.
    return true;
  }
  const message = (error instanceof Error ? error.message : String(error)).toLocaleLowerCase("en-US");
  if (
    /rate.?limit|too many requests|quota|insufficient|credit|balance|free-models|user limit|rate_limit/.test(
      message,
    )
  ) {
    return true;
  }
  if (/invalid api key|invalid_api_key|unauthorized|forbidden|authenticate|api key/.test(message)) {
    return true;
  }
  return false;
}
