import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { garbageSchedules } from "@/db/schema";
import ical from "node-ical";

export const FRACTION_KEYS = ["MIXED", "GLASS", "PLASTIC_METAL", "BIO"] as const;
export type FractionKey = (typeof FRACTION_KEYS)[number];

export const FRACTION_LABELS: Record<FractionKey, string> = {
  MIXED: "zmieszane",
  GLASS: "szkło",
  PLASTIC_METAL: "plastik i metal",
  BIO: "bio",
};

type IcsDate = Date & { dateOnly?: boolean; tz?: string };

type CalendarEvent = {
  type?: string;
  start?: Date | string;
  summary?: string;
  description?: string;
  categories?: string | string[];
  location?: string;
  rrule?: unknown;
  status?: string;
};

/**
 * Normalizuje surowy plik ICS zgodnie z RFC 5545: usuwa BOM, ujednolica
 * CRLF/LF i skleja zawijane wiersze (kontynuacje zaczynające się od spacji
 * lub tabulatora). Bez tego część plików gminnych parsuje się niekompletnie.
 */
export function normalizeIcs(raw: string): string {
  const withoutBom = raw.replace(/^\uFEFF/, "");
  const unified = withoutBom.replace(/\r\n?/g, "\n");
  const unfolded = unified.replace(/\n[ \t]/g, "");
  return unfolded.endsWith("\n") ? unfolded : `${unfolded}\n`;
}

function asText(value: string | string[] | undefined | null): string {
  if (Array.isArray(value)) return value.join(" ");
  return typeof value === "string" ? value : "";
}

/**
 * Tekst brany pod uwagę przy rozpoznawaniu frakcji. Gminy bardzo często
 * umieszczają nazwę frakcji w DESCRIPTION lub CATEGORIES, a w SUMMARY piszą
 * np. „Wywóz worków” — dlatego skanujemy wszystkie pola.
 */
export function collectEventText(event: CalendarEvent): string {
  return [event.summary, event.description, asText(event.categories), event.location]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Rozpoznaje frakcję odpadów po polsku (odmiany, kolory pojemników).
 * Kolejność ma znaczenie: najpierw materiały, potem kolory.
 */
export function normalizeFraction(raw: string): FractionKey | null {
  const value = raw.toLocaleLowerCase("pl-PL");
  if (!value) return null;

  const has = (pattern: RegExp) => pattern.test(value);

  // Plastik / metal / opakowania (żółty pojemnik)
  if (has(/plastik|tworzyw|metal|opakowani|\bpet\b|żółt|zolt|foli/)) return "PLASTIC_METAL";

  // Bio / kompost / odpady zielone (brązowy pojemnik)
  if (has(/\bbio\b|organik|kompost|tłuszcz|tluszcz|odpady zielone|zielone odpady|ga[łl]ęzie|galezie|trawa|li[śs]cie/)) {
    return "BIO";
  }

  // Szkło (zielony pojemnik)
  if (has(/szk[łl]|glass|s[łl]oik|butelk|szklan|zielon(k|e)? pojemnik|kolor zielon/)) return "GLASS";

  // Odpady zmieszane (szary / czarny pojemnik)
  if (has(/zmiesz|niesegreg|mixed|resztk|pozosta[łl]|pozostal|szar(e|y|y pojemnik)|czarn|kub(e|ek) stanowisk/)) {
    return "MIXED";
  }

  // Trailing colour heuristics (gdy brak słów kluczowych)
  if (has(/żółt|zolt/)) return "PLASTIC_METAL";
  if (has(/zielon/)) return "GLASS";
  if (has(/brąz|braz/)) return "BIO";
  if (has(/szar|czarn/)) return "MIXED";

  return null;
}

function atNoon(year: number, month: number, day: number) {
  return new Date(year, month, day, 12, 0, 0, 0);
}

/**
 * Zamienia datę zdarzenia na dzień kalendarzowy.
 * Zdarzenia całodniowe (`dateOnly`) mają północ w UTC — używamy wtedy
 * getterów UTC, inaczej w strefie innej niż UTC data przesuwa się o dzień.
 */
function toDay(input: Date | string | undefined): Date | null {
  if (!input) return null;
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  const dateOnly = Boolean((date as IcsDate).dateOnly);
  const year = dateOnly ? date.getUTCFullYear() : date.getFullYear();
  const month = dateOnly ? date.getUTCMonth() : date.getMonth();
  const day = dateOnly ? date.getUTCDate() : date.getDate();
  return atNoon(year, month, day);
}

function isoDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export type ImportResult = {
  imported: number;
  detected: number;
  totalEvents: number;
  matchedEvents: number;
  unrecognised: number;
  cancelled: number;
  recognised: Array<{ summary: string; fraction: FractionKey; recurring: boolean }>;
};

/**
 * Parsuje kalendarz gminny `.ics` i zapisuje rozpoznane terminy odbioru.
 * Istniejące wpisy nigdy nie są duplikowane.
 */
export async function importGarbageCalendar(icsText: string): Promise<ImportResult> {
  await ensureSchema();
  const normalized = normalizeIcs(icsText);
  if (!normalized.includes("BEGIN:VCALENDAR")) {
    throw new Error("To nie wygląda na plik iCalendar (.ics).");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = (await ical.async.parseICS(normalized)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Nie udało się sparsować pliku ICS: ${error instanceof Error ? error.message : "nieznany błąd"}`,
    );
  }

  const events = Object.values(parsed) as unknown as CalendarEvent[];
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const until = new Date(from);
  until.setDate(until.getDate() + 366);

  const candidates: Array<{ fraction: FractionKey; pickupDate: Date }> = [];
  const recognised: ImportResult["recognised"] = [];
  let totalEvents = 0;
  let matchedEvents = 0;
  let unrecognised = 0;
  let cancelled = 0;

  for (const event of events) {
    if (event.type !== "VEVENT") continue;
    totalEvents += 1;
    if (event.status === "CANCELLED") {
      cancelled += 1;
      continue;
    }

    const fraction = normalizeFraction(collectEventText(event));
    if (!fraction) {
      unrecognised += 1;
      continue;
    }
    matchedEvents += 1;
    const summary = (event.summary || "").trim().slice(0, 90) || FRACTION_LABELS[fraction];
    if (!recognised.some((item) => item.summary === summary && item.fraction === fraction)) {
      recognised.push({ summary, fraction, recurring: Boolean(event.rrule) });
    }

    let dates: Date[] = [];
    if (event.rrule) {
      try {
        const recurring = ical.expandRecurringEvent(event as never, { from, to: until }) as unknown as Array<{
          start?: Date;
        }>;
        dates = (recurring || [])
          .map((item) => toDay(item.start))
          .filter((date): date is Date => date instanceof Date);
      } catch (error) {
        console.warn("RRULE expansion failed", error);
        dates = [];
      }
    }
    if (dates.length === 0) {
      const single = toDay(event.start);
      if (single) dates = [single];
    }

    for (const date of dates) {
      if (date.getTime() >= from.getTime() && date.getTime() <= until.getTime()) {
        candidates.push({ fraction, pickupDate: date });
      }
    }
    if (candidates.length >= 500) break;
  }

  const existing = await db
    .select({ fraction: garbageSchedules.fraction, pickupDate: garbageSchedules.pickupDate })
    .from(garbageSchedules)
    .all();
  const existingKeys = new Set(existing.map(({ fraction, pickupDate }) => `${fraction}:${isoDayKey(new Date(pickupDate))}`));

  const unique = new Map<string, { fraction: FractionKey; pickupDate: Date }>();
  for (const item of candidates) {
    const key = `${item.fraction}:${isoDayKey(item.pickupDate)}`;
    if (!existingKeys.has(key) && !unique.has(key)) unique.set(key, item);
  }

  const additions = [...unique.values()];
  if (additions.length > 0) await db.insert(garbageSchedules).values(additions).run();

  return {
    imported: additions.length,
    detected: candidates.length,
    totalEvents,
    matchedEvents,
    unrecognised,
    cancelled,
    recognised: recognised.slice(0, 12),
  };
}

/**
 * Podgląd rozpoznania (bez zapisu) — używany przez kreator, żeby pokazać
 * użytkownikowi, które wydarzenia zostały dopasowane do frakcji.
 */
export function previewGarbageCalendar(icsText: string) {
  const normalized = normalizeIcs(icsText);
  if (!normalized.includes("BEGIN:VCALENDAR")) {
    throw new Error("To nie wygląda na plik iCalendar (.ics).");
  }
  return ical.async.parseICS(normalized).then((parsed) => {
    const events = Object.values(parsed) as unknown as CalendarEvent[];
    const vevents = events.filter((event) => event.type === "VEVENT");
    const matched = vevents
      .map((event) => {
        const fraction = normalizeFraction(collectEventText(event));
        return {
          summary: (event.summary || "").trim().slice(0, 90),
          fraction,
          recurring: Boolean(event.rrule),
          cancelled: event.status === "CANCELLED",
        };
      })
      .filter((item) => item.fraction && !item.cancelled);
    return {
      totalEvents: vevents.length,
      matchedEvents: matched.length,
      unrecognised: vevents.length - matched.filter((item) => !item.cancelled).length,
      recognised: matched.slice(0, 12),
    };
  });
}
