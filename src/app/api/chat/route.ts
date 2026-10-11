import { stepCountIs, streamText } from "ai";
import { NextRequest } from "next/server";
import {
  MAX_STEPS,
  buildChatSystemPrompt,
  createHomeTools,
  runLocalCommand,
} from "@/lib/assistant-engine";
import { resolveModelCandidates } from "@/lib/ai-providers";
import { isKeyRotatableError } from "@/lib/ai/openrouter-key";
import { ensureSchema } from "@/db/migrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingMessage = { role?: unknown; content?: unknown };

function normalizeMessages(body: Record<string, unknown>): Array<{ role: "user" | "assistant"; content: string }> {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];

  const history = Array.isArray(body.history) ? body.history : [];
  for (const item of history.slice(-10)) {
    if (!item || typeof item !== "object") continue;
    const entry = item as IncomingMessage;
    if ((entry.role !== "user" && entry.role !== "assistant") || typeof entry.content !== "string") continue;
    const content = entry.content.trim().slice(0, 1200);
    if (content) out.push({ role: entry.role, content });
  }

  const single = typeof body.message === "string" ? body.message.trim().slice(0, 1200) : "";
  if (single) out.push({ role: "user", content: single });

  if (out.length === 0 && Array.isArray(body.messages)) {
    for (const item of body.messages.slice(-10)) {
      if (!item || typeof item !== "object") continue;
      const entry = item as IncomingMessage;
      if ((entry.role !== "user" && entry.role !== "assistant") || typeof entry.content !== "string") continue;
      const content = entry.content.trim().slice(0, 1200);
      if (content) out.push({ role: entry.role, content });
    }
  }

  return out;
}

/**
 * Strumieniowany czat asystenta domowego (AI Fallback).
 *
 * Krok 1 (Local-First): prosta komenda z polskiego słownika jest
 * obsługiwana synchronicznie, bez kosztów modelu.
 * Krok 2: w przeciwnym razie strumień z pierwszego dostępnego
 * dostawcy (OpenRouter / Groq wg `AI_PROVIDER_ORDER`).
 *
 * Kluczowe: `stopWhen: stepCountIs(MAX_STEPS)` — bez warunku zatrzymania model
 * wykonuje jedynie jeden krok (wywołanie narzędzia) i nigdy nie dopisuje
 * odpowiedzi do użytkownika. To odpowiednik `maxSteps: 5` z AI SDK v4.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const messages = normalizeMessages(body);
    if (messages.length === 0) {
      return Response.json({ error: "Wiadomość jest pusta." }, { status: 400 });
    }

    await ensureSchema();

    // Local-First: szybka odpowiedź bez modelu, gdy tekst pasuje do słownika.
    const lastUser = [...messages].reverse().find((entry) => entry.role === "user")?.content ?? "";
    const fastTracker: { used: string[] } = { used: [] };
    const fast = await runLocalCommand(lastUser, fastTracker).catch(() => null);
    if (fast) {
      return Response.json({ reply: fast.reply, source: "local", toolsUsed: fastTracker.used });
    }

    const candidates = resolveModelCandidates();
    if (candidates.length === 0) {
      return Response.json(
        {
          error: "Brak kluczy OPENROUTER_API_KEY / GROQ_API_KEY — tryb pełnej rozmowy AI jest wyłączony.",
        },
        { status: 503 },
      );
    }

    const tools = createHomeTools();
    let lastError: unknown = null;

    // Kandydaci zawierają już rotację kluczy OpenRouter dla tego żądania
    // (Round-Robin + fallback przy 429/401 — patrz `lib/ai/openrouter-key`).
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i] as (typeof candidates)[number];
      const keySuffix = candidate.keyIndex ? `, klucz #${candidate.keyIndex}` : "";
      try {
        const result = streamText({
          model: candidate.model,
          // Wielofunkcyjny asystent: operacje domowe przez tools,
          // wiedza ogólna i pogawędki bezpośrednio tekstem po polsku.
          system: buildChatSystemPrompt(),
          messages,
          tools,
          // Wieloetapowość: narzędzie → wynik → finalna odpowiedź tekstowa.
          stopWhen: stepCountIs(MAX_STEPS),
          temperature: 0.4,
          maxOutputTokens: 1200,
          onError({ error }) {
            console.error(`Chat stream error (${candidate.provider}:${candidate.modelId}${keySuffix})`, error);
          },
        });

        return result.toUIMessageStreamResponse({
          sendReasoning: false,
          sendSources: false,
        });
      } catch (error) {
        lastError = error;
        console.error(`Chat start failed (${candidate.provider}:${candidate.modelId}${keySuffix})`, error);
        if (!isKeyRotatableError(error)) {
          // Błąd zapytania/modelu, nie limitu — ten sam model na innym kluczu
          // da identyczny błąd, więc przeskocz do kolejnego modelu/dostawcy.
          let next = candidates[i + 1];
          while (next && next.provider === candidate.provider && next.modelId === candidate.modelId) {
            i++;
            next = candidates[i + 1];
          }
        }
      }
    }

    const detail = lastError instanceof Error ? lastError.message : "nieznany błąd";
    return Response.json({ error: `Asystent AI jest niedostępny: ${detail}` }, { status: 502 });
  } catch (error) {
    console.error("Chat request failed", error);
    const message = error instanceof Error ? error.message : "Nie udało się uruchomić czatu.";
    return Response.json({ error: message }, { status: 500 });
  }
}
