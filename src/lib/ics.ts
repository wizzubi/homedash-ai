import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { garbageSchedules } from "@/db/schema";
import ical from "node-ical";
import {
  FRACTION_LABELS,
  collectEventText,
  detectFractions,
  type FractionKey,
} from "@/lib/waste-fractions";

// Re-eksport dla dotychczasowych importerów (`/api/admin`, `/api/setup`).
export { FRACTION_KEYS, FRACTION_LABELS, collectEventText, normalizeFraction, detectFractions } from "@/lib/waste-fractions";
export type { FractionKey } from "@/lib/waste-fractions";

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

function atNoon(year: number, month: number, day: number) {
  return new Date(year, month, day, 12, 0, 0, 0);
}

/**
 * Zamienia datę zdarzenia na dzień kalendarzowy.
 * node-ical materializuje daty całodniowe (`VALUE=DATE`, flaga `dateOnly`)
 * jako północ czasu LOKALNEGO serwera — dlatego dzień odczytujemy getterami
 * lokalnymi. Gettery UTC przesuwałyby takie daty o dzień wstecz w strefach
 * na wschód od Greenwich (np. Europe/Warsaw: 2026-10-23 00:00+02:00 to
 * 2026-10-22T22:00Z).
 */
function toDay(input: Date | string | undefined): Date | null {
  if (!input) return null;
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return atNoon(date.getFullYear(), date.getMonth(), date.getDate());
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
  /** Streszczenia zdarzeń bez żadnego koszyka (np. „Gabaryty”) — do wglądu, nie do bazy. */
  unmatched: string[];
};

/**
 * Parsuje kalendarz gminny `.ics` i zapisuje rozpoznane terminy odbioru.
 * Jedno wydarzenie może dać kilka wierszy (osobny na każdą frakcję z danego
 * dnia — np. „Zmieszane + Plastik + Szkło” z 2026-01-03). Frakcje bez koszyka
 * w HomeDash (Papier, Gabaryty, Choinki) są pomijane i raportowane w `unmatched`.
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
  const unmatched: string[] = [];
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

    // Wszystkie frakcje z danego dnia — nie tylko pierwsza (to gubiło „Zmieszane”
    // w zdarzeniach łączonych typu „Zmieszane, Metale i tworzywa, Papier, Szkło”).
    const fractions = detectFractions(collectEventText(event));
    if (fractions.length === 0) {
      unrecognised += 1;
      const summary = (event.summary || "").trim().slice(0, 90);
      if (summary && unmatched.length < 12 && !unmatched.includes(summary)) unmatched.push(summary);
      continue;
    }
    matchedEvents += 1;
    const summary = (event.summary || "").trim().slice(0, 90) || fractions.map((key) => FRACTION_LABELS[key]).join(" + ");
    for (const fraction of fractions) {
      if (!recognised.some((item) => item.summary === summary && item.fraction === fraction)) {
        recognised.push({ summary, fraction, recurring: Boolean(event.rrule) });
      }
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
        for (const fraction of fractions) candidates.push({ fraction, pickupDate: date });
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
    unmatched,
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
    const vevents = events.filter((event) => event.type === "VEVENT" && event.status !== "CANCELLED");
    const matched = vevents.flatMap((event) => {
      const fractions = detectFractions(collectEventText(event));
      return fractions.map((fraction) => ({
        summary: (event.summary || "").trim().slice(0, 90),
        fraction,
        recurring: Boolean(event.rrule),
        cancelled: false,
      }));
    });
    const unmatchedEvents = vevents.filter(
      (event) => detectFractions(collectEventText(event)).length === 0,
    );
    return {
      totalEvents: vevents.length,
      matchedEvents: vevents.length - unmatchedEvents.length,
      unrecognised: unmatchedEvents.length,
      recognised: matched.slice(0, 12),
    };
  });
}
