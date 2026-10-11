import { generateText, stepCountIs } from "ai";
import { NextRequest } from "next/server";
import {
  MAX_STEPS,
  buildChatSystemPrompt,
  createHomeTools,
  hasAssistantProvider,
  humanizeReply,
  recoverJsonReply,
  runLocalCommand,
} from "@/lib/assistant-engine";
import { resolveModelCandidates } from "@/lib/ai-providers";
import { isKeyRotatableError } from "@/lib/ai/openrouter-key";
import { ensureSchema } from "@/db/migrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatEntry = { role: "user" | "assistant"; content: string };

const MUTATING_TOOLS = new Set(["addTask", "setTaskDone", "logWorkHours", "addNote"]);

function readBody(body: Record<string, unknown>) {
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 1200) : "";

  const history: ChatEntry[] = [];
  if (Array.isArray(body.history)) {
    for (const item of body.history.slice(-10)) {
      if (!item || typeof item !== "object") continue;
      const entry = item as { role?: unknown; content?: unknown };
      if ((entry.role !== "user" && entry.role !== "assistant") || typeof entry.content !== "string") continue;
      const content = entry.content.trim().slice(0, 1200);
      if (content) history.push({ role: entry.role, content });
    }
  }

  if (message && history.at(-1)?.content !== message) {
    history.push({ role: "user", content: message });
  }

  return { message, history };
}

/**
 * Hybrydowy procesor komend (Local-First + AI Fallback):
 *   krok 1 — lokalny parser (szybki regex / polski słownik, zero kosztów AI),
 *   krok 2 — dopiero gdy parser zwróci `null`, model z Tool Calling.
 *
 * Pętla idzie po kandydatach multi-provider (OpenRouter → Groq zgodnie
 * z `AI_PROVIDER_ORDER` i kluczami w `.env`): awaria jednego kandydata
 * (guardrail, limit, zły klucz) nie blokuje próby z następnym.
 */
async function runAssistant(history: ChatEntry[]) {
  const candidates = resolveModelCandidates();
  let lastError: unknown = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i] as (typeof candidates)[number];
    const keySuffix = candidate.keyIndex ? ` (klucz #${candidate.keyIndex})` : "";
    const tracker: { used: string[] } = { used: [] };
    try {
      const { text, toolCalls, toolResults } = await generateText({
        model: candidate.model,
        // Wielofunkcyjny asystent: operacje domowe przez tools,
        // wiedza ogólna i pogawędki bezpośrednio tekstem po polsku.
        system: buildChatSystemPrompt(),
        messages: history,
        tools: createHomeTools(tracker),
        // Kluczowe: bez warunku zatrzymania wykonany byłby tylko jeden krok
        // (wywołanie narzędzia) bez finalnej odpowiedzi dla użytkownika.
        stopWhen: stepCountIs(MAX_STEPS),
        temperature: 0.4,
        maxOutputTokens: 1000,
      });

      // Model potrafi zwrócić JSON zamiast wywołać narzędzie — wtedy zapis
      // wykonywany jest po stronie serwera, żeby dane faktycznie trafiły do bazy.
      const recovered = await recoverJsonReply(text.trim(), tracker);
      const reply = humanizeReply(recovered.reply);
      if (!reply) {
        throw new Error("Model zwrócił pustą odpowiedź.");
      }

      return {
        reply,
        provider: candidate.provider,
        modelId: candidate.modelId,
        toolsUsed: tracker.used,
        toolCalls: toolCalls.length,
        toolResults: toolResults.length,
        mutated: tracker.used.some((name) => MUTATING_TOOLS.has(name)),
      };
    } catch (error) {
      lastError = error;
      console.error(`Assistant run failed for ${candidate.provider}:${candidate.modelId}${keySuffix}`, error);
      if (!isKeyRotatableError(error)) {
        // Błąd zapytania/modelu (np. 400/404), nie limitu — ten sam model na
        // innym kluczu da identyczny błąd, więc przeskocz do kolejnego modelu.
        let next = candidates[i + 1];
        while (next && next.provider === candidate.provider && next.modelId === candidate.modelId) {
          i++;
          next = candidates[i + 1];
        }
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Nie udało się uruchomić asystenta.");
}

function hintFor(detail: string): string {
  if (/guardrail/i.test(detail)) {
    return "Model OpenRoutera blokuje filtr bezpieczeństwa Twojego konta — wyłącz go w ustawieniach workspace: https://openrouter.ai/workspaces/default/guardrails";
  }
  if (/rate limit|free-models|429/.test(detail)) {
    return "Wyczerpał się limit darmowych zapytań — doładuj konto OpenRouter, ustaw inny OPENROUTER_MODEL albo dodaj klucz GROQ_API_KEY jako dostawcę zapasowego.";
  }
  if (/401|403|invalid api key|invalid_api_key/i.test(detail)) {
    return "Klucz API (OPENROUTER_API_KEY lub GROQ_API_KEY) jest nieprawidłowy lub wygasł.";
  }
  if (/groq|llama/i.test(detail)) {
    return "Sprawdź klucz GROQ_API_KEY oraz model GROQ_MODEL (musi obsługiwać function calling, np. openai/gpt-oss-120b).";
  }
  return "Sprawdź klucze OPENROUTER_API_KEY / GROQ_API_KEY oraz modele OPENROUTER_MODEL / GROQ_MODEL (muszą obsługiwać function calling).";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const { message, history } = readBody(body);

    if (!message && history.length === 0) {
      return Response.json({ error: "Wpisz wiadomość do asystenta." }, { status: 400 });
    }

    await ensureSchema();
    const lastUserMessage = message || history.at(-1)?.content || "";

    // KROK 1 (Local-First): szybki polski słownik — zero kosztów AI,
    // odpowiedź w ułamku sekundy, niezależnie od dostępności modeli.
    const fastTracker: { used: string[] } = { used: [] };
    const fast = await runLocalCommand(lastUserMessage, fastTracker).catch(() => null);
    if (fast) {
      return Response.json({
        reply: fast.reply,
        source: "local",
        toolsUsed: fastTracker.used,
        mutated: fast.mutated,
      });
    }

    // KROK 2 (AI Fallback): brak kluczy → tryb lokalny z komunikatem.
    if (!hasAssistantProvider()) {
      return Response.json({
        reply:
          "Tryb AI z narzędziami jest wyłączony, bo brak kluczy OPENROUTER_API_KEY / GROQ_API_KEY. Zadania, godziny pracy i notatki możesz dodawać głosem albo z poziomu kafelków.",
        source: "local",
        toolsUsed: [],
        mutated: false,
      });
    }

    try {
      const result = await runAssistant(history);
      return Response.json({
        reply: result.reply,
        source: result.provider,
        model: result.modelId,
        toolsUsed: result.toolsUsed,
        mutated: result.mutated,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "nieznany błąd";
      console.error("Assistant failed after fallback", detail);

      // AI niedostępne mimo kluczy → ostatnia szansa lokalna (np. częściowy pars).
      const tracker: { used: string[] } = { used: [] };
      const local = await runLocalCommand(lastUserMessage, tracker).catch(() => null);
      if (local) {
        return Response.json({
          reply: local.reply,
          source: "local",
          toolsUsed: tracker.used,
          mutated: local.mutated,
          aiUnavailable: true,
        });
      }

      return Response.json(
        { error: `Asystent AI jest teraz niedostępny: ${detail} — ${hintFor(detail)}`, source: "error" },
        { status: 502 },
      );
    }
  } catch (error) {
    console.error("Assistant request failed", error);
    return Response.json({ error: "Nie udało się połączyć z asystentem." }, { status: 500 });
  }
}
