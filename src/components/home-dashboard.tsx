"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  Droplets,
  FileText,
  House,
  Leaf,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Mic,
  MicOff,
  Moon,
  MoreHorizontal,
  NotebookPen,
  Pin,
  Plus,
  Recycle,
  Send,
  Settings2,
  ShieldAlert,
  Sparkles,
  Sun,
  Thermometer,
  Trash2,
  Volume2,
  Wind,
  Wine,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { parseLocalCommand } from "@/lib/local-commands";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

type TaskItem = {
  id: string;
  title: string;
  assignedTo: string | null;
  dueDate: string | null;
  isCompleted: boolean;
  createdAt: string;
};
type WorkLog = {
  id: string;
  date: string;
  hours: number;
  startTime: string | null;
  endTime: string | null;
  note: string | null;
};
type GarbageItem = { id: string; fraction: string; pickupDate: string };
type DocumentItem = { id: string; title: string; category: string; expirationDate: string };
type Lesson = { id: string; childName: string; dayOfWeek: number; startTime: string; endTime: string; subject: string; classroom: string | null };
type NoteItem = { id: string; title: string | null; content: string; color: string; isPinned: boolean; createdAt: string };
type FamilyMember = { name: string; role: "parent" | "child" };
type DashboardData = {
  tasks: TaskItem[];
  workLogs: WorkLog[];
  garbage: GarbageItem[];
  documents: DocumentItem[];
  timetable: Lesson[];
  notes: NoteItem[];
  config: Record<string, string>;
  family?: FamilyMember[];
  setupCompleted?: boolean;
};
type WeatherData = {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    weather_code?: number;
    is_day?: number;
  };
  daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
};
type ChatMessage = { role: "user" | "assistant"; content: string; tools?: string[]; source?: "local" | "openrouter" | "groq" | "error" };
type ComposerKind = "task" | "note" | "work";
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

const EMPTY_DASHBOARD: DashboardData = {
  tasks: [], workLogs: [], garbage: [], documents: [], timetable: [], notes: [], config: {},
};

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const data = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(data.error || "Coś poszło nie tak. Spróbuj ponownie.");
  return data;
}

function dateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localMidnight(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function isoWeekday(date: Date) {
  return date.getDay() === 0 ? 7 : date.getDay();
}

function minutesOfDay(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function displayTime(value: string | Date, options?: Intl.DateTimeFormatOptions) {
  return new Date(value).toLocaleTimeString("pl-PL", options ?? { hour: "2-digit", minute: "2-digit" });
}

function daysUntil(value: string | Date, now: Date) {
  return Math.ceil((localMidnight(new Date(value)).getTime() - localMidnight(now).getTime()) / 86_400_000);
}

function formatHours(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
}

function dayName(date: Date, short = false) {
  return date.toLocaleDateString("pl-PL", { weekday: short ? "short" : "long" });
}

function weatherPresentation(code = 0, isDay = 1): { label: string; Icon: LucideIcon; tint: string } {
  if (code === 0) return { label: isDay ? "Bezchmurnie" : "Pogodna noc", Icon: isDay ? Sun : Moon, tint: "text-amber-200" };
  if (code <= 2) return { label: "Częściowe zachmurzenie", Icon: CloudSun, tint: "text-amber-100" };
  if (code === 3) return { label: "Pochmurno", Icon: Cloud, tint: "text-slate-200" };
  if (code === 45 || code === 48) return { label: "Mgła", Icon: CloudFog, tint: "text-slate-300" };
  if (code >= 51 && code <= 57) return { label: "Mżawka", Icon: CloudDrizzle, tint: "text-sky-200" };
  if (code >= 61 && code <= 67) return { label: "Deszcz", Icon: CloudRain, tint: "text-sky-200" };
  if (code >= 71 && code <= 77) return { label: "Opady śniegu", Icon: Cloud, tint: "text-blue-100" };
  if (code >= 80 && code <= 82) return { label: "Przelotny deszcz", Icon: CloudRain, tint: "text-sky-200" };
  if (code >= 85 && code <= 86) return { label: "Śnieg", Icon: Cloud, tint: "text-blue-100" };
  if (code >= 95) return { label: "Burza", Icon: CloudLightning, tint: "text-violet-200" };
  return { label: "Zmienna pogoda", Icon: CloudSun, tint: "text-slate-200" };
}

const FRACTIONS: Array<{ key: string; label: string; Icon: LucideIcon; color: string; glow: string }> = [
  { key: "BIO", label: "Bio", Icon: Leaf, color: "text-emerald-300", glow: "bg-emerald-400/10" },
  { key: "PLASTIC_METAL", label: "Plastik + metal", Icon: Recycle, color: "text-sky-300", glow: "bg-sky-400/10" },
  { key: "MIXED", label: "Zmieszane", Icon: Trash2, color: "text-rose-300", glow: "bg-rose-400/10" },
  { key: "GLASS", label: "Szkło", Icon: Wine, color: "text-violet-300", glow: "bg-violet-400/10" },
];

/** Polskie opisy narzędzi asystenta — pokazywane jako mikro-etykiety przy odpowiedzi. */
const TOOL_LABELS: Record<string, string> = {
  addTask: "dodano zadanie",
  setTaskDone: "zmieniono zadanie",
  logWorkHours: "zapisano godziny",
  addNote: "dodano notatkę",
  listTasks: "odczyt · zadania",
  getWorkSummary: "odczyt · godziny",
  getNextWastePickup: "odczyt · odpady",
  getExpiringDocuments: "odczyt · dokumenty",
};

function GlassCard({
  children,
  className = "",
  delay = 0,
  ...props
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
} & React.ComponentProps<typeof motion.section>) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay, ease: "easeOut" }}
      className={`hd-card hd-card-hover flex min-h-0 flex-col p-4 ${className}`}
      {...props}
    >
      {children}
    </motion.section>
  );
}

function SectionHeading({
  icon: Icon,
  label,
  action,
  accent = "text-slate-400",
}: {
  icon: LucideIcon;
  label: string;
  action?: ReactNode;
  accent?: string;
}) {
  return (
    <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[10px] bg-white/[0.045] ${accent}`}>
          <Icon size={15} strokeWidth={1.8} />
        </span>
        <h2 className="hd-overline truncate">{label}</h2>
      </div>
      {action}
    </div>
  );
}

function WeekChart({ workLogs, now }: { workLogs: WorkLog[]; now: Date }) {
  const monday = localMidnight(now);
  monday.setDate(monday.getDate() - (isoWeekday(now) - 1));
  const bars = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const key = dateKey(date);
    const hours = workLogs.reduce((sum, log) => sum + (dateKey(log.date) === key ? log.hours : 0), 0);
    return { date, hours, isToday: key === dateKey(now) };
  });
  const peak = Math.max(8, ...bars.map((bar) => bar.hours));

  return (
    <div className="min-h-0 flex-1">
      <svg className="h-full min-h-[74px] w-full overflow-visible" viewBox="0 0 448 106" preserveAspectRatio="none" role="img" aria-label="Wykres godzin pracy w tym tygodniu">
        <defs>
          <linearGradient id="work-bar-today" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#bbf7d0" />
            <stop offset="100%" stopColor="#62b98d" />
          </linearGradient>
        </defs>
        {[22, 48, 74].map((y) => <line key={y} x1="0" x2="448" y1={y} y2={y} stroke="rgba(148,163,184,.1)" strokeDasharray="3 6" />)}
        {bars.map((bar, index) => {
          const height = bar.hours > 0 ? Math.max(7, (bar.hours / peak) * 62) : 4;
          const x = index * 64 + 11;
          const y = 78 - height;
          return (
            <g key={dateKey(bar.date)}>
              {bar.hours > 0 && <text x={x + 19} y={Math.max(11, y - 6)} textAnchor="middle" fill={bar.isToday ? "#d8f9e5" : "#8492a5"} fontSize="9" fontFamily="Inter, sans-serif">{formatHours(bar.hours)}</text>}
              <rect x={x} y={y} width="38" height={height} rx="9" fill={bar.isToday ? "url(#work-bar-today)" : bar.hours > 0 ? "#39475c" : "#222d3c"} opacity={bar.isToday ? 1 : .88} />
            </g>
          );
        })}
      </svg>
      <div className="mt-0.5 grid grid-cols-7">
        {bars.map((bar) => (
          <span key={dateKey(bar.date)} className={`text-center text-[9px] font-medium capitalize ${bar.isToday ? "text-emerald-200" : "text-slate-600"}`}>
            {dayName(bar.date, true).replace(".", "")}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function HomeDashboard() {
  const [dashboard, setDashboard] = useState<DashboardData>(EMPTY_DASHBOARD);
  const [dataReady, setDataReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherUnavailable, setWeatherUnavailable] = useState(false);
  const [toast, setToast] = useState("");
  const [wakeListening, setWakeListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Asystent gotowy");
  const [composer, setComposer] = useState<ComposerKind | null>(null);
  const [composerBusy, setComposerBusy] = useState(false);
  const [selectedChild, setSelectedChild] = useState("");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantText, setAssistantText] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Cześć! Jestem domowym asystentem. Mogę pomóc Ci dodać zadanie, zapisać godziny pracy albo znaleźć najbliższy odbiór odpadów." },
  ]);
  const voiceArmed = useRef(false);
  const aiFallbackNotified = useRef(false);
  const voiceEnabledRef = useRef(false);
  const assistantInputRef = useRef<HTMLInputElement>(null);
  // Ujednolicony pipeline (Voice & Text): klawiatura i mowę obsługuje ta sama
  // funkcja `handleUserCommand` — najpierw lokalny parser, potem AI Fallback.
  const handleUserCommandRef = useRef<(command: string) => Promise<void>>(async () => undefined);
  // Jednostrzałowe dyktowanie w okienku asystenta (Web Speech API, pl-PL).
  const dictation = useSpeechRecognition({
    onFinalText: (spokenText) => {
      setAssistantOpen(true);
      void handleUserCommandRef.current(spokenText);
    },
  });

  const refreshDashboard = useCallback(async () => {
    try {
      const next = await requestJson<DashboardData>("/api/dashboard", { cache: "no-store" });
      setDashboard(next);
      setLoadError(null);
      setDataReady(true);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Nie udało się połączyć z domem.");
      setDataReady(true);
    }
  }, []);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  useEffect(() => {
    setNow(new Date());
    void refreshDashboard();
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    const refresh = window.setInterval(() => void refreshDashboard(), 120_000);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(refresh);
    };
  }, [refreshDashboard]);

  const city = dashboard.config.home_city || "Warszawa";
  const latitude = dashboard.config.city_lat || "52.2297";
  const longitude = dashboard.config.city_lon || "21.0122";
  useEffect(() => {
    let cancelled = false;
    setWeatherUnavailable(false);
    fetch(`/api/weather?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("weather unavailable");
        return response.json() as Promise<WeatherData>;
      })
      .then((value) => { if (!cancelled) setWeather(value); })
      .catch(() => { if (!cancelled) setWeatherUnavailable(true); });
    return () => { cancelled = true; };
  }, [latitude, longitude]);

  useEffect(() => { voiceEnabledRef.current = wakeListening; }, [wakeListening]);

  const ttsVoice = dashboard.config.tts_voice === "pl-PL-MarekNeural" ? "pl-PL-MarekNeural" : "pl-PL-ZofiaNeural";

  const playSpeech = useCallback(async (text: string) => {
    if (typeof window === "undefined" || !text.trim()) return;
    setSpeaking(true);
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: ttsVoice }),
      });
      if (!response.ok) throw new Error("Edge TTS niedostępne");
      const audioUrl = URL.createObjectURL(await response.blob());
      const audio = new Audio(audioUrl);
      audio.onended = () => { URL.revokeObjectURL(audioUrl); setSpeaking(false); };
      audio.onerror = () => { URL.revokeObjectURL(audioUrl); setSpeaking(false); };
      await audio.play();
    } catch {
      setSpeaking(false);
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "pl-PL";
        utterance.rate = 0.96;
        utterance.onend = () => setSpeaking(false);
        window.speechSynthesis.speak(utterance);
        setSpeaking(true);
      }
    }
  }, [ttsVoice]);

  const createTask = useCallback(async (title: string, assignedTo?: string | null) => {
    await requestJson<TaskItem>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title, assignedTo: assignedTo || null }),
    });
    await refreshDashboard();
  }, [refreshDashboard]);

  const createWorkLog = useCallback(async (entry: { hours?: number; startTime?: string; endTime?: string; note?: string }) => {
    await requestJson<WorkLog>("/api/work-logs", { method: "POST", body: JSON.stringify(entry) });
    await refreshDashboard();
  }, [refreshDashboard]);

  const createNote = useCallback(async (entry: { title?: string; content: string; color: string }) => {
    await requestJson<NoteItem>("/api/notes", { method: "POST", body: JSON.stringify(entry) });
    await refreshDashboard();
  }, [refreshDashboard]);

  const askAssistant = useCallback(async (question: string) => {
    const clean = question.trim();
    if (!clean) return;
    const history = messages.slice(-8).map(({ role, content }) => ({ role, content }));
    setMessages((previous) => [...previous, { role: "user", content: clean }]);
    setAssistantText("");
    setAssistantBusy(true);
    setAssistantOpen(true);
    try {
      const response = await requestJson<{
        reply: string;
        source?: string;
        toolsUsed?: string[];
        mutated?: boolean;
        aiUnavailable?: boolean;
      }>("/api/assistant", {
        method: "POST",
        body: JSON.stringify({ message: clean, history }),
      });

      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: response.reply,
          tools: response.toolsUsed,
          source: response.source === "groq" ? "groq" : response.source === "openrouter" ? "openrouter" : response.source === "local" ? "local" : undefined,
        },
      ]);

      // Asystent faktycznie zapisał dane → odśwież kafelki dashboardu.
      if (response.mutated) {
        void refreshDashboard();
        notify("Zapis wykonany przez asystenta — kafelki zaktualizowane.");
      }

      if (response.aiUnavailable && !aiFallbackNotified.current) {
        aiFallbackNotified.current = true;
        notify(
          "Model AI jest teraz niedostępny (limit / filtry konta). Proste komendy: zadania, notatki, godziny i odpady obsługuję lokalnie.",
        );
      }

      setVoiceStatus(
        response.aiUnavailable || response.source === "local"
          ? "Tryb lokalny · bez AI"
          : response.source === "groq"
            ? response.toolsUsed?.length
              ? `Home AI · Groq · narzędzia: ${response.toolsUsed.length}`
              : "Home AI · Groq"
            : response.source === "openrouter"
              ? response.toolsUsed?.length
                ? `Home AI · narzędzia: ${response.toolsUsed.length}`
                : "Home AI · OpenRouter"
              : "Asystent gotowy",
      );
      void playSpeech(response.reply);
    } catch (error) {
      const response = error instanceof Error ? error.message : "Asystent jest chwilowo niedostępny.";
      setMessages((previous) => [...previous, { role: "assistant", content: response, source: "error" }]);
      setVoiceStatus("Asystent chwilowo niedostępny");
    } finally {
      setAssistantBusy(false);
    }
  }, [messages, notify, playSpeech, refreshDashboard]);

  /**
   * Hybrydowy procesor komend (Local-First + AI Fallback).
   *
   * Jeden punkt wejścia dla tekstu z klawiatury i z dyktowania głosowego
   * (Web Speech API, `pl-PL`):
   *   krok 1 — `parseLocalCommand`: natychmiastowa akcja (Turso/REST albo
   *            odczyt z pamięci dashboardu), odpowiedź w ułamku sekundy,
   *            zero kosztów AI;
   *   krok 2 — `null` z parsera → dopiero wtedy AI Fallback (`askAssistant`
   *            → `/api/assistant` → OpenRouter / Groq z Tool Calling).
   */
  const handleUserCommand = useCallback(async (rawCommand: string) => {
    const command = rawCommand.trim().replace(/^[,.:;\s]+|[,.:;\s]+$/g, "");
    if (!command || assistantBusy) return;

    const intent = parseLocalCommand(command);
    if (!intent) {
      // Krok 2: tekst nie pasuje do żadnego prostego wzorca — AI Fallback.
      await askAssistant(command);
      return;
    }

    // Krok 1: lokalny zamiar — dopisz parę do czatu, żeby historia była spójna.
    setAssistantOpen(true);
    setMessages((previous) => [...previous, { role: "user", content: command }]);
    const pushLocal = (reply: string) => {
      setMessages((previous) => [...previous, { role: "assistant", content: reply, source: "local" }]);
      setVoiceStatus("Tryb lokalny · bez AI");
      notify(reply);
      void playSpeech(reply);
    };

    try {
      switch (intent.kind) {
        case "addTask": {
          await createTask(intent.title, intent.assignedTo);
          pushLocal(
            `⚡ Dodałam zadanie: ${intent.title}${intent.assignedTo ? ` (dla: ${intent.assignedTo})` : ""}.`,
          );
          return;
        }
        case "completeTask": {
          const needle = intent.title.toLocaleLowerCase("pl-PL");
          const match = dashboard.tasks.find((task) => task.title.toLocaleLowerCase("pl-PL").includes(needle));
          if (!match) {
            // Brak dopasowania w pamięci — niech rozstrzygnie serwer/AI.
            setMessages((previous) => previous.slice(0, -1));
            await askAssistant(command);
            return;
          }
          await requestJson<TaskItem>("/api/tasks", {
            method: "PATCH",
            body: JSON.stringify({ id: match.id, isCompleted: intent.completed }),
          });
          await refreshDashboard();
          pushLocal(
            intent.completed
              ? `⚡ Zadanie „${match.title}” oznaczyłam jako wykonane.`
              : `⚡ Zadanie „${match.title}” wróciło na listę otwartych.`,
          );
          return;
        }
        case "addNote": {
          await createNote({ title: intent.title || "Notatka głosowa", content: intent.content, color: "amber" });
          pushLocal("⚡ Zapisałam notatkę i przypięłam ją na tablicy.");
          return;
        }
        case "logWork": {
          await createWorkLog({
            hours: intent.hours,
            startTime: intent.startTime,
            endTime: intent.endTime,
            note: intent.note || "Zapis głosowy · HomeDash",
          });
          pushLocal(
            intent.startTime && intent.endTime
              ? `⚡ Zapisane. Pracowałaś od ${intent.startTime} do ${intent.endTime}.`
              : `⚡ Zapisane ${formatHours(intent.hours ?? 0)} godzin pracy na dziś.`,
          );
          return;
        }
        case "workSummary": {
          const current = now ?? new Date();
          const monday = localMidnight(current);
          monday.setDate(monday.getDate() - (isoWeekday(current) - 1));
          const total = dashboard.workLogs.reduce((sum, log) => {
            const date = new Date(log.date);
            if (intent.period === "week") {
              return date >= monday && date <= current ? sum + log.hours : 0;
            }
            if (intent.period === "month") {
              return date.getFullYear() === current.getFullYear() && date.getMonth() === current.getMonth()
                ? sum + log.hours
                : 0;
            }
            return dateKey(log.date) === dateKey(current) ? sum + log.hours : 0;
          }, 0);
          const label = intent.period === "week" ? "W tym tygodniu" : intent.period === "month" ? "W tym miesiącu" : "Dziś";
          pushLocal(`⚡ ${label} masz zapisane ${formatHours(total)} godzin pracy.`);
          return;
        }
        case "wasteQuery": {
          const reference = now ?? new Date();
          const item = dashboard.garbage
            .filter(
              (schedule) =>
                (!intent.fraction || schedule.fraction === intent.fraction) &&
                daysUntil(schedule.pickupDate, reference) >= 0,
            )
            .sort((a, b) => new Date(a.pickupDate).getTime() - new Date(b.pickupDate).getTime())[0];
          if (!item) {
            pushLocal("⚡ Nie widzę najbliższego terminu w kalendarzu odpadów. Możesz dodać go w panelu administratora.");
            return;
          }
          const fractionLabel =
            FRACTIONS.find((entry) => entry.key === item.fraction)?.label.toLocaleLowerCase("pl-PL") ?? "odpadów";
          const days = daysUntil(item.pickupDate, reference);
          pushLocal(
            days === 0
              ? `⚡ Tak, dziś wystaw ${fractionLabel}.`
              : `⚡ Najbliższy odbiór: ${fractionLabel}, ${days === 1 ? "jutro" : `za ${days} dni`}.`,
          );
          return;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nie udało się wykonać polecenia.";
      setMessages((previous) => [...previous, { role: "assistant", content: message, source: "error" }]);
      notify(message);
    }
  }, [askAssistant, assistantBusy, createNote, createTask, createWorkLog, dashboard.garbage, dashboard.tasks, dashboard.workLogs, notify, now, playSpeech, refreshDashboard]);

  useEffect(() => { handleUserCommandRef.current = handleUserCommand; }, [handleUserCommand]);

  const wakeWord = dashboard.config.wake_word || "Hej Dash";
  useEffect(() => {
    if (!wakeListening) return;
    const speechWindow = window as SpeechRecognitionWindow;
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setWakeListening(false);
      setVoiceStatus("Przeglądarka nie obsługuje rozpoznawania mowy");
      notify("Ta przeglądarka nie obsługuje Web Speech API. Spróbuj Chrome lub Edge.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "pl-PL";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      const transcript = result?.[0]?.transcript?.trim();
      if (!transcript) return;
      const spoken = transcript.toLocaleLowerCase("pl-PL");
      const wake = wakeWord.toLocaleLowerCase("pl-PL");
      const wakePosition = spoken.indexOf(wake);
      const alternate = ["hej dash", "ok home", "okej home", "hej home"].find((phrase) => spoken.includes(phrase));
      if (wakePosition >= 0) {
        const rest = transcript.slice(wakePosition + wake.length).replace(/^[,.:;\s]+/, "");
        if (rest) {
          voiceArmed.current = false;
          setVoiceStatus("Słucham polecenia…");
          void handleUserCommandRef.current(rest);
        } else {
          voiceArmed.current = true;
          setVoiceStatus("Słucham — co mam zrobić?");
          notify("Słucham. Powiedz, co mam zrobić.");
        }
        return;
      }
      if (alternate) {
        const rest = transcript.slice(spoken.indexOf(alternate) + alternate.length).replace(/^[,.:;\s]+/, "");
        if (rest) {
          voiceArmed.current = false;
          setVoiceStatus("Słucham polecenia…");
          void handleUserCommandRef.current(rest);
        } else {
          voiceArmed.current = true;
          setVoiceStatus("Słucham — co mam zrobić?");
        }
        return;
      }
      if (voiceArmed.current) {
        voiceArmed.current = false;
        setVoiceStatus("Przetwarzam polecenie…");
        void handleUserCommandRef.current(transcript);
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setWakeListening(false);
        setVoiceStatus("Brak dostępu do mikrofonu");
        notify("Zezwól przeglądarce na dostęp do mikrofonu.");
      }
    };
    recognition.onend = () => {
      if (voiceEnabledRef.current) window.setTimeout(() => {
        if (voiceEnabledRef.current) {
          try { recognition.start(); } catch { /* rozpoznawanie już działa */ }
        }
      }, 400);
    };
    try { recognition.start(); } catch {
      setWakeListening(false);
      setVoiceStatus("Nie udało się uruchomić mikrofonu");
    }
    return () => {
      recognition.onend = null;
      try { recognition.stop(); } catch { /* przeglądarka może już zamykać mikrofon */ }
    };
  }, [wakeListening, wakeWord, notify]);

  const currentTime = now ?? new Date();
  const family = dashboard.family ?? [];
  const children = useMemo(() => {
    const fromFamily = family.filter((member) => member.role === "child").map((member) => member.name);
    const fromLessons = [...new Set(dashboard.timetable.map((lesson) => lesson.childName))];
    return [...new Set([...fromFamily, ...fromLessons])];
  }, [family, dashboard.timetable]);
  const activeChild = children.includes(selectedChild) ? selectedChild : children[0] ?? "";
  const todayLessons = dashboard.timetable
    .filter((lesson) => lesson.childName === activeChild && lesson.dayOfWeek === isoWeekday(currentTime))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const currentLesson = todayLessons.find((lesson) => minutesOfDay(lesson.startTime) <= currentTime.getHours() * 60 + currentTime.getMinutes() && minutesOfDay(lesson.endTime) > currentTime.getHours() * 60 + currentTime.getMinutes());
  const nextLesson = todayLessons.find((lesson) => minutesOfDay(lesson.startTime) > currentTime.getHours() * 60 + currentTime.getMinutes());
  const todayHours = dashboard.workLogs.reduce((sum, log) => sum + (dateKey(log.date) === dateKey(currentTime) ? log.hours : 0), 0);
  const weekStart = localMidnight(currentTime);
  weekStart.setDate(weekStart.getDate() - (isoWeekday(currentTime) - 1));
  const weekHours = dashboard.workLogs.reduce((sum, log) => {
    const date = new Date(log.date);
    return date >= weekStart && date <= currentTime ? sum + log.hours : sum;
  }, 0);
  const monthHours = dashboard.workLogs.reduce((sum, log) => {
    const date = new Date(log.date);
    return date.getFullYear() === currentTime.getFullYear() && date.getMonth() === currentTime.getMonth() ? sum + log.hours : sum;
  }, 0);
  const weatherView = weatherPresentation(weather?.current?.weather_code ?? 2, weather?.current?.is_day ?? 1);
  const WeatherIcon = weatherView.Icon;
  const urgentDocuments = [...dashboard.documents].sort((a, b) => new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime()).slice(0, 3);
  const openTasks = dashboard.tasks.filter((task) => !task.isCompleted);
  const recentNotes = dashboard.notes.slice(0, 2);

  async function toggleTask(task: TaskItem) {
    setDashboard((previous) => ({ ...previous, tasks: previous.tasks.map((item) => item.id === task.id ? { ...item, isCompleted: !item.isCompleted } : item) }));
    try {
      await requestJson<TaskItem>("/api/tasks", { method: "PATCH", body: JSON.stringify({ id: task.id, isCompleted: !task.isCompleted }) });
      void refreshDashboard();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Nie udało się zmienić zadania.");
      void refreshDashboard();
    }
  }

  async function removeTask(task: TaskItem) {
    try {
      await requestJson<{ ok: boolean }>("/api/tasks", { method: "DELETE", body: JSON.stringify({ id: task.id }) });
      await refreshDashboard();
      notify("Zadanie usunięte.");
    } catch (error) { notify(error instanceof Error ? error.message : "Nie udało się usunąć zadania."); }
  }

  async function toggleNotePin(note: NoteItem) {
    try {
      await requestJson<NoteItem>("/api/notes", { method: "PATCH", body: JSON.stringify({ id: note.id, isPinned: !note.isPinned }) });
      await refreshDashboard();
    } catch (error) { notify(error instanceof Error ? error.message : "Nie udało się zmienić notatki."); }
  }

  async function removeNote(note: NoteItem) {
    try {
      await requestJson<{ ok: boolean }>("/api/notes", { method: "DELETE", body: JSON.stringify({ id: note.id }) });
      await refreshDashboard();
      notify("Notatka usunięta.");
    } catch (error) { notify(error instanceof Error ? error.message : "Nie udało się usunąć notatki."); }
  }

  async function submitComposer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!composer) return;
    const values = new FormData(event.currentTarget);
    setComposerBusy(true);
    try {
      if (composer === "task") {
        const title = String(values.get("title") ?? "").trim();
        const assignedTo = String(values.get("assignedTo") ?? "");
        if (!title) return;
        await createTask(title, assignedTo);
        notify("Zadanie dodane do listy.");
      } else if (composer === "note") {
        const content = String(values.get("content") ?? "").trim();
        if (!content) return;
        await createNote({ title: String(values.get("title") ?? ""), content, color: String(values.get("color") ?? "amber") });
        notify("Notatka przypięta na tablicy.");
      } else {
        const startTime = String(values.get("startTime") ?? "");
        const endTime = String(values.get("endTime") ?? "");
        const hours = Number(values.get("hours"));
        const note = String(values.get("note") ?? "");
        await createWorkLog({ hours: Number.isFinite(hours) && hours > 0 ? hours : undefined, startTime: startTime || undefined, endTime: endTime || undefined, note });
        notify("Godziny pracy zapisane.");
      }
      setComposer(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Nie udało się zapisać zmian.");
    } finally { setComposerBusy(false); }
  }

  async function submitAssistant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = assistantInputRef.current?.value.trim() ?? "";
    if (!value || assistantBusy) return;
    if (assistantInputRef.current) assistantInputRef.current.value = "";
    // Tekst z klawiatury trafia do tego samego procesora co mowa.
    await handleUserCommand(value);
  }

  function nearestPickup(fraction: string) {
    return dashboard.garbage
      .filter((item) => item.fraction === fraction && daysUntil(item.pickupDate, currentTime) >= 0)
      .sort((a, b) => new Date(a.pickupDate).getTime() - new Date(b.pickupDate).getTime())[0];
  }

  return (
    <main className="home-shell">
      <header className="home-header flex h-14 items-center justify-between gap-3 px-0.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl border border-emerald-200/15 bg-gradient-to-br from-emerald-200/15 via-slate-800 to-sky-300/10 shadow-[0_0_30px_rgba(145,219,183,.08)]">
            <House size={21} strokeWidth={1.65} className="text-emerald-100" />
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-emerald-200 shadow-[0_0_10px_#a8eccb]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h1 className="truncate text-[17px] font-semibold tracking-[-.045em] text-slate-100 sm:text-[19px]">HomeDash <span className="text-emerald-200">AI</span></h1>
              <span className="hidden rounded-full border border-slate-700/70 px-2 py-0.5 text-[8px] font-semibold tracking-[.15em] text-slate-500 sm:inline">DOM · RODZINA</span>
            </div>
            <p className="hidden text-[10px] text-slate-500 sm:block">Dobrze, że jesteście u siebie.</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-[11px] font-medium capitalize text-slate-300">{now ? now.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" }) : "Dzisiaj w domu"}</p>
            <p className="mt-0.5 text-[9px] text-slate-600">{city} <span className="mx-1 text-slate-700">·</span> miłego dnia</p>
          </div>
          <div className="hidden h-8 w-px bg-slate-800 sm:block" />
          <div className="min-w-[58px] text-right font-mono text-[20px] font-medium tracking-[-.06em] text-slate-100 sm:min-w-[68px] sm:text-[24px]">
            {now ? displayTime(now) : "--:--"}
          </div>
          <button
            onClick={() => { setWakeListening((previous) => !previous); setVoiceStatus(wakeListening ? "Asystent gotowy" : "Słucham hasła wybudzającego"); }}
            aria-label={wakeListening ? "Wyłącz nasłuchiwanie" : "Włącz nasłuchiwanie głosowe"}
            title={wakeListening ? `Nasłuchiwanie: ${wakeWord}` : `Włącz mikrofon · ${wakeWord}`}
            className={`hd-button relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${wakeListening ? "border-rose-300/25 bg-rose-400/10 text-rose-200" : "border-slate-700/70 bg-slate-900/70 text-slate-300 hover:border-emerald-200/25 hover:text-emerald-100"}`}
          >
            {wakeListening ? <MicOff size={17} /> : <Mic size={17} />}
            {wakeListening && <span className="status-breathe absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-rose-300" />}
          </button>
          <Link href="/admin" title="Panel administracyjny" className="hd-button grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-700/70 bg-slate-900/70 text-slate-400 hover:border-slate-500 hover:text-slate-100">
            <Settings2 size={17} />
          </Link>
        </div>
      </header>

      {loadError && <div className="mb-2 flex items-center justify-between rounded-xl border border-rose-300/15 bg-rose-400/[.06] px-3 py-2 text-xs text-rose-200"><span>{loadError}</span><button onClick={() => void refreshDashboard()} className="underline underline-offset-2">Spróbuj ponownie</button></div>}

      <div className="dashboard-grid">
        <div className="dashboard-side left-stack">
          <GlassCard delay={0.04} className="weather-card hd-glow-blue">
            <SectionHeading icon={MapPin} label="Pogoda · teraz" accent="text-sky-300" />
            <div className="flex min-h-0 flex-1 items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium text-slate-400">{city}</p>
                <div className="mt-1 flex items-start gap-0.5">
                  <span className="text-[clamp(2.7rem,4vw,4.2rem)] font-light leading-none tracking-[-.08em] text-slate-50">{weather?.current?.temperature_2m != null ? Math.round(weather.current.temperature_2m) : "—"}</span>
                  <span className="mt-1 text-2xl font-light text-slate-400">°</span>
                </div>
                <p className="mt-2 text-[11px] font-medium text-slate-300">{weatherUnavailable ? "Pogoda niedostępna" : weather ? weatherView.label : "Pobieram prognozę…"}</p>
                {weather?.current?.apparent_temperature != null && <p className="mt-1 text-[9px] text-slate-500">Odczuwalna {Math.round(weather.current.apparent_temperature)}°</p>}
              </div>
              <div className="relative mr-1 grid h-[76px] w-[76px] shrink-0 place-items-center rounded-[24px] border border-white/[.06] bg-gradient-to-br from-white/[.055] to-transparent sm:h-[92px] sm:w-[92px]">
                <span className={`absolute inset-2 rounded-[20px] blur-2xl opacity-20 ${weatherView.tint.replace("text-", "bg-")}`} />
                <WeatherIcon className={`relative ${weatherView.tint}`} size={49} strokeWidth={1.2} />
              </div>
            </div>
            <div className="mt-3 flex shrink-0 items-center justify-between border-t border-white/[.055] pt-2.5 text-[9px] text-slate-500">
              <span className="flex items-center gap-1.5"><Thermometer size={12} className="text-rose-200/70" /> Max <b className="font-medium text-slate-300">{weather?.daily?.temperature_2m_max?.[0] != null ? `${Math.round(weather.daily.temperature_2m_max[0])}°` : "—"}</b></span>
              <span className="flex items-center gap-1.5"><Droplets size={12} className="text-sky-200/70" /> {weather?.current?.relative_humidity_2m != null ? `${weather.current.relative_humidity_2m}%` : "—"}</span>
              <span className="flex items-center gap-1.5"><Wind size={12} className="text-slate-400" /> {weather?.current?.wind_speed_10m != null ? `${Math.round(weather.current.wind_speed_10m)} km/h` : "—"}</span>
            </div>
          </GlassCard>

          <GlassCard delay={0.1} className="waste-card hd-glow-mint">
            <SectionHeading icon={Recycle} label="Najbliższy odbiór" accent="text-emerald-300" action={<Link href="/admin" className="rounded-lg p-1 text-slate-600 transition hover:bg-white/5 hover:text-slate-300" title="Zarządzaj harmonogramem"><ArrowRight size={14} /></Link>} />
            <div className="mb-2 flex items-center gap-1.5 text-[9px] text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Harmonogram domowy <span className="ml-auto">{dashboard.garbage.length} terminów</span></div>
            <div className="hd-scroll flex min-h-0 flex-1 flex-col justify-between gap-1">
              {FRACTIONS.map(({ key, label, Icon, color, glow }) => {
                const next = nearestPickup(key);
                const days = next ? daysUntil(next.pickupDate, currentTime) : null;
                return (
                  <div key={key} className="flex min-h-[34px] items-center gap-2 rounded-xl px-1.5 py-1 transition hover:bg-white/[.025]">
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[10px] ${glow} ${color}`}><Icon size={14} strokeWidth={1.8} /></span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-300">{label}</span>
                    <span className={`shrink-0 text-right text-[9px] ${days === 0 ? "font-semibold text-emerald-200" : "text-slate-500"}`}>
                      {next ? days === 0 ? "Dziś" : days === 1 ? "Jutro" : `${days} dni` : "Brak daty"}
                      {next && <span className="ml-1 text-slate-600">· {new Date(next.pickupDate).toLocaleDateString("pl-PL", { day: "2-digit", month: "short" }).replace(".", "")}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex shrink-0 items-center gap-1.5 border-t border-white/[.055] pt-2 text-[9px] text-slate-600"><CalendarDays size={12} /> Terminy aktualizowane w panelu administratora</div>
          </GlassCard>

          <GlassCard delay={0.16} className="stats-card hd-glow-blue">
            <SectionHeading icon={Activity} label="Szybkie statystyki" accent="text-indigo-300" />
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
              <div className="rounded-xl border border-white/[.045] bg-white/[.025] px-3 py-2">
                <p className="text-[8px] font-semibold tracking-[.11em] text-slate-500">TEN TYDZIEŃ</p>
                <p className="mt-1 text-[clamp(1.3rem,2vw,1.8rem)] font-light leading-none tracking-[-.06em] text-slate-100">{formatHours(weekHours)}<span className="ml-1 text-[10px] text-slate-500">h</span></p>
              </div>
              <div className="rounded-xl border border-white/[.045] bg-white/[.025] px-3 py-2">
                <p className="text-[8px] font-semibold tracking-[.11em] text-slate-500">W TYM MIESIĄCU</p>
                <p className="mt-1 text-[clamp(1.3rem,2vw,1.8rem)] font-light leading-none tracking-[-.06em] text-slate-100">{formatHours(monthHours)}<span className="ml-1 text-[10px] text-slate-500">h</span></p>
              </div>
            </div>
            <div className="mt-2 flex shrink-0 items-center gap-2 text-[9px] text-slate-500">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800"><span className="block h-full rounded-full bg-gradient-to-r from-emerald-300/80 to-sky-300/80 transition-all" style={{ width: `${Math.min(100, (weekHours / 40) * 100)}%` }} /></span>
              <span>cel tygodnia · 40 h</span>
            </div>
          </GlassCard>
        </div>

        <div className="dashboard-side center-stack">
          <GlassCard delay={0.08} className="school-card">
            <div className="mb-2 flex shrink-0 items-start justify-between gap-2">
              <SectionHeading icon={CalendarDays} label="Plan lekcji · dziś" accent="text-violet-300" action={<span className="hidden rounded-full border border-slate-700/70 px-2 py-1 text-[8px] font-semibold uppercase tracking-[.12em] text-slate-500 sm:inline">{dayName(currentTime, true)}</span>} />
              <Link href="/admin" className="-mt-0.5 rounded-lg p-1.5 text-slate-600 hover:bg-white/5 hover:text-slate-300" title="Edytuj plan lekcji"><Settings2 size={13} /></Link>
            </div>
            <div className="hd-scroll-x mb-2 flex shrink-0 items-center gap-1.5">
              {children.map((child, index) => (
                <button key={child} onClick={() => setSelectedChild(child)} className={`hd-button rounded-full border px-3 py-1 text-[9px] font-semibold ${activeChild === child ? index % 2 === 0 ? "border-violet-300/25 bg-violet-300/10 text-violet-100" : "border-sky-300/25 bg-sky-300/10 text-sky-100" : "border-slate-800 bg-slate-950/20 text-slate-500 hover:text-slate-300"}`}>
                  <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${index % 2 === 0 ? "bg-violet-300" : "bg-sky-300"}`} />{child}
                </button>
              ))}
              <span className="ml-auto flex items-center gap-1 text-[9px] text-slate-600"><Clock3 size={11} /> {now ? displayTime(now) : "--:--"}</span>
            </div>
            {(currentLesson || nextLesson) && <div className={`mb-2 flex shrink-0 items-center gap-2 rounded-xl border px-2.5 py-1.5 ${currentLesson ? "border-emerald-300/12 bg-emerald-300/[.045]" : "border-white/[.045] bg-white/[.02]"}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${currentLesson ? "status-breathe bg-emerald-200" : "bg-slate-500"}`} />
              <span className="truncate text-[9px] text-slate-300">{currentLesson ? <><b className="font-semibold text-emerald-100">Teraz: {currentLesson.subject}</b> · do końca {Math.max(0, minutesOfDay(currentLesson.endTime) - currentTime.getHours() * 60 - currentTime.getMinutes())} min</> : <>Następna: <b className="font-semibold text-slate-200">{nextLesson?.subject}</b> · {nextLesson?.startTime}</>}</span>
              {currentLesson?.classroom && <span className="ml-auto shrink-0 text-[8px] text-slate-500">s. {currentLesson.classroom}</span>}
            </div>}
            <div className="hd-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
              {!dataReady ? <div className="grid h-full place-items-center text-[11px] text-slate-600">Ładuję plan dnia…</div> : todayLessons.length ? todayLessons.slice(0, 6).map((lesson) => {
                const active = lesson.id === currentLesson?.id;
                const past = minutesOfDay(lesson.endTime) <= currentTime.getHours() * 60 + currentTime.getMinutes();
                return (
                  <div key={lesson.id} className={`flex min-h-[37px] items-center gap-2.5 rounded-xl border px-2.5 py-1.5 transition ${active ? "border-emerald-200/20 bg-emerald-200/[.075] shadow-[0_0_22px_rgba(134,239,172,.035)]" : past ? "border-transparent bg-white/[.012] opacity-50" : "border-transparent bg-white/[.025] hover:border-white/[.055]"}`}>
                    <span className={`w-[72px] shrink-0 font-mono text-[9px] ${active ? "text-emerald-100" : "text-slate-500"}`}>{lesson.startTime}<span className="mx-1 text-slate-700">–</span>{lesson.endTime}</span>
                    <span className={`h-5 w-px shrink-0 ${active ? "bg-emerald-200/40" : "bg-slate-700"}`} />
                    <span className={`min-w-0 flex-1 truncate text-[10px] font-medium ${active ? "text-emerald-50" : "text-slate-300"}`}>{lesson.subject}</span>
                    {lesson.classroom && <span className="shrink-0 rounded-md bg-slate-950/30 px-1.5 py-0.5 text-[8px] text-slate-500">{lesson.classroom}</span>}
                    {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-200" />}
                  </div>
                );
              }) : <div className="grid h-full place-items-center rounded-xl border border-dashed border-slate-800/80 px-4 text-center text-[11px] text-slate-500">{isoWeekday(currentTime) > 5 ? "Weekend bez lekcji · czas na odpoczynek 🌿" : "Dziś nie ma zaplanowanych lekcji."}</div>}
            </div>
            <div className="mt-2 flex shrink-0 items-center justify-between border-t border-white/[.05] pt-2 text-[9px] text-slate-600"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-200" /> Trwająca lekcja</span><Link href="/admin" className="flex items-center gap-1 text-slate-500 transition hover:text-emerald-100">Edytuj plan <ArrowRight size={11} /></Link></div>
          </GlassCard>

          <GlassCard delay={0.14} className="work-card hd-glow-mint">
            <div className="mb-1 flex shrink-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-[10px] bg-emerald-300/[.08] text-emerald-200"><Activity size={15} /></span><span className="hd-overline">Godziny pracy</span></div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-[clamp(1.8rem,3vw,2.5rem)] font-light leading-none tracking-[-.075em] text-slate-50">{formatHours(todayHours)}<span className="ml-1 text-sm text-slate-400">h</span></span>
                  <span className="text-[9px] text-slate-500">dzisiaj</span>
                  {todayHours > 0 && <span className="flex items-center gap-0.5 text-[9px] font-medium text-emerald-200"><Check size={11} /> zapisano</span>}
                </div>
              </div>
              <button onClick={() => setComposer("work")} className="hd-button flex shrink-0 items-center gap-1.5 rounded-xl border border-emerald-200/15 bg-emerald-200/[.07] px-2.5 py-2 text-[9px] font-semibold text-emerald-100 hover:bg-emerald-200/[.13] sm:px-3"><Plus size={13} /> Dodaj wpis</button>
            </div>
            <div className="mb-1 flex shrink-0 items-center justify-between"><p className="text-[9px] text-slate-500">TYDZIEŃ · {formatHours(weekHours)} h <span className="mx-1 text-slate-700">/</span> 40 h</p><Link href="/admin" className="text-[9px] text-slate-600 hover:text-slate-300">rejestr →</Link></div>
            <WeekChart workLogs={dashboard.workLogs} now={currentTime} />
          </GlassCard>
        </div>

        <div className="dashboard-side right-stack">
          <GlassCard delay={0.12} className="tasks-card">
            <SectionHeading icon={CheckCircle2} label="Zadania rodziny" accent="text-amber-200" action={<button onClick={() => setComposer("task")} className="hd-button grid h-7 w-7 place-items-center rounded-lg border border-slate-700/60 bg-white/[.025] text-slate-400 hover:border-emerald-200/25 hover:text-emerald-100" title="Dodaj zadanie"><Plus size={14} /></button>} />
            <div className="mb-2 flex shrink-0 items-center justify-between text-[9px] text-slate-500"><span>{openTasks.length} otwarte <span className="mx-1 text-slate-700">·</span> {dashboard.tasks.filter((task) => task.isCompleted).length} ukończone</span><span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-200" /> domowa lista</span></div>
            <div className="hd-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
              {!dataReady ? <p className="py-3 text-center text-[10px] text-slate-600">Ładuję zadania…</p> : dashboard.tasks.slice(0, 6).map((task) => (
                <div key={task.id} className={`group flex min-h-[34px] items-center gap-2 rounded-xl px-1.5 py-1 transition hover:bg-white/[.025] ${task.isCompleted ? "opacity-50" : ""}`}>
                  <button onClick={() => void toggleTask(task)} aria-label={task.isCompleted ? "Oznacz jako niewykonane" : "Oznacz jako wykonane"} className={`grid h-[17px] w-[17px] shrink-0 place-items-center rounded-[6px] border transition ${task.isCompleted ? "border-emerald-200/50 bg-emerald-200/20 text-emerald-100" : "border-slate-600 text-transparent hover:border-emerald-200/60"}`}>{task.isCompleted && <Check size={11} />}</button>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[10px] font-medium ${task.isCompleted ? "text-slate-500 line-through" : "text-slate-300"}`}>{task.title}</p>
                    <p className="mt-0.5 truncate text-[8px] text-slate-600">{task.assignedTo || "Wszyscy"}{task.dueDate && ` · ${daysUntil(task.dueDate, currentTime) === 0 ? "dzisiaj" : new Date(task.dueDate).toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}`}</p>
                  </div>
                  <button onClick={() => void removeTask(task)} aria-label={`Usuń zadanie ${task.title}`} className="rounded-md p-1 text-slate-700 opacity-0 transition hover:bg-rose-400/10 hover:text-rose-200 group-hover:opacity-100 focus:opacity-100"><X size={12} /></button>
                </div>
              ))}
              {dataReady && dashboard.tasks.length === 0 && <p className="py-4 text-center text-[10px] text-slate-600">Wszystko zrobione. Czas na herbatę ☕</p>}
            </div>
            <button onClick={() => setComposer("task")} className="mt-2 flex shrink-0 items-center gap-1.5 border-t border-white/[.05] pt-2 text-[9px] font-medium text-slate-500 transition hover:text-amber-100"><Plus size={12} /> Dodaj do listy <span className="ml-auto text-slate-700">szybki wpis</span></button>
          </GlassCard>

          <GlassCard delay={0.18} className="notes-card">
            <SectionHeading icon={NotebookPen} label="Przypięte notatki" accent="text-amber-200" action={<button onClick={() => setComposer("note")} className="hd-button grid h-7 w-7 place-items-center rounded-lg border border-slate-700/60 bg-white/[.025] text-slate-400 hover:border-amber-200/25 hover:text-amber-100" title="Dodaj notatkę"><Plus size={14} /></button>} />
            <div className="hd-scroll min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
              {recentNotes.map((note) => {
                const colors: Record<string, string> = {
                  amber: "border-amber-200/10 bg-amber-200/[.055]",
                  violet: "border-violet-200/10 bg-violet-200/[.055]",
                  mint: "border-emerald-200/10 bg-emerald-200/[.055]",
                  sky: "border-sky-200/10 bg-sky-200/[.055]",
                  rose: "border-rose-200/10 bg-rose-200/[.055]",
                };
                return (
                  <div key={note.id} className={`group relative rounded-xl border px-2.5 py-2 ${colors[note.color] || colors.amber}`}>
                    <div className="flex items-center gap-1.5 pr-10"><span className="truncate text-[9px] font-semibold text-slate-200">{note.title || "Notatka"}</span><span className="ml-auto shrink-0 text-[8px] text-slate-600">{new Date(note.createdAt).toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}</span></div>
                    <p className="mt-1 line-clamp-2 text-[9px] leading-[1.45] text-slate-400">{note.content}</p>
                    <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                      <button onClick={() => void toggleNotePin(note)} className="rounded-md p-1 text-slate-500 hover:bg-white/10 hover:text-amber-100" title={note.isPinned ? "Odepnij" : "Przypnij"}><Pin size={10} /></button>
                      <button onClick={() => void removeNote(note)} className="rounded-md p-1 text-slate-500 hover:bg-rose-300/10 hover:text-rose-200" title="Usuń notatkę"><X size={10} /></button>
                    </div>
                  </div>
                );
              })}
              {dataReady && recentNotes.length === 0 && <div className="grid h-full min-h-[58px] place-items-center text-[10px] text-slate-600">Pusto — przypnij ważną myśl.</div>}
            </div>
            <button onClick={() => setComposer("note")} className="mt-2 flex shrink-0 items-center gap-1.5 border-t border-white/[.05] pt-2 text-[9px] font-medium text-slate-500 transition hover:text-amber-100"><Plus size={12} /> Zostaw wiadomość rodzinie</button>
          </GlassCard>

          <GlassCard delay={0.22} className="documents-card hd-glow-coral">
            <SectionHeading icon={FileText} label="Ważne dokumenty" accent="text-rose-200" action={<Link href="/admin" className="rounded-lg p-1 text-slate-600 hover:bg-white/5 hover:text-slate-300" title="Zarządzaj dokumentami"><ArrowRight size={13} /></Link>} />
            <div className="mb-1 flex shrink-0 items-center gap-1.5 text-[9px] text-slate-600"><ShieldAlert size={11} className="text-rose-200/70" /> Alert ważności · najbliższe terminy</div>
            <div className="hd-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
              {!dataReady ? <p className="py-3 text-center text-[10px] text-slate-600">Sprawdzam terminy…</p> : urgentDocuments.map((document) => {
                const days = daysUntil(document.expirationDate, currentTime);
                const urgent = days <= 30;
                return (
                  <div key={document.id} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${urgent ? "border border-rose-300/10 bg-rose-300/[.045]" : "bg-white/[.02]"}`}>
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[9px] ${urgent ? "bg-rose-300/10 text-rose-200" : "bg-white/[.04] text-slate-400"}`}><FileText size={13} /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[9px] font-medium text-slate-300">{document.title}</span><span className="mt-0.5 block truncate text-[8px] text-slate-600">{document.category} <span className="mx-1">·</span> {new Date(document.expirationDate).toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" })}</span></span>
                    <span className={`shrink-0 text-[9px] font-semibold ${urgent ? "text-rose-200" : "text-slate-500"}`}>{days < 0 ? "po terminie" : days === 0 ? "dziś" : `${days} dni`}</span>
                  </div>
                );
              })}
              {dataReady && urgentDocuments.length === 0 && <p className="py-3 text-center text-[10px] text-slate-600">Brak zapisanych terminów.</p>}
            </div>
          </GlassCard>

          <GlassCard delay={0.26} className="assistant-card border-emerald-200/[.09] bg-[linear-gradient(135deg,rgba(19,38,36,.72),rgba(14,20,32,.84))]">
            <button onClick={() => setAssistantOpen(true)} className="group flex min-h-0 flex-1 items-center gap-3 text-left">
              <span className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-emerald-200/10 bg-emerald-200/[.08] text-emerald-100 ${wakeListening ? "status-breathe" : ""}`}><Sparkles size={18} strokeWidth={1.5} /><span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#14201f] bg-emerald-300" /></span>
              <span className="min-w-0 flex-1"><span className="block text-[9px] font-bold tracking-[.12em] text-emerald-100">ASYSTENT DOMOWY</span><span className="mt-1 block truncate text-[9px] text-slate-500">{wakeListening ? `Nasłuchuję „${wakeWord}”` : voiceStatus}</span></span>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-emerald-200/10 bg-emerald-200/[.055] text-emerald-100 transition group-hover:bg-emerald-200/[.11]"><MessageCircle size={15} /></span>
            </button>
            <p className="mt-2 shrink-0 border-t border-white/[.055] pt-2 text-[8px] text-slate-600">Powiedz <b className="font-medium text-slate-400">„{wakeWord}”</b>, aby rozpocząć.</p>
          </GlassCard>
        </div>
      </div>

      <div className="home-footer flex items-center justify-between px-1 pt-2 text-[8px] text-slate-700">
        <span className="flex items-center gap-1.5"><span className="h-1 w-1 rounded-full bg-emerald-300/80" /> {dataReady ? "DOM POŁĄCZONY" : "ŁĄCZENIE Z DOMEM"} <span className="mx-1 text-slate-800">·</span> HomeDash AI</span>
        <span className="hidden sm:inline">Spokojny dom zaczyna się od dobrego planu.</span>
      </div>

      <AnimatePresence>
        {toast && <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="fixed bottom-5 left-1/2 z-[90] -translate-x-1/2 rounded-xl border border-slate-700/80 bg-slate-900/95 px-4 py-2.5 text-center text-[11px] text-slate-100 shadow-xl backdrop-blur-xl" role="status">{toast}</motion.div>}
      </AnimatePresence>

      <AnimatePresence>
        {composer && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-md" onMouseDown={(event) => { if (event.target === event.currentTarget) setComposer(null); }}>
            <motion.div initial={{ opacity: 0, y: 15, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: .98 }} className="hd-card w-full max-w-[440px] p-5 sm:p-6">
              <div className="mb-5 flex items-start justify-between">
                <div><p className="hd-overline">HOME DASH · SZYBKI WPIS</p><h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-100">{composer === "task" ? "Nowe zadanie" : composer === "note" ? "Przypnij notatkę" : "Zapisz godziny pracy"}</h2></div>
                <button onClick={() => setComposer(null)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-white" aria-label="Zamknij"><X size={17} /></button>
              </div>
              <form onSubmit={(event) => void submitComposer(event)} className="space-y-3.5">
                {composer === "task" && <>
                  <label className="block text-[10px] font-medium text-slate-400">Treść zadania<input autoFocus name="title" required maxLength={140} placeholder="np. odebrać paczkę" className="hd-input mt-1.5 h-11 px-3 text-sm" /></label>
                  <label className="block text-[10px] font-medium text-slate-400">Dla kogo<select name="assignedTo" className="hd-input mt-1.5 h-11 px-3 text-sm"><option value="">Wszyscy</option>{(family.length ? family.map((member) => member.name) : children).map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
                </>}
                {composer === "note" && <>
                  <label className="block text-[10px] font-medium text-slate-400">Tytuł<input autoFocus name="title" maxLength={80} placeholder="np. Dziś pamiętaj" className="hd-input mt-1.5 h-11 px-3 text-sm" /></label>
                  <label className="block text-[10px] font-medium text-slate-400">Wiadomość<textarea name="content" required rows={3} maxLength={360} placeholder="Ważna myśl dla całej rodziny…" className="hd-input mt-1.5 resize-none px-3 py-2.5 text-sm" /></label>
                  <label className="block text-[10px] font-medium text-slate-400">Kolor przypinki<select name="color" className="hd-input mt-1.5 h-11 px-3 text-sm"><option value="amber">Słoneczny bursztyn</option><option value="mint">Miętowy</option><option value="sky">Błękitny</option><option value="violet">Lawendowy</option><option value="rose">Różowy</option></select></label>
                </>}
                {composer === "work" && <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="text-[10px] font-medium text-slate-400">Ile godzin<input name="hours" type="number" step="0.25" min="0.25" max="24" placeholder="8" className="hd-input mt-1.5 h-11 px-3 text-sm" /></label><div className="flex items-end pb-3 text-[9px] text-slate-600">albo uzupełnij godziny obok →</div></div>
                  <div className="grid grid-cols-2 gap-3"><label className="text-[10px] font-medium text-slate-400">Od<input name="startTime" type="time" className="hd-input mt-1.5 h-11 px-3 text-sm" /></label><label className="text-[10px] font-medium text-slate-400">Do<input name="endTime" type="time" className="hd-input mt-1.5 h-11 px-3 text-sm" /></label></div>
                  <label className="block text-[10px] font-medium text-slate-400">Nad czym pracujesz?<input name="note" maxLength={180} placeholder="np. Projekt HomeDash" className="hd-input mt-1.5 h-11 px-3 text-sm" /></label>
                </>}
                <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={() => setComposer(null)} className="hd-button rounded-xl border border-slate-700 px-4 py-2.5 text-[11px] text-slate-400 hover:bg-white/5">Anuluj</button><button disabled={composerBusy} type="submit" className="hd-button flex items-center gap-2 rounded-xl border border-emerald-200/20 bg-emerald-200/10 px-4 py-2.5 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-200/15 disabled:opacity-50">{composerBusy && <LoaderCircle size={13} className="animate-spin" />}{composer === "task" ? "Dodaj zadanie" : composer === "note" ? "Przypnij notatkę" : "Zapisz wpis"}</button></div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {assistantOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[85] flex items-end justify-center bg-slate-950/72 p-0 backdrop-blur-md sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setAssistantOpen(false); }}>
            <motion.div initial={{ opacity: 0, y: 22, scale: .99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 15, scale: .99 }} className="hd-card flex h-[min(650px,88dvh)] w-full max-w-[520px] flex-col rounded-b-none p-4 sm:rounded-[24px] sm:p-5">
              <div className="flex shrink-0 items-center gap-3 border-b border-white/[.06] pb-3">
                <span className="grid h-10 w-10 place-items-center rounded-[14px] border border-emerald-200/15 bg-emerald-200/[.08] text-emerald-100"><Sparkles size={19} /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-100">Asystent domowy</span><span className="mt-0.5 flex items-center gap-1.5 text-[9px] text-slate-500"><span className={`h-1.5 w-1.5 rounded-full ${wakeListening ? "bg-rose-300" : "bg-emerald-300"}`} />{wakeListening ? `Nasłuchuję · ${wakeWord}` : voiceStatus}</span></span>
                <button onClick={() => void playSpeech(messages[messages.length - 1]?.content || "Witaj w HomeDash.")} title="Odtwórz ostatnią odpowiedź" className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-emerald-100"><Volume2 size={16} /></button>
                <button onClick={() => setAssistantOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-white" aria-label="Zamknij"><X size={17} /></button>
              </div>
              <div className="hd-scroll min-h-0 flex-1 space-y-3 overflow-y-auto py-4">
                {messages.map((message, index) => (
                  <div key={`${index}-${message.role}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[12px] leading-relaxed ${message.role === "user" ? "rounded-br-md border border-sky-300/15 bg-sky-300/[.08] text-sky-50" : "rounded-bl-md border border-emerald-200/10 bg-emerald-200/[.045] text-slate-200"}`}>
                      {message.role === "assistant" && (
                        <p className="mb-1 flex items-center gap-1.5 text-[8px] font-bold tracking-[.12em] text-emerald-200/65">
                          HOME AI
                          {message.source === "local" && (
                            <span className="rounded-full border border-emerald-200/20 bg-emerald-200/10 px-1.5 py-px text-[7px] font-semibold tracking-normal text-emerald-100">⚡ lokalnie</span>
                          )}
                          {message.source === "groq" && (
                            <span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-1.5 py-px text-[7px] font-semibold tracking-normal text-violet-100">🤖 Groq</span>
                          )}
                          {message.source === "openrouter" && (
                            <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-1.5 py-px text-[7px] font-semibold tracking-normal text-sky-100">🤖 AI</span>
                          )}
                        </p>
                      )}
                      {message.content}
                      {message.tools && message.tools.length > 0 && (
                        <span className="mt-2 flex flex-wrap gap-1">
                          {message.tools.map((toolName) => (
                            <span key={toolName} className="rounded-full border border-emerald-200/15 bg-emerald-200/[.07] px-1.5 py-0.5 text-[7px] font-semibold tracking-[.06em] text-emerald-200/80">
                              {TOOL_LABELS[toolName] || toolName}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {assistantBusy && <div className="flex items-center gap-2 text-[10px] text-slate-500"><span className="flex gap-1"><i className="h-1 w-1 animate-pulse rounded-full bg-emerald-200" /><i className="h-1 w-1 animate-pulse rounded-full bg-emerald-200 [animation-delay:120ms]" /><i className="h-1 w-1 animate-pulse rounded-full bg-emerald-200 [animation-delay:240ms]" /></span>Asystent układa odpowiedź…</div>}
              </div>
              <div className="shrink-0 border-t border-white/[.06] pt-3">
                <div className="mb-2 flex flex-wrap gap-1.5">{["Dodaj zadanie: kupić mleko", "Ile godzin dziś pracowałam?", "Kiedy plastik?"].map((suggestion) => <button key={suggestion} onClick={() => { const short = suggestion === "Ile godzin dziś pracowałam?" ? "Podsumuj moje godziny pracy w tym tygodniu" : suggestion; void handleUserCommand(short); }} className="rounded-full border border-slate-700/70 px-2.5 py-1 text-[8px] text-slate-500 transition hover:border-emerald-200/20 hover:text-emerald-100">{suggestion}</button>)}</div>
                {dictation.isListening && <p className="mb-2 flex items-center gap-1.5 text-[9px] font-medium text-rose-200"><span className="status-breathe h-1.5 w-1.5 rounded-full bg-rose-300" /> Słucham… powiedz komendę po polsku</p>}
                {dictation.error && <p className="mb-2 text-[9px] text-rose-200/90">{dictation.error}</p>}
                <form onSubmit={(event) => void submitAssistant(event)} className="flex items-center gap-2 rounded-xl border border-slate-700/70 bg-slate-950/40 p-1.5 pl-3">
                  <input ref={assistantInputRef} disabled={assistantBusy} placeholder="Zapytaj HomeDash…" className="min-w-0 flex-1 bg-transparent py-2 text-[12px] text-slate-100 outline-none placeholder:text-slate-600" />
                  {dictation.supported ? (
                    <button type="button" onClick={() => dictation.toggleListening()} title="Dyktuj komendę (mowa → tekst na urządzeniu)" className={`grid h-9 w-9 place-items-center rounded-lg transition ${dictation.isListening ? "animate-pulse bg-rose-300/15 text-rose-200" : "text-slate-500 hover:bg-white/5 hover:text-emerald-100"}`} aria-label={dictation.isListening ? "Zatrzymaj dyktowanie" : "Dyktuj komendę głosowo"}><Mic size={15} /></button>
                  ) : (
                    <button type="button" onClick={() => setWakeListening((value) => !value)} className={`grid h-9 w-9 place-items-center rounded-lg ${wakeListening ? "bg-rose-300/10 text-rose-200" : "text-slate-500 hover:bg-white/5 hover:text-emerald-100"}`} aria-label="Mikrofon"><Mic size={15} /></button>
                  )}
                  <button disabled={assistantBusy} type="submit" aria-label="Wyślij wiadomość" className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-200/10 text-emerald-100 transition hover:bg-emerald-200/20 disabled:opacity-40"><Send size={14} /></button>
                </form>
                <p className="mt-2 text-center text-[8px] text-slate-700">Głos jest obsługiwany przez Web Speech API przeglądarki.</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {speaking && <div className="pointer-events-none fixed right-4 top-4 z-[100] flex items-center gap-1.5 rounded-full border border-emerald-200/10 bg-slate-900/85 px-2.5 py-1.5 text-[8px] text-emerald-100 shadow-lg"><Volume2 size={11} className="animate-pulse" /> odczytuję</div>}
    </main>
  );
}
