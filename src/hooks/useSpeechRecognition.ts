"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SpeechStatus = "idle" | "listening" | "error";

type SpeechAlternative = { transcript: string };
type SpeechRecognitionResultLike = ArrayLike<SpeechAlternative> & { 0?: SpeechAlternative };
type SpeechRecognitionEventLike = { results: ArrayLike<SpeechRecognitionResultLike> };
type SpeechRecognitionErrorLike = { error: string };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as SpeechRecognitionWindow;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

type UseSpeechRecognitionOptions = {
  /** Język dyktowania — domyślnie polski, zgodnie z architekturą HomeDash. */
  lang?: string;
  /** Wywoływane z finalnym tekstem (klawiatura i głos trafiają do tej samej kolejki). */
  onFinalText?: (text: string) => void;
};

const FRIENDLY_ERRORS: Record<string, string> = {
  "not-allowed": "Zezwól przeglądarce na dostęp do mikrofonu.",
  "service-not-allowed": "Zezwól przeglądarce na dostęp do mikrofonu.",
  "no-speech": "Nic nie usłyszałam — spróbuj powiedzieć komendę jeszcze raz.",
  "audio-capture": "Nie wykryto mikrofonu na tym urządzeniu.",
  network: "Rozpoznawanie mowy wymaga połączenia z internetem.",
};

/**
 * Jednostrzałowe dyktowanie na urządzeniu (Web Speech API, `pl-PL`).
 *
 * Użycie w okienku asystenta (przycisk mikrofonu):
 * podyktowany tekst trafia do `processCommand` — tej samej funkcji,
 * która obsługuje tekst wpisany z klawiatury (Voice & Text Pipeline).
 */
export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}) {
  const { lang = "pl-PL", onFinalText } = options;
  const [supported] = useState<boolean>(() => isSpeechRecognitionSupported());
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalTextRef = useRef(options.onFinalText);
  useEffect(() => {
    onFinalTextRef.current = onFinalText;
  }, [onFinalText]);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* przeglądarka może już zamykać mikrofon */
    }
  }, []);

  const startListening = useCallback(() => {
    if (typeof window === "undefined") return;
    const w = window as SpeechRecognitionWindow;
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Twoja przeglądarka nie wspiera rozpoznawania mowy. Użyj Chrome lub Edge.");
      setStatus("error");
      return;
    }

    try {
      recognitionRef.current?.abort?.();
    } catch {
      /* ignoruj — poprzednia sesja mogła już wygasnąć */
    }

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      const spokenText = last?.[0]?.transcript?.trim() ?? "";
      if (!spokenText) return;
      setTranscript(spokenText);
      // Przekazujemy podyktowany tekst do hybrydowego procesora komend.
      onFinalTextRef.current?.(spokenText);
    };

    recognition.onerror = (event) => {
      setStatus("error");
      setError(FRIENDLY_ERRORS[event.error] ?? `Rozpoznawanie mowy przerwane (${event.error}).`);
    };

    recognition.onend = () => {
      setStatus((previous) => (previous === "listening" ? "idle" : previous));
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setError(null);
    setTranscript("");
    setStatus("listening");
    try {
      recognition.start();
    } catch {
      setStatus("error");
      setError("Nie udało się uruchomić mikrofonu.");
      recognitionRef.current = null;
    }
  }, [lang]);

  const toggleListening = useCallback(() => {
    if (status === "listening") stopListening();
    else startListening();
  }, [status, startListening, stopListening]);

  useEffect(
    () => () => {
      try {
        recognitionRef.current?.abort?.();
      } catch {
        /* sprzątanie przy odmontowaniu */
      }
      recognitionRef.current = null;
    },
    [],
  );

  return {
    supported,
    status,
    isListening: status === "listening",
    transcript,
    error,
    startListening,
    stopListening,
    toggleListening,
  };
}
