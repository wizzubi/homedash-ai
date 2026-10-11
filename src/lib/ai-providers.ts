import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { getOpenRouterKeyRotation, getOpenRouterKeys } from "@/lib/ai/openrouter-key";

/**
 * HomeDash AI — warstwa dostawców modeli (AI Fallback, tylko w ostateczności).
 *
 * Lokalny parser (`parseLocalCommand` / `runLocalCommand`) obsługuje większość
 * komend domowych za darmo. Dopiero gdy zwróci `null`, endpointy `/api/chat`
 * i `/api/assistant` sięgają po tę warstwę.
 *
 * Wspierani dostawcy (wszyscy przez zgodny interfejs OpenAI):
 *   1. OpenRouter — `OPENROUTER_API_KEYS` (rotacja, Round-Robin) lub
 *      pojedynczy `OPENROUTER_API_KEY` (+ `OPENROUTER_MODEL`)
 *   2. Groq      — `GROQ_API_KEY` (+ `GROQ_MODEL`)
 *
 * Kolejność: `AI_PROVIDER_ORDER` (np. `"groq,openrouter"`) albo domyślnie
 * OpenRouter → Groq. Niedostępny dostawca (brak klucza) jest pomijany,
 * a błąd jednego kandydata nie blokuje próby z następnym.
 */

export type AIProviderName = "openrouter" | "groq";

export const OPENROUTER_FALLBACK_MODEL = "openai/gpt-4o-mini";
export const GROQ_FALLBACK_MODEL = "openai/gpt-oss-120b";

export type ModelCandidate = {
  provider: AIProviderName;
  modelId: string;
  model: LanguageModel;
  /** 1-based numer klucza OpenRouter w rotacji (diagnostyka, bez wartości klucza). */
  keyIndex?: number;
};

function cleanEnv(value?: string | null): string {
  return (value || "").trim().replace(/^"|"$/g, "");
}

function providerOrder(): AIProviderName[] {
  const raw = cleanEnv(process.env.AI_PROVIDER_ORDER).toLocaleLowerCase("pl-PL");
  if (raw) {
    const order = raw
      .split(/[,;\s]+/)
      .map((entry) => entry.trim())
      .filter((entry): entry is AIProviderName => entry === "openrouter" || entry === "groq");
    if (order.length > 0) return [...new Set(order)];
  }
  return ["openrouter", "groq"];
}

/**
 * Klient OpenRouter z jawnym kluczem. Bez argumentu sięga po następny klucz
 * z rotacji Round-Robin (`getOpenRouterKey`). Zwraca `null` bez kluczy.
 * Wywoływany przy każdym żądaniu — brak współdzielenia klientów między
 * zapytaniami, więc rotacja działa na świeżo za każdym razem.
 */
export function createOpenRouterClient(apiKey?: string) {
  const key = (apiKey ?? "").trim() || getOpenRouterKeys()[0] || "";
  if (!key) return null;
  return createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: key,
    headers: {
      "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://homedash.local",
      "X-Title": "HomeDash AI",
    },
  });
}

function createGroqClient() {
  const apiKey = cleanEnv(process.env.GROQ_API_KEY);
  if (!apiKey) return null;
  return createOpenAI({
    baseURL: "https://api.groq.com/openai/v1",
    apiKey,
    name: "groq",
    headers: { "X-Title": "HomeDash AI" },
  });
}

function modelIdsFor(provider: AIProviderName): string[] {
  if (provider === "openrouter") {
    const configured = cleanEnv(process.env.OPENROUTER_MODEL);
    return [...new Set([configured, OPENROUTER_FALLBACK_MODEL].filter(Boolean))];
  }
  const configured = cleanEnv(process.env.GROQ_MODEL);
  return [...new Set([configured, GROQ_FALLBACK_MODEL].filter(Boolean))];
}

/**
 * Lista kandydatów (modeli) w kolejności prób: dla każdego dostępnego
 * dostawcy najpierw model skonfigurowany w `.env`, potem model zastępczy.
 *
 * OpenRouter rozwija się na klucze (kolejność rotacji z bieżącego żądania,
 * model-major: preferowany model na wszystkich kluczach, potem zastępczy) —
 * dzięki temu błąd limitu (429/401) na jednym kluczu automatycznie przechodzi
 * na następny klucz tego samego modelu. Pusta lista = brak kluczy, działa
 * tylko tryb lokalny.
 */
export function resolveModelCandidates(): ModelCandidate[] {
  const candidates: ModelCandidate[] = [];
  for (const provider of providerOrder()) {
    if (provider === "openrouter") {
      const rotation = getOpenRouterKeyRotation();
      if (rotation.length === 0) continue;
      const allKeys = getOpenRouterKeys();
      for (const modelId of modelIdsFor(provider)) {
        for (const apiKey of rotation) {
          const client = createOpenRouterClient(apiKey);
          if (!client) continue;
          candidates.push({
            provider,
            modelId,
            model: client(modelId),
            keyIndex: allKeys.indexOf(apiKey) + 1,
          });
        }
      }
      continue;
    }
    const client = createGroqClient();
    if (!client) continue;
    for (const modelId of modelIdsFor(provider)) {
      candidates.push({ provider, modelId, model: client(modelId) });
    }
  }
  return candidates;
}

/** Czy jakikolwiek dostawca AI jest skonfigurowany (jest klucz API)? */
export function hasAnyProvider(): boolean {
  return Boolean(getOpenRouterKeys().length > 0 || cleanEnv(process.env.GROQ_API_KEY));
}

/** Status do logów / diagnostyki — bez zdradzania kluczy (tylko ich liczba). */
export function describeProviders(): Array<{
  provider: AIProviderName;
  configured: boolean;
  models: string[];
  keyCount: number;
}> {
  return (["openrouter", "groq"] as AIProviderName[]).map((provider) => ({
    provider,
    configured: Boolean(
      provider === "openrouter" ? getOpenRouterKeys().length > 0 : cleanEnv(process.env.GROQ_API_KEY),
    ),
    models: modelIdsFor(provider),
    keyCount: provider === "openrouter" ? getOpenRouterKeys().length : cleanEnv(process.env.GROQ_API_KEY) ? 1 : 0,
  }));
}
