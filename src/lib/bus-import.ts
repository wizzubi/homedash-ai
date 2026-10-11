/**
 * HomeDash AI — import rozkładu jazdy (CSV / JSON, czysty moduł).
 *
 * CSV (separator `,` lub `;`, nagłówek PL lub EN):
 * ```csv
 * linia,przystanek,kierunek,odjazd,dni
 * 12,Dworzec Główny,Dzielnica,06:15,powszedni
 * ```
 * JSON: lista obiektów z tymi samymi kluczami (dowolny zestaw aliasów)
 * albo format tabelaryczny przewoźnika:
 * ```json
 * { "linia": "013", "kierunek": "Os. Poręba", "przystanek": "Włościańska 01",
 *   "rozklad": { "dzien_powszedni_rok_szkolny": [{ "godzina": 5, "minuty": ["45"] }],
 *                "sobota_rok_szkolny": [...], "dzien_swiateczny_rok_szkolny": [...] } }
 * ```
 *
 * `dni` → WEEKDAY (powszedni, pn-pt, roboczy, weekday) lub WEEKEND
 * (weekend, sb-nd, sobota, niedziela). Brak / inne → WEEKDAY.
 */

export type BusImportRow = {
  line: string;
  stopName: string;
  direction: string;
  departureTime: string;
  dayType: "WEEKDAY" | "WEEKEND";
};

export type BusImportResult = {
  rows: BusImportRow[];
  stops: string[];
  warnings: string[];
};

const MAX_ROWS = 2000;
const MAX_WARNINGS = 10;

const KEY_ALIASES: Record<keyof Omit<BusImportRow, "dayType"> | "dayType", string[]> = {
  line: ["line", "linia", "l"],
  stopName: ["stopname", "stop", "przystanek", "przystaneknazwa", "nazwaprzystanku"],
  direction: ["direction", "kierunek", "dokad", "dokąd", "cel"],
  departureTime: ["departuretime", "departure", "odjazd", "godzina", "czas"],
  dayType: ["daytype", "day", "dni", "dzien", "dzień", "kiedy"],
};

function normKey(value: string): string {
  return value
    .toLocaleLowerCase("pl-PL")
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
}

function normDayType(value: unknown): "WEEKDAY" | "WEEKEND" {
  const folded = normKey(typeof value === "string" ? value : "");
  if (/weekend|sbnd|sobot|niedz|swiateczn|swieta|wolne/.test(folded)) return "WEEKEND";
  return "WEEKDAY";
}

/** Typ dnia z nazwy klucza rozkładu („dzien_powszedni_rok_szkolny” → WEEKDAY). */
function dayTypeFromScheduleKey(key: string): "WEEKDAY" | "WEEKEND" | null {
  const folded = normKey(key);
  if (/sobot|niedz|swiateczn|swieta|weekend/.test(folded)) return "WEEKEND";
  if (/powszedni|roboczy|weekday|dzien/.test(folded)) return "WEEKDAY";
  return null;
}

/** Minuta z adnotacją legendy („07a” → „07”, „kurs przez Rapackiego” ginie). */
function normMinute(value: unknown): string | null {
  const digits = (typeof value === "string" || typeof value === "number" ? String(value) : "").replace(/\D/g, "");
  if (!/^\d{1,2}$/.test(digits)) return null;
  const padded = digits.padStart(2, "0");
  return Number(padded) <= 59 ? padded : null;
}

/**
 * Rozwija format tabelaryczny przewoźnika do płaskich wierszy:
 * `{ linia, kierunek, przystanek, rozklad: { dzien_*: [{ godzina, minuty[] }] } }`.
 */
function expandTabular(record: Record<string, unknown>): { rows: BusImportRow[]; skippedKeys: string[] } {
  const rows: BusImportRow[] = [];
  const skippedKeys: string[] = [];
  const line = String(pickField(record, KEY_ALIASES.line) ?? "").trim().slice(0, 12);
  const stopName = String(pickField(record, KEY_ALIASES.stopName) ?? "").trim().slice(0, 80);
  const direction = String(pickField(record, KEY_ALIASES.direction) ?? "").trim().slice(0, 80);
  const schedule = record.rozklad;
  if (!line || !stopName || !direction || !schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
    return { rows, skippedKeys };
  }
  for (const [dayKey, hours] of Object.entries(schedule as Record<string, unknown>)) {
    const dayType = dayTypeFromScheduleKey(dayKey);
    if (!dayType) {
      skippedKeys.push(dayKey);
      continue;
    }
    if (!Array.isArray(hours)) continue;
    for (const entry of hours) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const hourRaw = (entry as Record<string, unknown>).godzina;
      const hour = typeof hourRaw === "number" ? hourRaw : Number(String(hourRaw ?? "").trim());
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
      const minutes = (entry as Record<string, unknown>).minuty;
      if (!Array.isArray(minutes)) continue;
      for (const minute of minutes) {
        const minuteNorm = normMinute(minute);
        if (!minuteNorm) continue;
        rows.push({
          line,
          stopName,
          direction,
          departureTime: `${String(hour).padStart(2, "0")}:${minuteNorm}`,
          dayType,
        });
      }
    }
  }
  return { rows, skippedKeys };
}

function normTime(value: unknown): string | null {
  const text = (typeof value === "string" || typeof value === "number" ? String(value) : "").trim().replace(/\s+/g, "");
  const match = text.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!match) return null;
  const time = `${match[1].padStart(2, "0")}:${match[2]}`;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null;
}

function pickField(record: Record<string, unknown>, aliases: string[]): unknown {
  const entries = Object.entries(record);
  for (const alias of aliases) {
    const hit = entries.find(([key]) => normKey(key) === alias);
    if (hit) return hit[1];
  }
  return undefined;
}

function toRow(record: Record<string, unknown>): BusImportRow | null {
  const line = String(pickField(record, KEY_ALIASES.line) ?? "").trim().slice(0, 12);
  const stopName = String(pickField(record, KEY_ALIASES.stopName) ?? "").trim().slice(0, 80);
  const direction = String(pickField(record, KEY_ALIASES.direction) ?? "").trim().slice(0, 80);
  const departureTime = normTime(pickField(record, KEY_ALIASES.departureTime));
  if (!line || !stopName || !direction || !departureTime) return null;
  return { line, stopName, direction, departureTime, dayType: normDayType(pickField(record, KEY_ALIASES.dayType)) };
}

function splitCsvLine(line: string): string[] {
  const separator = line.includes(";") && !line.includes(",") ? ";" : ",";
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === separator && !quoted) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current.trim());
  return out;
}

function parseCsv(raw: string): Record<string, unknown>[] {
  const lines = raw
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new Error("CSV jest pusty — potrzebny nagłówek i co najmniej jeden odjazd.");
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const record: Record<string, unknown> = {};
    header.forEach((name, index) => {
      record[name] = cells[index] ?? "";
    });
    return record;
  });
}

/**
 * Parsuje rozkład jazdy z CSV lub JSON. Rzuca `Error` po polsku.
 */
export function parseBusSchedule(raw: string): BusImportResult {
  const text = (raw || "").trim();
  if (!text) throw new Error("Wklej zawartość pliku CSV lub JSON z rozkładem jazdy.");
  if (text.length > 500_000) throw new Error("Plik jest zbyt duży (limit 500 KB).");

  let records: Record<string, unknown>[];
  if (text.startsWith("[") || text.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("To nie wygląda na poprawny JSON.");
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    records = list.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  } else {
    records = parseCsv(text);
  }
  if (records.length === 0) throw new Error("Nie znaleziono żadnych odjazdów.");

  const rows: BusImportRow[] = [];
  const warnings: string[] = [];
  records.forEach((record, index) => {
    // Wariant tabelaryczny przewoźnika ({ rozklad: { dzien_*: [...] } }).
    if (record.rozklad && typeof record.rozklad === "object" && !Array.isArray(record.rozklad)) {
      const expanded = expandTabular(record);
      for (const key of expanded.skippedKeys) {
        if (warnings.length < MAX_WARNINGS) warnings.push(`Pominięto nieznany klucz rozkładu „${key}”.`);
      }
      if (expanded.rows.length === 0) {
        if (warnings.length < MAX_WARNINGS) warnings.push(`Wpis ${index + 1}: brak odjazdów w rozkładzie — pominięto.`);
        return;
      }
      rows.push(...expanded.rows);
      if (rows.length > MAX_ROWS) throw new Error(`Rozkład jest zbyt duży — ograniczono do ${MAX_ROWS} odjazdów.`);
      return;
    }
    const row = toRow(record);
    if (!row) {
      if (warnings.length < MAX_WARNINGS) {
        warnings.push(`Wiersz ${index + 1}: brak linii, przystanku, kierunku lub godziny — pominięto.`);
      }
      return;
    }
    rows.push(row);
    if (rows.length > MAX_ROWS) throw new Error(`Rozkład jest zbyt duży — ograniczono do ${MAX_ROWS} odjazdów.`);
  });
  if (rows.length === 0) throw new Error("Nie rozpoznano ani jednego odjazdu — sprawdź nagłówki (linia, przystanek, kierunek, odjazd).");

  return {
    rows,
    stops: [...new Set(rows.map((row) => row.stopName))].sort((a, b) => a.localeCompare(b, "pl-PL")),
    warnings,
  };
}
