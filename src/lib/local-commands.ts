/**
 * HomeDash AI — lokalny parser komend (Local-First, zero kosztów AI).
 *
 * Czysty moduł bez zależności od Node/bazy — działa identycznie
 * na kliencie (szybka ścieżka w `handleUserCommand`) i na serwerze
 * (deterministyczny fallback w `runLocalCommand`).
 *
 * Kolejność w `handleUserCommand(text)`:
 *   1. `parseLocalCommand(text)` → natychmiastowa akcja (Turso/REST) + koniec.
 *   2. `null` → dopiero wtedy POST do `/api/chat` lub `/api/assistant` (AI Fallback).
 */

import { matchRadioStation } from "@/lib/radio-stations";

export type WasteFraction = "MIXED" | "GLASS" | "PLASTIC_METAL" | "BIO";
export type WorkPeriod = "today" | "week" | "month";

/** Dzień w pytaniach o plan lekcji: dziś / przesunięcie / dzień tygodnia 1–5. */
export type LessonDay = { kind: "today" } | { kind: "offset"; days: number } | { kind: "weekday"; day: number };

export type LocalIntent =
  | { kind: "addTask"; title: string; assignedTo: string | null }
  | { kind: "completeTask"; title: string; completed: boolean }
  | { kind: "logWork"; hours?: number; startTime?: string; endTime?: string; note?: string | null }
  | { kind: "workSummary"; period: WorkPeriod }
  | { kind: "wasteQuery"; fraction?: WasteFraction }
  | { kind: "addNote"; content: string; title?: string | null }
  | { kind: "radioPlay"; stationId: string | null }
  | { kind: "radioStop" }
  | { kind: "volumeUp" }
  | { kind: "volumeDown" }
  | { kind: "lessonEnd"; child: string | null; day: LessonDay }
  | { kind: "lessonCount"; child: string | null; day: LessonDay }
  | { kind: "lessonPlan"; child: string | null; day: LessonDay }
  | { kind: "busQuery"; stop: string | null };

export type LocalSource = "local-task" | "local-work" | "local-waste" | "local-note" | "local-radio" | "local-lessons" | "local-bus";

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

function clean(text: string): string {
  return text.trim().replace(/^[,.:;\s]+|[,.:;\s]+$/g, "");
}

function lower(text: string): string {
  return text.toLocaleLowerCase("pl-PL");
}

/** "Lena / mama i tata" po słowie "dla" — maks. 48 znaków. */
function extractOwner(text: string): string | null {
  const match = text.match(/dla\s+([\p{L}][\p{L}\s]{0,40})/iu);
  const owner = match?.[1]?.trim().replace(/[,.:;]+$/, "").trim();
  return owner ? owner.slice(0, 48) : null;
}

function parseClockToken(hour: string, minute: string): string | null {
  const value = `${hour.padStart(2, "0")}:${minute}`;
  return CLOCK.test(value) ? value : null;
}

/** Normalizuje "8,5" / "8.5" / "pół" do liczby godzin. */
function parseHoursAmount(text: string): number | undefined {
  const normalized = lower(text).replace("półtorej", "1.5").replace(/pół\b/, "0.5");
  const match = normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:godzin\w*|godz\.?|h\b)/i);
  if (!match) return undefined;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 && value <= 24 ? Math.round(value * 100) / 100 : undefined;
}

function parseRange(text: string): { startTime: string; endTime: string } | null {
  const match = text.match(
    /od\s+(\d{1,2}):([0-5]\d)\s*(?:do|–|-|—)\s*(\d{1,2}):([0-5]\d)/i,
  );
  if (!match) return null;
  const startTime = parseClockToken(match[1], match[2]);
  const endTime = parseClockToken(match[3], match[4]);
  return startTime && endTime ? { startTime, endTime } : null;
}

function parseWorkPeriod(text: string): WorkPeriod {
  const t = lower(text);
  if (/tygodni|tydzień|tydzien/.test(t)) return "week";
  if (/miesiąc|miesiac|miesięć/.test(t)) return "month";
  return "today";
}

function parseWasteFraction(text: string): WasteFraction | undefined {
  const t = lower(text);
  if (/plastik|metal|pet|butelk.*plastik/.test(t)) return "PLASTIC_METAL";
  if (/szk[łl]/.test(t)) return "GLASS";
  if (/bio|zielon|organik|kuchenn/.test(t)) return "BIO";
  if (/zmiesz|niesegreg|komunal/.test(t)) return "MIXED";
  return undefined;
}

const WEEKDAY_KEYS: Record<string, number> = {
  poniedzialek: 1,
  wtorek: 2,
  sroda: 3,
  srode: 3,
  czwartek: 4,
  piatek: 5,
};

function foldPl(value: string): string {
  return value
    .toLocaleLowerCase("pl-PL")
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Dzień tygodnia z tekstu („jutro”, „we wtorek”, „w poniedziałek”). */
export function parseLessonDay(text: string): LessonDay {
  const folded = foldPl(text);
  if (/pojutrze/.test(folded)) return { kind: "offset", days: 2 };
  if (/\bjutro\b/.test(folded)) return { kind: "offset", days: 1 };
  if (/przedwczoraj/.test(folded)) return { kind: "offset", days: -2 };
  if (/\bwczoraj\b/.test(folded)) return { kind: "offset", days: -1 };
  for (const [key, day] of Object.entries(WEEKDAY_KEYS)) {
    if (folded.includes(key)) return { kind: "weekday", day };
  }
  if (/weekend|sobot|niedziel/.test(folded)) return { kind: "weekday", day: 6 };
  return { kind: "today" };
}

/**
 * Kandydat na imię dziecka („ile lekcji ma Lena”, „kiedy kończy Tomek”,
 * „plan lekcji Leny”). Dopasowanie rozmyte do znanych imion robi
 * `handleUserCommand` — tu zwracamy surowy fragment lub `null`.
 */
export function parseLessonChild(text: string): string | null {
  // Wzorce szczegółowe (imie po frazie, z pominięciem słów-kluczy).
  const specific =
    text.match(/ile\s+lekcji\s+(?:ma\s+)?([\p{L}]{2,24})/iu) ??
    text.match(/(?:ma|mają|maja)\s+lekcje\s+([\p{L}]{2,24})/iu) ??
    text.match(/(?:kończy|konczy)\s+([\p{L}]{2,24})/iu) ??
    text.match(/plan\s+lekcji\s+([\p{L}]{2,24})\s*[?.!]*$/iu) ??
    text.match(/lekcje\s+([\p{L}]{2,24})\s*[?.!]*$/iu);
  if (specific?.[1]) return specific[1].trim();
  const match = text.match(
    /(?:ma|mają|maja|kończy|konczy|lekcje|lekcji|lekcja|plan(?:u)?\s+lekcji?)\s+([\p{L}]{2,24})/iu,
  );
  const name = match?.[1]?.trim();
  if (!name) return null;
  // Odrzuć słowa-klucze złapane zamiast imienia („ma lekcje”, „plan lekcji”).
  if (/^(lekcj[eaie]|lekcja|szkoł[ay]|szkola|plan|planu|dziś|dzisiaj|jutro|pojutrze|wczoraj|tygodniu|domu)$/i.test(name)) {
    return null;
  }
  return name;
}

// ── Zadania / zakupy ─────────────────────────────────────────────
// "dodaj zadanie …", "dopisz …", "kup …", "kupić …", "zrób …"
const TASK_PREFIX =
  /^(?:dodaj(?:cie)?|dopisz(?:cie)?|dopisać|utw[oó]rz|stw[oó]rz|zapisz(?:cie)?|przypnij|zr[oó]b(?:cie)?|kup(?:cie)?|kupi[ćc]|weź|wez)\s+(?:nowe?\s+|nowa?\s+)?(?:zadani[ea]\s*:?\s*|(?:do\s+kupienia|na\s+zakupy|na\s+liście|na\s+liscie|do\s+listy)\s*:?\s*)?(.+)/i;

const TASK_DONE =
  /^(?:oznacz|odznacz|odhacz|wykonano|zrobione|zalicz|ukończ|ukoncz)\b(.+)/i;

// ── Notatki ──────────────────────────────────────────────────────
// "notatka …", "zanotuj …", "zapisz notatkę …"
const NOTE_PREFIX =
  /^(?:pros[źz]\s+o\s+|zr[oó]b\s+|przypnij\s+|stw[oó]rz\s+|dodaj\s+|zapisz\s+|utw[oó]rz\s+|zanotuj\s+)?notatk[ęeia]\s*:?\s*(.+)/i;

const NOTE_VERB =
  /^(?:zanotuj(?:cie)?|zapisz(?:cie)?\s+notatk[ęe]|zapami[eę]taj(?:cie)?|przypnij(?!\s+zadani[ea]\b))\s*:?\s*(.+)/i;

/**
 * Parsuje tekst użytkownika (z klawiatury lub z Web Speech API)
 * do deterministycznego zamiaru. Zwraca `null`, gdy tekst wymaga AI.
 */
export function parseLocalCommand(raw: string): LocalIntent | null {
  const text = clean(raw);
  if (!text || text.length > 1200) return null;
  const t = lower(text);

  // 0. Radio / muzyka — przed wszystkim (np. „wyłącz” vs „włącz”).
  if (/^(pauza|pauzuj|stop)\b/.test(t)) {
    return { kind: "radioStop" };
  }
  if (/wyłącz|wylacz|zatrzymaj|stop|pauz|wstrzymaj|cisza|ucisz/.test(t) && /radi|muzy|dzwiek|dźwięk|odtwarza|granie/.test(t)) {
    return { kind: "radioStop" };
  }
  if (/głośniej|glosniej|podgłoś|podglos|pogłośnij|poglosnij/.test(t)) {
    return { kind: "volumeUp" };
  }
  if (/ciszej|ścisz|scisz|przycisz|wycisz|przycisz/.test(t)) {
    return { kind: "volumeDown" };
  }
  {
    const station = matchRadioStation(text);
    const wantsRadio = /włącz|wlacz|zagraj|graj|odtwórz|odtworz|puść|pusc|nastaw|przełącz|przelacz/.test(t);
    if (station && (wantsRadio || /radi|muzy|stacj|fm|357/.test(t))) {
      return { kind: "radioPlay", stationId: station.id };
    }
    if (wantsRadio && /radi|muzy|dzwiek|dźwięk|stacj/.test(t)) {
      return { kind: "radioPlay", stationId: null };
    }
    if (/^graj\b/.test(t)) {
      return { kind: "radioPlay", stationId: station?.id ?? null };
    }
  }

  // 1. Notatki — najpierw, bo "zapisz notatkę" zawiera też czasownik zadań.
  const noteMatch = text.match(NOTE_PREFIX) ?? text.match(NOTE_VERB);
  if (noteMatch?.[1]) {
    const content = clean(noteMatch[1].replace(/\s+dla\s+[\p{L}\s]{1,40}$/iu, ""));
    if (content.length >= 1 && content.length <= 360) {
      const titleMatch = text.match(/z\s+tytułem\s+(.+?)(?:\s+i\s+tre[ćs]|\s*$)/i);
      return { kind: "addNote", content, title: titleMatch?.[1]?.trim().slice(0, 80) || null };
    }
  }

  // 2. Oznaczanie zadań jako wykonane ("oznacz mleko jako zrobione").
  const doneMatch = text.match(TASK_DONE);
  if (doneMatch) {
    const rest = clean(doneMatch[1].replace(/^zadani[ea]\s*:?\s*/i, ""));
    const titleMatch =
      rest.match(/(.+?)\s+jako\s+(?:wykonane|zrobione|ukończone|gotowe)/i) ??
      rest.match(/["„“](.+?)["”"]/);
    const title = clean(titleMatch?.[1] ?? rest.replace(/^(że|iż)\s+/i, ""));
    if (title.length >= 2 && title.length <= 140 && !/^(że|iż)$/i.test(title)) {
      const completed = !/odznacz|niewykonane|niezrobione|cofni/i.test(rest);
      return { kind: "completeTask", title, completed };
    }
  }

  // 3. Nowe zadania / zakupy — ale nie wpisy godzin ("zapisz 7,5 h pracy").
  const workLogLike =
    /pracowa[łl]|przepracowa|godzin\w*\s+pracy|\bh\s+pracy/.test(t) && parseHoursAmount(text) !== undefined;
  const taskMatch = workLogLike ? null : text.match(TASK_PREFIX);
  const looksLikeTask =
    taskMatch &&
    // Samo "kup" bez dopełnienia to za mało — odrzuć bardzo krótkie ogony.
    taskMatch[1] !== undefined &&
    clean(taskMatch[1]).length >= 2;
  // Słowa-klucze zakupowe łapią też zdania bez czasownika na początku ("mleko — kup").
  const shoppingKeyword = /lista zakup|zakupy|do kupienia/.test(t);
  if (looksLikeTask) {
    let title = clean(taskMatch![1].replace(/\s+dla\s+[\p{L}\s]{1,40}$/iu, ""));
    // "kup mleko dla Leny" → tytuł "mleko", właściciel "Leny".
    title = clean(title.replace(/^(?:zadani[ea]|zakupy)\s*:?\s*/i, ""));
    // "dopisz chleb do listy" → tytuł "chleb".
    title = clean(title.replace(/\s+(?:do\s+listy|na\s+list[ęe])$/i, ""));
    if (title.length >= 2 && title.length <= 140) {
      return { kind: "addTask", title, assignedTo: extractOwner(text) };
    }
  } else if (shoppingKeyword) {
    const title = clean(text.replace(/^(?:dodaj|dopisz|zapisz)\s+(?:do|na)\s+/i, ""));
    if (title.length >= 4 && title.length <= 140) {
      return { kind: "addTask", title, assignedTo: extractOwner(text) };
    }
  }

  // 4. Godziny pracy — zapis ("pracowałem 8h", "przepracowałem od 8:00 do 16:00").
  const workVerb = /pracowa[łl](?:e[śsm]|am)?|przepracowa|godzin\w*\s+pracy|h\s+pracy|nadgodzin/.test(t);
  const range = parseRange(text);
  const hours = parseHoursAmount(text);
  if (range || (hours !== undefined && (workVerb || /\d/.test(text)))) {
    // Czyste pytanie ("ile godzin…?") bez liczby to odczyt, nie zapis.
    const isQuestion = /^(ile|jaki|podaj|pokaż|pokaz|podsumuj|suma)\b/.test(t) && hours === undefined && !range;
    if (!isQuestion && (range || hours !== undefined)) {
      const note = text.match(/(?:—|–|-|\bprzy\b|\bnad\b|,)\s*([\p{L}\p{N}][\p{L}\p{N} .,-]{2,60})$/iu);
      return {
        kind: "logWork",
        ...(hours !== undefined ? { hours } : {}),
        ...(range ? { startTime: range.startTime, endTime: range.endTime } : {}),
        note: note?.[1]?.trim().slice(0, 180) || "Zapis głosowy · HomeDash",
      };
    }
  }

  // 5. Godziny pracy — odczyt ("ile godzin w tym tygodniu?").
  if (/ile godzin|godzin pracy|suma godzin|podsumuj.*godzin|przepracowa.*(tydzień|miesiąc|dziś|dzisiaj)/.test(t)) {
    return { kind: "workSummary", period: parseWorkPeriod(text) };
  }

  // 6. Śmieci / harmonogram ("kiedy śmieci", "wywóz śmieci", "czy dzisiaj bio").
  if (
    /kiedy\s+(?:s[ąa]|jest|b[ęe]dzie).*śmieci|wyw[oó]z|wystawi|śmieci|smieci|odpad|odbiór|odbior|plastik|metal|szk[łl]o|bio|zmiesz/.test(
      t,
    )
  ) {
    // "czy dzisiaj bio" → pytanie o frakcję BIO na dziś.
    const fraction = parseWasteFraction(text);
    return { kind: "wasteQuery", ...(fraction ? { fraction } : {}) };
  }

  // 7. Plan lekcji („o której kończy Lena”, „ile lekcji ma Tomek”, „plan lekcji”).
  // Dane są w pamięci dashboardu — odpowiedź w milisekundy, bez AI.
  // Detekcja rodzaju na tekście bez ogonków: dyktowanie (STT) często zwraca
  // „o ktorej konczy” zamiast „o której kończy” — obie formy muszą działać.
  if (/lekcj|kończy|konczy|szkoł|szkol|szkola/.test(t)) {
    const day = parseLessonDay(text);
    const child = parseLessonChild(text);
    const f = foldPl(text);
    if (/o\s+ktor|do\s+ktor|kiedy\s+konczy|kiedy\s+koniec|do\s+kiedy/.test(f)) {
      return { kind: "lessonEnd", child, day };
    }
    if (/ile\s+lekcji|ile\s+ma\s+lekcji|ile\s+zajec/.test(f)) {
      return { kind: "lessonCount", child, day };
    }
    if (/plan\s+lekcji|plan\s+lekcj|rozklad\s+lekcji|rozklad|co\s+ma\s+w\sskole|co\s+ma\s+jutro/.test(f)) {
      return { kind: "lessonPlan", child, day };
    }
  }

  // 8. Autobusy („kiedy autobus”, „o której odjeżdża”, „rozkład jazdy”).
  if (/autobus|odjazd|rozkład\s+jazdy|rozklad\s+jazdy|przystan|mpk|zkm|tramwaj/.test(t)) {
    const stopMatch = text.match(/(?:z|ze|na|przystan(?:ek|ku))\s+([\p{L}\p{N}][\p{L}\p{N} .\-]{1,60})/iu);
    const stop = stopMatch?.[1]?.trim().replace(/[,.:;]+$/, "") || null;
    // „z” jako przyimek samotny to za mało — wymagaj min. 3 znaków nazwy.
    return { kind: "busQuery", stop: stop && stop.length >= 3 ? stop.slice(0, 60) : null };
  }

  return null;
}

/** Mapuje zamiar na etykietę źródła pokazywaną w UI (⚡ lokalnie). */
export function intentSource(intent: LocalIntent): LocalSource {
  switch (intent.kind) {
    case "addTask":
    case "completeTask":
      return "local-task";
    case "logWork":
    case "workSummary":
      return "local-work";
    case "wasteQuery":
      return "local-waste";
    case "addNote":
      return "local-note";
    case "radioPlay":
    case "radioStop":
    case "volumeUp":
    case "volumeDown":
      return "local-radio";
    case "lessonEnd":
    case "lessonCount":
    case "lessonPlan":
      return "local-lessons";
    case "busQuery":
      return "local-bus";
  }
}

