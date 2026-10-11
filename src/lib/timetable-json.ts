/**
 * HomeDash AI — import planu lekcji z pliku JSON (czysty moduł, bez zależności).
 *
 * Oczekiwany format (np. wygenerowany ze szkolnego planu oddziału):
 * ```json
 * {
 *   "oddzial": "6E",
 *   "szkola": "SP28 Lublin",
 *   "obowiazuje_od": "28.09.2027",
 *   "plan": [
 *     { "nr": 1, "godzina": "8:00-8:45",
 *       "poniedzialek": { "przedmiot": "matematyka", "sala": "128" },
 *       "wtorek": null,
 *       "sroda": [{ "przedmiot": "wf-1/2", "sala": "SG1" },
 *                 { "przedmiot": "wf-2/2", "sala": "SG2" }] }
 *   ]
 * }
 * ```
 * - komórka dnia: `null` (okienko) | obiekt lekcji | tablica obiektów (grupy),
 * - `godzina`: `"H:MM-H:MM"` (dopuszczone spacje i myślniki typograficzne),
 * - każdy obiekt z `przedmiot` daje osobny wiersz `timetable`
 *   (dzień 1–5, godziny, przedmiot, sala).
 */

export type TimetableImportRow = {
  childName: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  subject: string;
  classroom: string | null;
};

export type TimetableImportMeta = {
  oddzial: string;
  szkola: string;
  obowiazuje_od: string;
  daysCovered: number[];
  totalLessons: number;
};

export type TimetableImportResult = {
  lessons: TimetableImportRow[];
  meta: TimetableImportMeta;
  warnings: string[];
};

const MAX_ROWS = 200;
const MAX_WARNINGS = 12;

const DAY_KEYS: Record<string, number> = {
  poniedzialek: 1,
  wtorek: 2,
  sroda: 3,
  czwartek: 4,
  piatek: 5,
};

const META_KEYS = new Set(["nr", "godzina", "lekcja", "przerwa"]);

function foldPl(value: string): string {
  return value
    .toLocaleLowerCase("pl-PL")
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function cleanStr(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseRange(raw: unknown, nr: number): { startTime: string; endTime: string } {
  const text = cleanStr(raw, 32).replace(/[–—−]/g, "-").replace(/\s+/g, "");
  const match = text.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Lekcja ${nr}: nieprawidłowa godzina „${cleanStr(raw, 32)}” — oczekiwano formatu GG:MM-GG:MM.`);
  }
  const pad = (h: string, m: string) => `${h.padStart(2, "0")}:${m}`;
  const startTime = pad(match[1], match[2]);
  const endTime = pad(match[3], match[4]);
  const valid = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  if (!valid(startTime) || !valid(endTime) || startTime >= endTime) {
    throw new Error(`Lekcja ${nr}: nieprawidłowy zakres godzin „${cleanStr(raw, 32)}”.`);
  }
  return { startTime, endTime };
}

/**
 * Parsuje JSON planu lekcji do wierszy `timetable` dla danego dziecka.
 * Rzuca `Error` z polskim komunikatem przy nieprawidłowym pliku.
 */
export function parseTimetableJson(raw: string, childName: string): TimetableImportResult {
  const child = childName.trim().slice(0, 48);
  if (!child) throw new Error("Podaj imię dziecka, do którego przypisać plan lekcji.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("To nie wygląda na plik JSON — sprawdź format.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Plik JSON musi zawierać obiekt z polem „plan”.");
  }
  const root = parsed as Record<string, unknown>;
  const plan = root.plan;
  if (!Array.isArray(plan) || plan.length === 0) {
    throw new Error("Nie znaleziono lekcji — pole „plan” musi być niepustą listą.");
  }

  const lessons: TimetableImportRow[] = [];
  const warnings: string[] = [];
  const days = new Set<number>();
  const warn = (message: string) => {
    if (warnings.length < MAX_WARNINGS && !warnings.includes(message)) warnings.push(message);
  };

  plan.forEach((entry, index) => {
    const nr = typeof (entry as { nr?: unknown })?.nr === "number" ? (entry as { nr: number }).nr : index + 1;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      warn(`Lekcja ${nr}: pominięto nieprawidłowy wpis.`);
      return;
    }
    const row = entry as Record<string, unknown>;
    const { startTime, endTime } = parseRange(row.godzina, nr);

    for (const [key, value] of Object.entries(row)) {
      const folded = foldPl(key);
      if (META_KEYS.has(folded)) continue;
      const dayOfWeek = DAY_KEYS[folded];
      if (!dayOfWeek) {
        warn(`Lekcja ${nr}: pominięto nieznane pole „${key}” (plan obejmuje pn–pt).`);
        continue;
      }
      if (value === null || value === undefined) continue;
      const cells = Array.isArray(value) ? value : [value];
      for (const cell of cells) {
        if (!cell || typeof cell !== "object" || Array.isArray(cell)) {
          warn(`Lekcja ${nr}, ${key}: pominięto nieprawidłową komórkę.`);
          continue;
        }
        const subject = cleanStr((cell as Record<string, unknown>).przedmiot, 80);
        if (!subject) {
          warn(`Lekcja ${nr}, ${key}: komórka bez przedmiotu — pominięto.`);
          continue;
        }
        const classroom = cleanStr((cell as Record<string, unknown>).sala, 30) || null;
        lessons.push({ childName: child, dayOfWeek, startTime, endTime, subject, classroom });
        days.add(dayOfWeek);
        if (lessons.length >= MAX_ROWS) {
          throw new Error(`Plan jest zbyt duży — ograniczono do ${MAX_ROWS} lekcji.`);
        }
      }
    }
  });

  if (lessons.length === 0) {
    throw new Error("Nie rozpoznano ani jednej lekcji — sprawdź pola dni (poniedzialek…piatek) i przedmiotów.");
  }

  lessons.sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime) || a.subject.localeCompare(b.subject),
  );

  return {
    lessons,
    meta: {
      oddzial: cleanStr(root.oddzial, 24),
      szkola: cleanStr(root.szkola, 80),
      obowiazuje_od: cleanStr(root.obowiazuje_od, 24),
      daysCovered: [...days].sort((a, b) => a - b),
      totalLessons: lessons.length,
    },
    warnings,
  };
}
