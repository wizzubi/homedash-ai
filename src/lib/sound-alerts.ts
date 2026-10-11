/**
 * HomeDash AI — dźwiękowe alerty bez plików (WebAudio API).
 *
 * Kiosk ścienny nie powinien zależeć od binarnych sampli: dzwonek `chime`
 * i alarm `alert` są syntezowane oscylatorem z kopertą ADSR. Działa offline,
 * zero requestów, zero licencji.
 *
 * Autoplay: pierwsze wywołanie musi nastąpić po geście użytkownika
 * (przeglądarki blokują AudioContext) — scheduler woła `unlockAudio()`
 * przy starcie, a alerty i tak grają, bo do tego czasu użytkownik zwykle
 * dotknął ekranu. Gdy kontekst jest wstrzymany, dźwięk jest pomijany
 * (powiadomienie wizualne i tak się pokazuje).
 */

export type AlertSound = "chime" | "alert";

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) {
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }
  return context;
}

/** Odblokuj dźwięk po geście (wywołuje scheduler przy starcie). */
export function unlockAudio(): void {
  const ctx = audioContext();
  if (ctx && ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }
}

function tone(
  ctx: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  volume: number,
  type: OscillatorType = "sine",
) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  // Koperta: szybki atak, wykładniczy zanik — miękki „dzwon”.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0002), startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.05);
}

/**
 * Odtwarza alert. `chime` — podwójny miękki dzwonek (przypomnienia),
 * `alert` — potrójny wyższy sygnał (śmieci na jutro, pilne).
 * Zwraca `false`, gdy dźwięk był niemożliwy (zablokowany kontekst).
 */
export function playAlertSound(kind: AlertSound = "chime"): boolean {
  const ctx = audioContext();
  if (!ctx || ctx.state !== "running") return false;
  try {
    const now = ctx.currentTime;
    if (kind === "alert") {
      tone(ctx, 880, now, 0.22, 0.25);
      tone(ctx, 880, now + 0.26, 0.22, 0.25);
      tone(ctx, 1174.66, now + 0.52, 0.34, 0.28);
    } else {
      tone(ctx, 659.25, now, 0.4, 0.22);
      tone(ctx, 987.77, now + 0.18, 0.5, 0.2);
    }
    return true;
  } catch {
    return false;
  }
}
