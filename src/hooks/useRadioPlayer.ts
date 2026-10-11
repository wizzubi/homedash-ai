"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RADIO_STATIONS, type RadioStation } from "@/lib/radio-stations";

export type RadioCommand =
  | { action: "play"; stationId?: string | null }
  | { action: "stop" }
  | { action: "toggle" }
  | { action: "volume-up" }
  | { action: "volume-down" }
  | { action: "set-volume"; value: number };

/** Szyna komend radiowych — głos i kafel sterują tym samym odtwarzaczem. */
export const RADIO_EVENT = "homedash:radio";

export function emitRadioCommand(command: RadioCommand) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<RadioCommand>(RADIO_EVENT, { detail: command }));
}

const VOLUME_KEY = "homedash:radio-volume";
const STATION_KEY = "homedash:radio-station";

function loadSavedVolume(): number {
  try {
    if (typeof window === "undefined") return 0.7;
    const saved = Number(window.localStorage.getItem(VOLUME_KEY));
    if (Number.isFinite(saved) && saved >= 0 && saved <= 1) return saved;
  } catch {
    /* tryb prywatny — domyślne */
  }
  return 0.7;
}

function loadSavedStation(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const saved = window.localStorage.getItem(STATION_KEY);
    if (saved && RADIO_STATIONS.some((station) => station.id === saved)) return saved;
  } catch {
    /* tryb prywatny — domyślne */
  }
  return null;
}

/**
 * Odtwarzacz radia internetowego (natywny HTMLAudioElement, brak DOM).
 *
 * Autoplay: przeglądarki blokują `play()` bez gestu użytkownika (komenda
 * głosowa gestem nie jest) — wtedy stacja zostaje wybrana, a błąd ląduje
 * w `error`, żeby kafel pokazał przycisk wznowienia na tapnięcie.
 */
export function useRadioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [stationId, setStationId] = useState<string | null>(loadSavedStation);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolumeState] = useState<number>(loadSavedVolume);
  const [error, setError] = useState<string | null>(null);
  const stationIdRef = useRef<string | null>(null);
  const volumeRef = useRef(0.7);

  useEffect(() => {
    stationIdRef.current = stationId;
  }, [stationId]);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "none";
    audio.volume = loadSavedVolume();
    audio.onended = () => setPlaying(false);
    audio.onerror = () => {
      setPlaying(false);
      setError("Nie udało się połączyć ze strumieniem stacji.");
    };
    audioRef.current = audio;
    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  const station: RadioStation | null =
    RADIO_STATIONS.find((entry) => entry.id === stationId) ?? null;

  const playStation = useCallback(async (id: string | null) => {
    const audio = audioRef.current;
    const target =
      RADIO_STATIONS.find((entry) => entry.id === id) ??
      RADIO_STATIONS.find((entry) => entry.id === stationIdRef.current) ??
      RADIO_STATIONS[0];
    if (!audio || !target) return;
    setError(null);
    setStationId(target.id);
    try {
      window.localStorage.setItem(STATION_KEY, target.id);
    } catch {
      /* ignoruj */
    }
    try {
      if (audio.src !== target.streamUrl) audio.src = target.streamUrl;
      audio.volume = volumeRef.current;
      await audio.play();
      setPlaying(true);
    } catch {
      // Najczęściej blokada autoplay bez gestu — stacja wybrana, czeka na tap.
      setPlaying(false);
      setError("Dotknij przycisku odtwarzania, aby uruchomić radio.");
    }
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (playing) stop();
    else void playStation(stationIdRef.current);
  }, [playing, playStation, stop]);

  const setVolume = useCallback((value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    setVolumeState(clamped);
    if (audioRef.current) audioRef.current.volume = clamped;
    try {
      window.localStorage.setItem(VOLUME_KEY, String(clamped));
    } catch {
      /* ignoruj */
    }
  }, []);

  const adjustVolume = useCallback(
    (delta: number) => setVolume(volumeRef.current + delta),
    [setVolume],
  );

  useEffect(() => {
    const handler = (event: Event) => {
      const command = (event as CustomEvent<RadioCommand>).detail;
      if (!command || typeof command.action !== "string") return;
      switch (command.action) {
        case "play":
          void playStation(command.stationId ?? null);
          break;
        case "stop":
          stop();
          break;
        case "toggle":
          toggle();
          break;
        case "volume-up":
          adjustVolume(0.1);
          break;
        case "volume-down":
          adjustVolume(-0.1);
          break;
        case "set-volume":
          setVolume(command.value);
          break;
      }
    };
    window.addEventListener(RADIO_EVENT, handler);
    return () => window.removeEventListener(RADIO_EVENT, handler);
  }, [playStation, stop, toggle, adjustVolume, setVolume]);

  return { station, stationId, playing, volume, error, playStation, stop, toggle, setVolume, adjustVolume };
}
