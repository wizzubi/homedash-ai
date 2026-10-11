"use client";

import { useEffect, useRef } from "react";
import { playAlertSound, unlockAudio, type AlertSound } from "@/lib/sound-alerts";

export type AlertKind = "garbage" | "task" | "note";

export type AlertFire = {
  /** Stabilny klucz anty-duplikacyjny (np. `garbage-eve:<id>:2026-10-11`). */
  key: string;
  kind: AlertKind;
  title: string;
  body: string;
  sound: AlertSound;
  /** Tekst do odczytania lektorem (domyślnie `body`). */
  speak?: string;
};

type SchedulerInput = {
  garbage: Array<{ id: string; fraction: string; pickupDate: string }>;
  tasks: Array<{ id: string; title: string; dueDate: string | null; isCompleted: boolean }>;
  notes: Array<{ id: string; title: string | null; content: string; remindAt: string | null }>;
  config: Record<string, string>;
};

const FRACTION_PL: Record<string, string> = {
  MIXED: "zmieszane",
  GLASS: "szkło",
  PLASTIC_METAL: "plastik i metal",
  BIO: "bio",
};

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseAlertHour(raw: string | undefined): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((raw || "").trim());
  if (!match) return { hour: 18, minute: 0 };
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * Czyste reguły alertów (testowalne bez Reacta): zwraca wszystkie alerty
 * należne w chwili `now`. Deduplikacją zajmuje się hook (sessionStorage).
 */
export function collectDueAlerts(data: SchedulerInput, now: Date): AlertFire[] {
  const out: AlertFire[] = [];
  const today = dayKey(now);
  const { hour, minute } = parseAlertHour(data.config.garbage_alert_hour);
  const pastHour = now.getHours() * 60 + now.getMinutes() >= hour * 60 + minute;
  const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  // 1. Śmieci jutro → wieczorne przypomnienie dziś.
  for (const item of data.garbage) {
    const pickup = new Date(item.pickupDate);
    if (Number.isNaN(pickup.getTime())) continue;
    const diffDays = Math.round((midnight(pickup) - midnight(now)) / 86_400_000);
    if (diffDays !== 1 || !pastHour) continue;
    const label = FRACTION_PL[item.fraction] ?? "odpadów";
    out.push({
      key: `garbage-eve:${item.id}:${today}`,
      kind: "garbage",
      title: "Wywóz jutro",
      body: `🔔 Jutro wywóz: ${label}. Wystaw pojemniki do rana.`,
      sound: "alert",
    });
  }

  // 2. Zadania z terminem dziś.
  for (const task of data.tasks) {
    if (task.isCompleted || !task.dueDate) continue;
    const due = new Date(task.dueDate);
    if (Number.isNaN(due.getTime()) || dayKey(due) !== today) continue;
    out.push({
      key: `task-due:${task.id}:${today}`,
      kind: "task",
      title: "Termin dziś",
      body: `🔔 Dziś termin: ${task.title}.`,
      sound: "chime",
    });
  }

  // 3. Notatki z przypomnieniem czasowym.
  for (const note of data.notes) {
    if (!note.remindAt) continue;
    const at = new Date(note.remindAt);
    if (Number.isNaN(at.getTime())) continue;
    const ageMs = now.getTime() - at.getTime();
    if (ageMs < 0 || ageMs > 90_000) continue;
    out.push({
      key: `note:${note.id}`,
      kind: "note",
      title: note.title || "Przypomnienie",
      body: `🔔 ${note.title ? `${note.title}: ` : ""}${note.content}`,
      sound: "chime",
    });
  }

  return out;
}

function loadFired(): Set<string> {
  try {
    if (typeof window === "undefined") return new Set();
    const raw = window.sessionStorage.getItem("homedash:fired-alerts");
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * Terminarz alertów dźwiękowych (client-side polling co 30 s).
 *
 * Reguły:
 *  - śmieci: dzień przed odbiorem, po godzinie z `garbage_alert_hour` (18:00),
 *  - zadania: termin dziś (nieukończone), raz dziennie,
 *  - notatki: `remind_at` w oknie [−60 s, teraz], jednorazowo.
 *
 * Odpalenie = dźwięk WebAudio + `onFire` (toast + opcjonalny odczyt TTS
 * decyduje dashboard). Strażnik w `sessionStorage` chroni przed dubletami.
 */
export function useAlertScheduler(input: SchedulerInput | null, onFire: (alert: AlertFire) => void) {
  const onFireRef = useRef(onFire);
  const inputRef = useRef(input);
  const firedRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    onFireRef.current = onFire;
  }, [onFire]);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    unlockAudio();
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    if (!firedRef.current) firedRef.current = loadFired();

    const markFired = (key: string) => {
      firedRef.current?.add(key);
      try {
        window.sessionStorage.setItem("homedash:fired-alerts", JSON.stringify([...(firedRef.current ?? [])].slice(-200)));
      } catch {
        /* ignoruj */
      }
    };

    const check = () => {
      const data = inputRef.current;
      const fire = onFireRef.current;
      if (!data || !firedRef.current) return;
      for (const alert of collectDueAlerts(data, new Date())) {
        if (firedRef.current.has(alert.key)) continue;
        markFired(alert.key);
        fire(alert);
      }
    };

    check();
    const timer = window.setInterval(check, 30_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", unlock);
    };
  }, []);
}
