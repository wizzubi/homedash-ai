/**
 * HomeDash AI — rozpoznawanie frakcji odpadów (czysty moduł, bez zależności).
 *
 * Obsługiwane koszyki: MIXED (zmieszane), GLASS (szkło),
 * PLASTIC_METAL (plastik i metal), BIO (bio).
 *
 * Kluczowa zasada: jedno wydarzenie gminne (VEVENT) często łączy kilka
 * frakcji w jednym dniu (np. „Odpady zmieszane, Metale i tworzywa sztuczne,
 * Papier, Szkło”). Dlatego `detectFractions` zwraca WSZYSTKIE dopasowane
 * koszyki, a nie tylko pierwszy — w przeciwnym razie „Zmieszane” giną,
 * bo reguła plastiku (`metal`, `tworzywa`) pasuje wcześniej.
 * Import zapisuje wtedy osobny wiersz `garbageSchedules` na każdą frakcję.
 */

export const FRACTION_KEYS = ["MIXED", "GLASS", "PLASTIC_METAL", "BIO"] as const;
export type FractionKey = (typeof FRACTION_KEYS)[number];

export const FRACTION_LABELS: Record<FractionKey, string> = {
  MIXED: "zmieszane",
  GLASS: "szkło",
  PLASTIC_METAL: "plastik i metal",
  BIO: "bio",
};

type CalendarText = {
  summary?: string;
  description?: string;
  categories?: string | string[];
  location?: string;
};

function asText(value: string | string[] | undefined | null): string {
  if (Array.isArray(value)) return value.join(" ");
  return typeof value === "string" ? value : "";
}

/**
 * Tekst brany pod uwagę przy rozpoznawaniu frakcji. Gminy bardzo często
 * umieszczają nazwę frakcji w DESCRIPTION lub CATEGORIES, a w SUMMARY piszą
 * np. „Wywóz worków” — dlatego skanujemy wszystkie pola.
 */
export function collectEventText(event: CalendarText): string {
  return [event.summary, event.description, asText(event.categories), event.location]
    .filter(Boolean)
    .join(" · ");
}

function hasMatch(value: string, pattern: RegExp): boolean {
  const lower = value.toLocaleLowerCase("pl-PL");
  if (pattern.test(lower)) return true;
  // Wariant bez ogonków: pliki z błędnym kodowaniem („Szklo”) i tekst
  // pisany bez polskich znaków („szklo”, „zolty”) też muszą pasować.
  // Uwaga: „ł” nie dekomponuje się przez NFD, więc mapujemy je jawnie.
  const folded = lower
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return folded === lower ? false : pattern.test(folded);
}

/** Plastik / metal / opakowania (żółty pojemnik). */
export function matchesPlasticMetal(raw: string): boolean {
  return hasMatch(raw, /plastik|tworzyw|metal|opakowani|\bpet\b|żółt|zolt|zolty|foli/);
}

/** Bio / kompost / odpady zielone (brązowy pojemnik). */
export function matchesBio(raw: string): boolean {
  return hasMatch(
    raw,
    /\bbio\b|organik|kompost|tłuszcz|tluszcz|odpady zielone|zielone odpady|ga[łl]ęzie|galezie|trawa|li[śs]cie|liscie/,
  );
}

/** Szkło (zielony pojemnik). */
export function matchesGlass(raw: string): boolean {
  return hasMatch(raw, /szk[łl]|szklo|glass|s[łl]oik|sloik|butelk|szklan|zielon(k|e)? pojemnik|kolor zielon/);
}

/** Odpady zmieszane (szary / czarny pojemnik). */
export function matchesMixed(raw: string): boolean {
  return hasMatch(
    raw,
    /zmiesz|niesegreg|mixed|resztk|pozosta[łl]|pozostal|szar(e|y|y pojemnik)|czarn|kub(e|ek) stanowisk/,
  );
}

/**
 * Zwraca wszystkie rozpoznane frakcje w tekście wydarzenia
 * (kolejność kanoniczna `FRACTION_KEYS`). Pusta lista = brak dopasowania
 * (np. „Gabaryty”, „Choinki”, „Papier” — te nie mają koszyków w HomeDash).
 */
export function detectFractions(raw: string): FractionKey[] {
  if (!raw || !raw.trim()) return [];
  const found: FractionKey[] = [];
  if (matchesMixed(raw)) found.push("MIXED");
  if (matchesGlass(raw)) found.push("GLASS");
  if (matchesPlasticMetal(raw)) found.push("PLASTIC_METAL");
  if (matchesBio(raw)) found.push("BIO");
  return found;
}

/**
 * Rozpoznaje pojedynczą (pierwszą) frakcję — zachowane dla kompatybilności.
 * Kolejność ma znaczenie: najpierw materiały, potem kolory.
 */
export function normalizeFraction(raw: string): FractionKey | null {
  const value = raw.toLocaleLowerCase("pl-PL");
  if (!value) return null;

  // Plastik / metal / opakowania (żółty pojemnik)
  if (matchesPlasticMetal(raw)) return "PLASTIC_METAL";

  // Bio / kompost / odpady zielone (brązowy pojemnik)
  if (matchesBio(raw)) return "BIO";

  // Szkło (zielony pojemnik)
  if (matchesGlass(raw)) return "GLASS";

  // Odpady zmieszane (szary / czarny pojemnik)
  if (matchesMixed(raw)) return "MIXED";

  // Trailing colour heuristics (gdy brak słów kluczowych)
  if (hasMatch(raw, /żółt|zolt|zolty/)) return "PLASTIC_METAL";
  if (hasMatch(raw, /zielon/)) return "GLASS";
  if (hasMatch(raw, /brąz|braz/)) return "BIO";
  if (hasMatch(raw, /szar|czarn/)) return "MIXED";

  return null;
}
