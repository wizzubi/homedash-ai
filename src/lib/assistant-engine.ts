import { createOpenAI } from "@ai-sdk/openai";
import { tool, type ToolSet } from "ai";
import { eq, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { documentReminders, garbageSchedules, notes, tasks, workLogs } from "@/db/schema";
import { ensureSchema } from "@/db/migrate";
import {
  OPENROUTER_FALLBACK_MODEL,
  hasAnyProvider,
  resolveModelCandidates,
} from "@/lib/ai-providers";
import { parseLocalCommand } from "@/lib/local-commands";
import { getOpenRouterKey } from "@/lib/ai/openrouter-key";

export const FALLBACK_MODEL = OPENROUTER_FALLBACK_MODEL;
export const MAX_STEPS = 5;

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const FRACTION_LABEL: Record<string, string> = {
  MIXED: "zmieszane",
  GLASS: "szkło",
  PLASTIC_METAL: "plastik i metal",
  BIO: "bio",
};
const FRACTIONS = Object.keys(FRACTION_LABEL);

type Outcome = { success: boolean; message: string } & Record<string, unknown>;

function failure(reason: string): Outcome {
  return { success: false, message: reason };
}

function localDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function startOfToday() {
  return localDay(new Date());
}

function startOfWeek(today = new Date()) {
  const date = localDay(today);
  const isoDay = today.getDay() === 0 ? 7 : today.getDay();
  date.setDate(date.getDate() - (isoDay - 1));
  return date;
}

function startOfMonth(today = new Date()) {
  return new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
}

function parseDay(value?: string) {
  if (!value) return startOfToday();
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDay(date: Date) {
  return date.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });
}

function minutesOf(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}

function hoursFromRange(startTime: string, endTime: string) {
  let diff = minutesOf(endTime) - minutesOf(startTime);
  if (diff <= 0) diff += 24 * 60;
  return roundHours(diff / 60);
}

/**
 * Rygorystyczny prompt systemowy: wymusza narzędzia przy zapisie i zakazuje
 * zmyślania danych z bazy.
 */
export function buildSystemPrompt(): string {
  const today = new Date();
  const days = ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"];
  return [
    "Jesteś asystentem domowym HomeDash — centrum dowodzenia domem polskiej rodziny. Odpowiadasz zawsze po polsku, ciepło i zwięźle (maksymalnie 3 zdania, chyba że użytkownik prosi o listę lub szczegóły).",
    "",
    "### ZASADA BEZWZGLĘDNA",
    "MASZ OBOWIĄZEK używać dostarczonych narzędzi (tools) do każdej operacji zapisywania, edycji lub tworzenia danych w bazie. Nigdy nie udawaj w tekście, że coś zapisałeś – jeśli użytkownik prosi o zmianę/dodanie danych, MUSISZ wywołać odpowiednie narzędzie techniczne!",
    "Zabronione jest pisanie „zapisano”, „dodałem”, „już to mam” lub „zaktualizowałem”, jeżeli narzędzie nie zostało wywołane. Najpierw narzędzie, dopiero potem zdanie potwierdzające na podstawie jego wyniku.",
    "",
    "### Odczyt danych",
    "Każde pytanie o fakty (godziny pracy, terminy wywozu odpadów, lista zadań, ważność dokumentów) realizujesz narzędziem do odczytu — nigdy nie zgadujesz. Jeśli narzędzie zwróci `success: false` lub pustą listę, mówisz o tym wprost i nie dopisujesz szczegółów.",
    "",
    "### Jak czytać wynik narzędzia",
    "Każde narzędzie zwraca `{ success, message, ... }`. Odnies się do pola `message`. Przy `success: false` przekaż użytkownikowi powód, bez obiecywania poprawy.",
    "",
    "### Nigdy nie wypisuj JSON-a",
    "Argumenty narzędzia przekazuj WYŁĄCZNIE mechanizmem wywołania narzędzi. W odpowiedzi dla użytkownika nigdy nie umieszczaj JSON-a, kodu, szablonu wywołania ani listy pól (np. `{ \"title\": ..., \"content\": ... }`) — to nie jest odpowiedź. Treść odpowiedzi to zawsze zwykłe polskie zdanie.",
    "",
    "### Wierność treści",
    "Treść zadania i notatki zapisuj WIERNIE — nie skracaj, nie przepisuj i nie tłumacz sformułowania użytkownika. „Stwórz notatkę: pamiętać o przeglądzie” ma trafić do bazy jako „pamiętać o przeglądzie”.",
    "",
    "### Dostępne narzędzia",
    "- `addTask` — nowe zadanie (np. „kupić mleko”)",
    "- `setTaskDone` — oznacz zadanie jako wykonane/niewykonane",
    "- `logWorkHours` — wpis godzin pracy",
    "- `addNote` — nowa notatka przypięta na tablicy",
    "- `listTasks` — bieżące zadania",
    "- `getWorkSummary` — sumy godzin (dzisiaj / tydzień / miesiąc)",
    "- `getNextWastePickup` — najbliższy odbiór danej frakcji",
    "- `getExpiringDocuments` — dokumenty wkrótce tracące ważność",
    "",
    "Wspomniane frakcje odpadów: MIXED (zmieszane), PLASTIC_METAL (plastik i metal), GLASS (szkło), BIO (bio).",
    "",
    "### Kontekst czasowy",
    `Dzisiaj jest ${today.toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" })}, ${days[today.getDay()]}. Tydzień liczy się od poniedziałku.`,
    "",
    "Nie wymyślaj pogody, prognoz ani wydarzeń — te dane pochodzą z widgetów, nie z modelu.",
  ].join("\n");
}

/**
 * Prompt dla endpointów czatu (`/api/chat`, `/api/assistant`):
 * bazowy rygor operacji domowych + swobodne odpowiadanie na wiedzę ogólną.
 *
 * TWOJE ZADANIA:
 * 1. OBSŁUGA DOMU: gdy użytkownik prosi o modyfikację lub odczyt danych
 *    domowych (zadania, godziny pracy, notatki, odpady, dokumenty),
 *    MUSISZ wywołać odpowiednie narzędzie (tool) — nigdy nie zgaduj.
 * 2. WIEDZA OGÓLNA I POGAWĘDKI: gdy użytkownik pyta o fakty ze świata,
 *    geografię, naukę, przeliczniki, przepisy lub luźno rozmawia
 *    (np. „Ilu mieszkańców ma Warszawa?”, „Jak zrobić ciasto na pizzę?”,
 *    „Przelicz 200 mil na kilometry”), odpowiadaj bezpośrednio zwięzłym,
 *    naturalnym i pomocnym tekstem po polsku — BEZ wywoływania narzędzi.
 * 3. Jeśli do odpowiedzi nie potrzebujesz narzędzia — po prostu odpowiedz
 *    wyczerpująco tekstem. Narzędzia służą wyłącznie danym domowym.
 *
 * Granica: bieżąca pogoda, prognozy i aktualne wydarzenia pochodzą
 * z widgetów — tych nie wymyślaj; przy takich pytaniach odeślij do panelu.
 */
export function buildChatSystemPrompt(): string {
  return [
    buildSystemPrompt(),
    "",
    "### Wiedza ogólna i pogawędki",
    "Pytania niewymagające danych domowych (fakty, geografia, nauka, matematyka i przeliczniki jednostek, przepisy kulinarne, luźna rozmowa) rozstrzygaj samodzielnie na podstawie własnej wiedzy — odpowiadaj po polsku, naturalnie i pomocnie, bez wywoływania jakichkolwiek narzędzi.",
    "Przykłady: „Podaj liczbę ludności Warszawy” → podajesz znaną liczbę z zastrzeżeniem roku danych; „Jak zrobić ciasto na pizzę?” → podajesz przepis krok po kroku; „Przelicz 200 mil na kilometry” → liczysz (200 mil × 1,60934 ≈ 321,87 km) i pokazujesz wynik.",
    "Przy odpowiedziach ogólnych nie obowiązuje limit 3 zdań — dopasuj długość do pytania (przepis lub wyliczenie mogą być dłuższe).",
  ].join("\n");
}

/** Zwraca model AI albo `null`, gdy brak klucza API (OpenRouter / Groq). */
export function createAssistantModel(modelId?: string) {
  const candidates = resolveModelCandidates();
  if (candidates.length === 0) return null;
  if (modelId) {
    const match = candidates.find((candidate) => candidate.modelId === modelId);
    if (match) return match.model;
  }
  return candidates[0].model;
}

export function resolveModelIds(): string[] {
  return resolveModelCandidates().map((candidate) =>
    candidate.provider === "openrouter" ? candidate.modelId : `groq:${candidate.modelId}`,
  );
}

/** Czy jakikolwiek dostawca AI (OpenRouter / Groq) jest skonfigurowany? */
export function hasAssistantProvider(): boolean {
  return hasAnyProvider();
}

// Zachowane dla kompatybilności — deleguje do rotowanego klienta OpenRouter
// (wielo-kluczowego, patrz `lib/ai-providers` i `lib/ai/openrouter-key`).
export function createOpenRouterClient() {
  return createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: getOpenRouterKey() || "",
    headers: {
      "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://homedash.local",
      "X-Title": "HomeDash AI",
    },
  });
}

/**
 * Buduje zestaw narzędzi. Każde wywołanie `execute` zapisuje realny rekord w
 * bazie (Turso / SQLite) przez Drizzle i zwraca czytelny komunikat statusu,
 * który model wykorzystuje do sformułowania odpowiedzi.
 */
export function createHomeTools(tracker?: { used: string[] }): ToolSet {
  const track = (name: string) => {
    if (tracker && !tracker.used.includes(name)) tracker.used.push(name);
  };

  return {
    addTask: tool({
      description: "Dodaje nowe zadanie do rodzinnej listy zadań w bazie danych.",
      inputSchema: z.object({
        title: z.string().min(2).max(140).describe("Treść zadania, np. „kupić mleko”"),
        assignedTo: z
          .string()
          .max(48)
          .optional()
          .describe("Komu przypisano zadanie, np. „Mama”, „Tata”, „Lena”. Pomiń, gdy dotyczy wszystkich."),
        dueDate: z
          .string()
          .optional()
          .describe("Termin wykonania w formacie YYYY-MM-DD. Pomiń, gdy brak terminu."),
      }),
      execute: async ({ title, assignedTo, dueDate }): Promise<Outcome> => {
        try {
          await ensureSchema();
          let due: Date | null = null;
          if (dueDate) {
            due = parseDay(dueDate);
            if (!due) return failure("Nieprawidłowy format daty terminu — użyj YYYY-MM-DD.");
          }
          const [row] = await db
            .insert(tasks)
            .values({ title: title.trim(), assignedTo: assignedTo?.trim() || null, dueDate: due, isCompleted: false })
            .returning();
          track("addTask");
          const owner = row.assignedTo ? ` (dla: ${row.assignedTo})` : "";
          const when = due ? `, termin ${formatDay(due)}` : "";
          return {
            success: true,
            message: `Zadanie „${row.title}”${owner} zostało dodane do bazy${when}.`,
            id: row.id,
          };
        } catch (error) {
          console.error("addTask failed", error);
          return failure("Nie udało się zapisać zadania w bazie danych.");
        }
      },
    }),

    setTaskDone: tool({
      description: "Oznacza istniejące zadanie jako wykonane lub niewykonane. Dopasowuje po fragmencie tytułu.",
      inputSchema: z.object({
        title: z.string().min(2).max(140).describe("Fragment tytułu zadania, które ma zostać zmienione"),
        completed: z.boolean().describe("true = wykonane, false = niewykonane"),
      }),
      execute: async ({ title, completed }): Promise<Outcome> => {
        try {
          await ensureSchema();
          const all = await db.select().from(tasks);
          const needle = title.trim().toLocaleLowerCase("pl-PL");
          const match = all.find((row) => row.title.toLocaleLowerCase("pl-PL").includes(needle));
          if (!match) {
            return failure(`Nie znaleziono zadania zawierającego „${title}”.`);
          }
          await db.update(tasks).set({ isCompleted: completed }).where(eq(tasks.id, match.id));
          track("setTaskDone");
          return {
            success: true,
            message: completed
              ? `Zadanie „${match.title}” oznaczyłam jako wykonane.`
              : `Zadanie „${match.title}” wróciło na listę otwartych.`,
            id: match.id,
          };
        } catch (error) {
          console.error("setTaskDone failed", error);
          return failure("Nie udało się zmienić statusu zadania.");
        }
      },
    }),

    logWorkHours: tool({
      description: "Zapisuje wpis godzin pracy. Możesz podać liczbę godzin albo zakres godzinowy — wtedy czas zostanie wyliczony.",
      inputSchema: z.object({
        hours: z
          .number()
          .min(0.05)
          .max(24)
          .optional()
          .describe("Liczba przepracowanych godzin, np. 8 lub 8.5. Podaj, gdy nie podajesz zakresu."),
        startTime: z.string().regex(CLOCK).optional().describe("Godzina rozpoczęcia w formacie HH:MM, np. 08:00"),
        endTime: z.string().regex(CLOCK).optional().describe("Godzina zakończenia w formacie HH:MM, np. 16:30"),
        note: z.string().max(180).optional().describe("Krótka notatka, np. nad czym pracowano"),
        date: z.string().optional().describe("Data wpisu YYYY-MM-DD. Domyślnie dzisiaj."),
      }),
      execute: async ({ hours, startTime, endTime, note, date }): Promise<Outcome> => {
        try {
          await ensureSchema();
          const day = parseDay(date);
          if (!day) return failure("Nieprawidłowa data wpisu — użyj YYYY-MM-DD.");

          let computed = hours;
          if ((computed === undefined || computed === null) && startTime && endTime) {
            computed = hoursFromRange(startTime, endTime);
          }
          if (computed === undefined || computed === null) {
            return failure("Podaj liczbę godzin albo zakres od–do, żebym mogła policzyć czas pracy.");
          }
          if (computed <= 0 || computed > 24) {
            return failure(`Liczba godzin (${computed}) jest poza zakresem 0.05–24.`);
          }

          const [row] = await db
            .insert(workLogs)
            .values({
              date: day,
              hours: roundHours(computed),
              startTime: startTime || null,
              endTime: endTime || null,
              note: note?.trim() || null,
            })
            .returning();
          track("logWorkHours");
          return {
            success: true,
            message: `Zapisałam ${String(roundHours(computed)).replace(".", ",")} h pracy za ${formatDay(day)} w bazie.`,
            id: row.id,
            hours: roundHours(computed),
          };
        } catch (error) {
          console.error("logWorkHours failed", error);
          return failure("Nie udało się zapisać godzin pracy w bazie.");
        }
      },
    }),

    addNote: tool({
      description: "Tworzy nową notatkę na rodzinnej tablicy i przypina ją na ekranie głównym.",
      inputSchema: z.object({
        content: z.string().min(1).max(360).describe("Treść notatki"),
        title: z.string().max(80).optional().describe("Krótki tytuł, np. „Dziś pamiętaj”"),
        color: z
          .enum(["amber", "mint", "sky", "violet", "rose"])
          .optional()
          .describe("Kolor przypinki. Domyślnie amber."),
      }),
      execute: async ({ content, title, color }): Promise<Outcome> => {
        try {
          await ensureSchema();
          const [row] = await db
            .insert(notes)
            .values({ title: title?.trim() || null, content: content.trim(), color: color || "amber", isPinned: true })
            .returning();
          track("addNote");
          return { success: true, message: `Notatka „${row.content.slice(0, 60)}” jest przypięta na tablicy.`, id: row.id };
        } catch (error) {
          console.error("addNote failed", error);
          return failure("Nie udało się zapisać notatki.");
        }
      },
    }),

    listTasks: tool({
      description: "Zwraca zadania domu — domyślnie tylko niewykonane.",
      inputSchema: z.object({
        includeCompleted: z.boolean().optional().describe("Czy uwzględnić zadania wykonane. Domyślnie false."),
        limit: z.number().min(1).max(50).optional().describe("Maksymalna liczba zadań. Domyślnie 20."),
      }),
      execute: async ({ includeCompleted, limit }): Promise<Outcome> => {
        try {
          await ensureSchema();
          const all = await db.select().from(tasks);
          const filtered = (includeCompleted ? all : all.filter((row) => !row.isCompleted))
            .sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted))
            .slice(0, limit || 20);
          track("listTasks");
          if (filtered.length === 0) {
            return { success: true, message: "Na liście nie ma żadnych zadań w tym filtrze.", items: [] };
          }
          return {
            success: true,
            message: `Znaleziono ${filtered.length} zadań.`,
            items: filtered.map((row) => ({
              title: row.title,
              assignedTo: row.assignedTo,
              completed: row.isCompleted,
              dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
            })),
          };
        } catch (error) {
          console.error("listTasks failed", error);
          return failure("Nie udało się odczytać zadań.");
        }
      },
    }),

    getWorkSummary: tool({
      description: "Sumuje przepracowane godziny za dzisiaj, bieżący tydzień (od poniedziałku) lub bieżący miesiąc.",
      inputSchema: z.object({
        period: z.enum(["today", "week", "month"]).describe("Zakres: today = dzisiaj, week = tydzień, month = miesiąc"),
      }),
      execute: async ({ period }): Promise<Outcome> => {
        try {
          await ensureSchema();
          const rows = await db.select().from(workLogs);
          const today = new Date();
          const from = period === "today" ? startOfToday() : period === "week" ? startOfWeek(today) : startOfMonth(today);
          const to = period === "today" ? startOfToday().getTime() + 86_400_000 : new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
          const inRange = rows.filter((row) => row.date.getTime() >= from.getTime() && row.date.getTime() < to);
          const total = roundHours(inRange.reduce((sum, row) => sum + row.hours, 0));
          const label = period === "today" ? "dzisiaj" : period === "week" ? "w tym tygodniu" : "w tym miesiącu";
          track("getWorkSummary");
          if (inRange.length === 0) {
            return { success: true, message: `Brak wpisów godzin pracy ${label}.`, hours: 0, entries: 0 };
          }
          return {
            success: true,
            message: `Zapisano ${String(total).replace(".", ",")} h ${label} w ${inRange.length} wpisach.`,
            hours: total,
            entries: inRange.length,
          };
        } catch (error) {
          console.error("getWorkSummary failed", error);
          return failure("Nie udało się odczytać godzin pracy.");
        }
      },
    }),

    getNextWastePickup: tool({
      description: "Podaje najbliższy termin odbioru odpadów z harmonogramu domu (od dziś włącznie).",
      inputSchema: z.object({
        fraction: z
          .enum(["MIXED", "GLASS", "PLASTIC_METAL", "BIO"])
          .optional()
          .describe("Frakcja: MIXED = zmieszane, PLASTIC_METAL = plastik i metal, GLASS = szkło, BIO = bio. Pomiń, by podać najbliższy odbiór dowolnej frakcji."),
      }),
      execute: async ({ fraction }): Promise<Outcome> => {
        try {
          await ensureSchema();
          const rows = await db.select().from(garbageSchedules);
          const today = startOfToday();
          const upcoming = rows
            .filter((row) => row.pickupDate.getTime() >= today.getTime())
            .filter((row) => !fraction || row.fraction === fraction)
            .sort((a, b) => a.pickupDate.getTime() - b.pickupDate.getTime());
          track("getNextWastePickup");
          if (upcoming.length === 0) {
            return {
              success: true,
              message: fraction
                ? `W harmonogramie nie ma zaplanowanego odbioru frakcji ${FRACTION_LABEL[fraction] ?? fraction}.`
                : "Harmonogram odbioru odpadów jest pusty.",
              found: false,
            };
          }
          const next = upcoming[0];
          const diffDays = Math.round((localDay(next.pickupDate).getTime() - today.getTime()) / 86_400_000);
          const when = diffDays === 0 ? "dzisiaj" : diffDays === 1 ? "jutro" : `za ${diffDays} dni`;
          return {
            success: true,
            message: `Najbliższy odbiór: ${FRACTION_LABEL[next.fraction] ?? next.fraction} — ${formatDay(next.pickupDate)} (${when}).`,
            fraction: next.fraction,
            pickupDate: next.pickupDate.toISOString().slice(0, 10),
            inDays: diffDays,
            found: true,
          };
        } catch (error) {
          console.error("getNextWastePickup failed", error);
          return failure("Nie udało się odczytać harmonogramu odpadów.");
        }
      },
    }),

    getExpiringDocuments: tool({
      description: "Lista dokumentów, przeglądów i ubezpieczeń, które kończą się w określonym czasie.",
      inputSchema: z.object({
        withinDays: z.number().min(0).max(730).optional().describe("Liczba dni do przodu. Domyślnie 30."),
      }),
      execute: async ({ withinDays }): Promise<Outcome> => {
        try {
          await ensureSchema();
          const horizon = withinDays ?? 30;
          const limit = new Date();
          limit.setHours(23, 59, 59, 999);
          limit.setDate(limit.getDate() + horizon);
          const rows = await db
            .select()
            .from(documentReminders)
            .where(lte(documentReminders.expirationDate, limit));
          const sorted = rows.sort((a, b) => a.expirationDate.getTime() - b.expirationDate.getTime());
          track("getExpiringDocuments");
          if (sorted.length === 0) {
            return { success: true, message: `Żaden dokument nie traci ważności w ciągu ${horizon} dni.`, items: [] };
          }
          const today = startOfToday().getTime();
          return {
            success: true,
            message: `W ciągu ${horizon} dni ważność traci ${sorted.length} pozycji.`,
            items: sorted.map((row) => ({
              title: row.title,
              category: row.category,
              expirationDate: row.expirationDate.toISOString().slice(0, 10),
              daysLeft: Math.ceil((localDay(row.expirationDate).getTime() - today) / 86_400_000),
            })),
          };
        } catch (error) {
          console.error("getExpiringDocuments failed", error);
          return failure("Nie udało się odczytać dokumentów.");
        }
      },
    }),
  };
}

/**
 * Wyłuskuje obiekt JSON z odpowiedzi modelu. Modele potrafią zamiast wywołania
 * narzędzia zwrócić jego argumenty jako zwykły tekst (lub w bloku ```json) —
 * wtedy zapis do bazy nigdy by nie powstał.
 */
export function extractJsonPayload(text: string): Record<string, unknown> | null {
  const withoutFences = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const slice = withoutFences.slice(start, end + 1);
  if (slice.length > 4000) return null;
  try {
    const parsed = JSON.parse(slice) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

type RecoverableTool = "addNote" | "addTask" | "logWorkHours";

/** Rozpoznaje, któremu narzędziu odpowiada zwrócony JSON. */
export function detectToolFromPayload(payload: Record<string, unknown>): { name: RecoverableTool; args: Record<string, unknown> } | null {
  const str = (value: unknown) => (typeof value === "string" ? value : undefined);
  const content = str(payload.content);
  const title = str(payload.title);
  const hours = typeof payload.hours === "number" ? payload.hours : undefined;
  const startTime = str(payload.startTime);
  const endTime = str(payload.endTime);

  if (content && content.trim()) {
    return { name: "addNote", args: { content: content.trim(), title: str(payload.title), color: str(payload.color) } };
  }
  if (hours !== undefined || (startTime && endTime)) {
    return { name: "logWorkHours", args: { hours, startTime, endTime, note: str(payload.note), date: str(payload.date) } };
  }
  if (title && title.trim()) {
    return { name: "addTask", args: { title: title.trim(), assignedTo: str(payload.assignedTo), dueDate: str(payload.dueDate) } };
  }
  return null;
}

/**
 * Sieć ratunkowa: gdy model NIE wywołał żadnego narzędzia, a jego odpowiedź
 * wygląda na argumenty narzędzia — wykonaj zapis po stronie serwera.
 */
export async function recoverJsonReply(
  reply: string,
  tracker: { used: string[] },
): Promise<{ handled: boolean; reply: string }> {
  const trimmed = reply.trim();
  const looksJson = trimmed.startsWith("{") || /^```json/i.test(trimmed);
  if (!looksJson || tracker.used.length > 0) return { handled: false, reply };

  const payload = extractJsonPayload(trimmed);
  if (!payload) return { handled: false, reply };

  const detected = detectToolFromPayload(payload);
  if (!detected) return { handled: false, reply };

  const tools = createHomeTools(tracker);
  const entry = tools[detected.name] as unknown as {
    execute?: (args: unknown, options: unknown) => Promise<unknown>;
  };
  if (typeof entry.execute !== "function") return { handled: false, reply };

  const raw = await entry.execute(detected.args, {});
  const result = (raw ?? {}) as { success?: boolean; message?: string };

  if (result.success && result.message) {
    if (!tracker.used.includes(detected.name)) tracker.used.push(detected.name);
    return { handled: true, reply: result.message };
  }
  return { handled: true, reply: result.message || "Nie udało się wykonać operacji na bazie danych." };
}

function localTools(tracker: { used: string[] }) {
  const tools = createHomeTools(tracker);
  return async (
    name: RecoverableTool | "setTaskDone" | "getNextWastePickup" | "getWorkSummary",
    args: Record<string, unknown>,
  ) => {
    const entry = tools[name] as unknown as {
      execute?: (args: unknown, options: unknown) => Promise<unknown>;
    };
    if (typeof entry.execute !== "function") return null;
    const raw = (await entry.execute(args, {})) ?? {};
    return raw as { success?: boolean; message?: string; hours?: number };
  };
}

/**
 * Deterministyczny fallback: gdy model AI jest niedostępny (limit zapytań,
 * guardrail, brak klucza), proste komendy domowe są obsługiwane lokalnie,
 * tak aby zapis do bazy zawsze się powiódł.
 *
 * Słownik (krok 1 hybrydowego procesora — zero kosztów AI):
 *  - zadania/zakupy: "dodaj zadanie", "dopisz", "kup", "kupić", "zrób"
 *  - godziny pracy:  "pracowałem", "przepracowałem", "godziny pracy", "h pracy"
 *  - śmieci:         "kiedy śmieci", "wywóz śmieci", "czy dzisiaj bio"
 *  - notatki:        "notatka", "zanotuj", "zapisz notatkę"
 */
export async function runLocalCommand(
  message: string,
  tracker: { used: string[] },
): Promise<{ reply: string; mutated: boolean } | null> {
  const trimmed = message.trim();
  if (!trimmed) return null;
  const intent = parseLocalCommand(trimmed);
  if (!intent) return null;
  const exec = localTools(tracker);

  switch (intent.kind) {
    case "addNote": {
      const result = await exec("addNote", {
        content: intent.content,
        title: intent.title || null,
        color: "amber",
      });
      if (result?.message) return { reply: result.message, mutated: Boolean(result.success) };
      return null;
    }
    case "addTask": {
      const result = await exec("addTask", { title: intent.title, assignedTo: intent.assignedTo });
      if (result?.message) return { reply: result.message, mutated: Boolean(result.success) };
      return null;
    }
    case "completeTask": {
      const result = await exec("setTaskDone", { title: intent.title, completed: intent.completed });
      if (result?.message) return { reply: result.message, mutated: Boolean(result.success) };
      return null;
    }
    case "logWork": {
      const result = await exec("logWorkHours", {
        ...(intent.hours !== undefined ? { hours: intent.hours } : {}),
        ...(intent.startTime ? { startTime: intent.startTime } : {}),
        ...(intent.endTime ? { endTime: intent.endTime } : {}),
        ...(intent.note ? { note: intent.note } : {}),
      });
      if (result?.message) return { reply: result.message, mutated: Boolean(result.success) };
      return null;
    }
    case "wasteQuery": {
      const result = await exec("getNextWastePickup", intent.fraction ? { fraction: intent.fraction } : {});
      if (result?.message) return { reply: result.message, mutated: false };
      return null;
    }
    case "workSummary": {
      const result = await exec("getWorkSummary", { period: intent.period });
      if (result?.message) return { reply: result.message, mutated: false };
      return null;
    }
  }
}

/** Ostateczna ochrona: użytkownik nigdy nie zobaczy surowego JSON-a. */
export function humanizeReply(reply: string): string {
  const trimmed = reply.trim();
  if (trimmed.startsWith("{") || /^```/i.test(trimmed)) {
    return "Nie udało się zapisać danych. Spróbuj sformułować polecenie jeszcze raz, np. „Dodaj zadanie: …”.";
  }
  return trimmed;
}


