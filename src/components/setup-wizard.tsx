"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Cloud,
  Database,
  FileText,
  HardDrive,
  House,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  Mic,
  Plus,
  Recycle,
  Sparkles,
  Trash2,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type FamilyMember = { name: string; role: "parent" | "child" };
type Lesson = { id: string; childName: string; dayOfWeek: number; startTime: string; endTime: string; subject: string; classroom: string | null };
type GarbageItem = { id: string; fraction: string; pickupDate: string };
type DocumentItem = { id: string; title: string; category: string; expirationDate: string };
type SetupStatus = {
  completed: boolean;
  databaseTarget: "turso" | "local-file";
  config: Record<string, string>;
  family: FamilyMember[];
  hasPin?: boolean;
};

const DAYS = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek"];
const FRACTIONS = [
  { key: "BIO", label: "Bio", hint: "odpady kuchenne i zielone" },
  { key: "PLASTIC_METAL", label: "Plastik i metal", hint: "opakowania, puszki" },
  { key: "MIXED", label: "Zmieszane", hint: "odpady resztkowe" },
  { key: "GLASS", label: "Szkło", hint: "butelki i słoiki" },
];
const STEPS: Array<{ id: string; title: string; subtitle: string; icon: LucideIcon }> = [
  { id: "database", title: "Połączenie z bazą", subtitle: "Sprawdź, gdzie mieszka Twój dom", icon: Database },
  { id: "home", title: "Dom i lokalizacja", subtitle: "Miejscowość, pogoda i asystent głosowy", icon: House },
  { id: "family", title: "Domownicy", subtitle: "Kto korzysta z tablicy", icon: Users },
  { id: "lessons", title: "Plan lekcji", subtitle: "Zajęcia dzieci w tygodniu", icon: CalendarDays },
  { id: "waste", title: "Wywóz odpadów", subtitle: "Cztery frakcje albo plik ICS z gminy", icon: Recycle },
  { id: "documents", title: "Ważne dokumenty", subtitle: "Przypomnienia o terminach", icon: FileText },
  { id: "security", title: "PIN i start", subtitle: "Zabezpiecz panel i uruchom dashboard", icon: LockKeyhole },
];

function localDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function noonIso(value: string) {
  return value ? new Date(`${value}T12:00:00`).toISOString() : "";
}

function prettyDate(value: string) {
  return new Date(value).toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" });
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-[11px] font-medium text-slate-400">
      {children}
      {hint && <span className="mt-0.5 block text-[9px] font-normal text-slate-600">{hint}</span>}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`hd-input mt-1.5 h-11 px-3 text-[13px] ${props.className || ""}`} />;
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`hd-input mt-1.5 h-11 px-3 text-[13px] ${props.className || ""}`} />;
}

function ActionButton({
  children,
  onClick,
  type = "button",
  disabled,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  variant?: "primary" | "subtle" | "ghost";
}) {
  const style =
    variant === "primary"
      ? "border-emerald-200/20 bg-emerald-200/[.1] text-emerald-100 hover:bg-emerald-200/[.17]"
      : variant === "subtle"
        ? "border-slate-700 bg-white/[.02] text-slate-300 hover:bg-white/[.06]"
        : "border-transparent bg-transparent text-slate-500 hover:text-slate-200";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`hd-button inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${style}`}
    >
      {children}
    </button>
  );
}

function StepShell({
  step,
  children,
  footer,
}: {
  step: (typeof STEPS)[number];
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const Icon = step.icon;
  return (
    <motion.div
      key={step.id}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="hd-card flex min-h-0 flex-col p-5 sm:p-7"
    >
      <div className="mb-5 flex items-start gap-3.5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-emerald-200/12 bg-emerald-200/[.07] text-emerald-100">
          <Icon size={20} strokeWidth={1.6} />
        </span>
        <div className="min-w-0">
          <p className="hd-overline">KROK {STEPS.findIndex((item) => item.id === step.id) + 1} Z {STEPS.length}</p>
          <h2 className="mt-1 text-[clamp(1.2rem,2.6vw,1.6rem)] font-semibold tracking-[-.04em] text-slate-100">{step.title}</h2>
          <p className="mt-1 text-[11px] text-slate-500">{step.subtitle}</p>
        </div>
      </div>
      <div className="hd-scroll min-h-0 flex-1 overflow-y-auto pr-1">{children}</div>
      <div className="mt-5 flex shrink-0 items-center justify-between gap-3 border-t border-white/[.06] pt-4">{footer}</div>
    </motion.div>
  );
}

export default function SetupWizard() {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [garbage, setGarbage] = useState<GarbageItem[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [homeForm, setHomeForm] = useState({ home_city: "", city_lat: "", city_lon: "", wake_word: "Hej Dash", tts_voice: "pl-PL-ZofiaNeural" });
  const [memberDraft, setMemberDraft] = useState({ name: "", role: "parent" as "parent" | "child" });
  const [lessonDraft, setLessonDraft] = useState({ childName: "", dayOfWeek: "1", startTime: "08:00", endTime: "08:45", subject: "", classroom: "" });
  const [wasteDraft, setWasteDraft] = useState({ fraction: "BIO", pickupDate: "" });
  const [documentDraft, setDocumentDraft] = useState({ title: "", category: "DOKUMENT", expirationDate: "" });
  const [pinDraft, setPinDraft] = useState("");
  const [icsPreview, setIcsPreview] = useState("");

  const step = STEPS[index];
  const children = (status?.family || []).filter((member) => member.role === "child");
  const canFinish =
    Boolean(status?.config.home_city) &&
    (status?.family.length || 0) > 0 &&
    (status?.hasPin === true || /^\d{4,8}$/.test(pinDraft));

  const load = useCallback(async () => {
    try {
      const [setupResponse, dataResponse] = await Promise.all([
        fetch("/api/setup", { cache: "no-store" }),
        fetch("/api/dashboard", { cache: "no-store" }),
      ]);
      const setup = (await setupResponse.json()) as SetupStatus & { config: Record<string, string> };
      const data = (await dataResponse.json()) as { timetable: Lesson[]; garbage: GarbageItem[]; documents: DocumentItem[]; config: Record<string, string> };
      setStatus({ ...setup, config: { ...setup.config, ...data.config } });
      setLessons(data.timetable || []);
      setGarbage(data.garbage || []);
      setDocuments(data.documents || []);
      setHomeForm((previous) => ({
        home_city: previous.home_city || data.config.home_city || "",
        city_lat: previous.city_lat || data.config.city_lat || "",
        city_lon: previous.city_lon || data.config.city_lon || "",
        wake_word: previous.wake_word !== "Hej Dash" ? previous.wake_word : data.config.wake_word || "Hej Dash",
        tts_voice: data.config.tts_voice || previous.tts_voice,
      }));
      setLessonDraft((previous) => ({ ...previous, childName: previous.childName || (setup.family || []).find((member) => member.role === "child")?.name || "" }));
      if (setup.completed) router.replace("/");
    } catch {
      setError("Nie udało się połączyć z bazą danych. Sprawdź konfigurację TURSO_DATABASE_URL.");
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post<T = unknown>(action: string, payload: Record<string, unknown> = {}, successMessage = "") {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string } & T;
      if (!response.ok) throw new Error(result.error || "Nie udało się zapisać kroku.");
      await load();
      if (successMessage) setNotice(successMessage);
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Wystąpił nieoczekiwany błąd.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function importIcs(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) {
      setError("Plik ICS może mieć maksymalnie 1 MB.");
      event.target.value = "";
      return;
    }
    setBusy("ics-import");
    setError("");
    setNotice("");
    setIcsPreview("");
    try {
      const content = await file.text();
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ics-import", content }),
      });
      const result = (await response.json()) as { error?: string; imported?: number; detected?: number };
      if (!response.ok) throw new Error(result.error || "Nie udało się odczytać pliku ICS.");
      setIcsPreview(`Rozpoznano ${result.detected ?? 0} wydarzeń, dodano ${result.imported ?? 0} nowych terminów.`);
      await load();
      setNotice(result.imported ? "Harmonogram gminny zaimportowany." : "Plik wczytany — wszystkie terminy były już w bazie.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się zaimportować pliku.");
    } finally {
      setBusy("");
      event.target.value = "";
    }
  }

  async function finish() {
    if (pinDraft) {
      const saved = await post("pin", { admin_pin: pinDraft });
      if (!saved) return;
    }
    const result = await post("finish", {}, "Konfiguracja zakończona.");
    if (result) router.replace("/");
  }

  const isTurso = status?.databaseTarget === "turso";
  const progress = ((index + 1) / STEPS.length) * 100;

  return (
    <main className="setup-page min-h-dvh px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto grid w-full max-w-[1180px] gap-5 lg:grid-cols-[268px_minmax(0,1fr)]">
        <aside className="hd-card h-fit p-4 lg:sticky lg:top-6">
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-2xl border border-emerald-200/12 bg-emerald-200/[.07] text-emerald-100">
              <House size={19} strokeWidth={1.6} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold tracking-[-.03em] text-slate-100">HomeDash AI</p>
              <p className="text-[9px] text-slate-500">Pierwsze uruchomienie</p>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between text-[9px] text-slate-500">
              <span>Postęp konfiguracji</span>
              <span className="font-semibold text-emerald-200">{Math.round(progress)}%</span>
            </div>
            <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-slate-800">
              <motion.span
                className="block h-full rounded-full bg-gradient-to-r from-emerald-300/80 to-sky-300/70"
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </span>
          </div>

          <nav className="mt-4 space-y-1">
            {STEPS.map((item, itemIndex) => {
              const Icon = item.icon;
              const done = itemIndex < index;
              const active = itemIndex === index;
              return (
                <button
                  key={item.id}
                  onClick={() => setIndex(itemIndex)}
                  className={`hd-button flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[10px] ${
                    active
                      ? "border border-emerald-200/12 bg-emerald-200/[.07] text-emerald-50"
                      : "border border-transparent text-slate-500 hover:bg-white/[.035] hover:text-slate-200"
                  }`}
                >
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ${active ? "bg-emerald-200/15 text-emerald-100" : done ? "bg-white/[.05] text-emerald-200/80" : "bg-white/[.03] text-slate-500"}`}>
                    {done ? <Check size={12} /> : <Icon size={12} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="text-[8px] text-slate-600">{itemIndex + 1}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-800/80 bg-slate-950/40 px-3 py-2.5 text-[9px] text-slate-500">
            {isTurso ? <Cloud size={14} className="shrink-0 text-sky-300" /> : <HardDrive size={14} className="shrink-0 text-emerald-300" />}
            <span className="min-w-0">
              {status ? (isTurso ? "Baza: Turso (libSQL)" : "Baza: lokalny plik SQLite") : "Łączę z bazą…"}
            </span>
          </div>
        </aside>

        <section className="min-w-0">
          {error && (
            <div role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-rose-300/15 bg-rose-300/[.06] px-3.5 py-2.5 text-[11px] text-rose-100">
              <Trash2 size={14} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
          {notice && (
            <div role="status" className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200/15 bg-emerald-200/[.055] px-3.5 py-2.5 text-[11px] text-emerald-100">
              <CheckCircle2 size={14} /> {notice}
            </div>
          )}

          <AnimatePresence mode="wait">
            {step.id === "database" && (
              <StepShell
                step={step}
                footer={
                  <>
                    <span className="text-[9px] text-slate-600">Baza jest pusta — żadnych danych demonstracyjnych.</span>
                    <ActionButton onClick={() => setIndex(1)}>Dalej <ArrowRight size={14} /></ActionButton>
                  </>
                }
              >
                <div className="space-y-3">
                  <div className={`rounded-2xl border p-4 ${isTurso ? "border-sky-200/12 bg-sky-200/[.045]" : "border-emerald-200/12 bg-emerald-200/[.04]"}`}>
                    <div className="flex items-center gap-2.5">
                      {isTurso ? <Cloud size={17} className="text-sky-200" /> : <HardDrive size={17} className="text-emerald-200" />}
                      <p className="text-[12px] font-semibold text-slate-100">{status ? (isTurso ? "Połączono z Turso" : "Połączono z lokalną bazą SQLite") : "Sprawdzam połączenie…"}</p>
                      <span className="ml-auto flex items-center gap-1.5 text-[9px] text-slate-500">
                        <span className={`h-1.5 w-1.5 rounded-full ${status ? "bg-emerald-300" : "bg-amber-300 animate-pulse"}`} />
                        {status ? "gotowa" : "oczekiwanie"}
                      </span>
                    </div>
                    <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                      {isTurso
                        ? "Wszystkie dane rodziny zapisują się w chmurze Turso (libSQL). Tabele tworzą się automatycznie przy pierwszym zapytaniu."
                        : "Dane zapisują się w pliku data/homedash.db. Ustaw TURSO_DATABASE_URL, aby przenieść dom do chmury Turso."}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-800/80 bg-white/[.02] p-3.5">
                      <p className="hd-overline">TRYB PRODUKCJI · TURSO</p>
                      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                        W <code className="text-slate-300">.env</code> ustaw <code className="text-slate-300">TURSO_DATABASE_URL=libsql://twoja-baza.turso.io</code> oraz <code className="text-slate-300">TURSO_AUTH_TOKEN</code>.
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-800/80 bg-white/[.02] p-3.5">
                      <p className="hd-overline">TRYB LOKALNY · PLIK</p>
                      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                        Wystarczy <code className="text-slate-300">DATABASE_URL=file:./data/homedash.db</code>. Ten sam schemat działa potem na Turso.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 rounded-xl border border-slate-800/70 bg-slate-950/30 px-3.5 py-3 text-[10px] text-slate-500">
                    <Sparkles size={14} className="shrink-0 text-emerald-200" />
                    Konfigurator zapisuje wyłącznie Twoje prawdziwe dane. Nie tworzymy żadnych przykładowych zadań, lekcji ani terminów.
                  </div>
                </div>
              </StepShell>
            )}

            {step.id === "home" && (
              <StepShell
                step={step}
                footer={
                  <>
                    <ActionButton variant="subtle" onClick={() => setIndex(0)}><ArrowLeft size={14} /> Wstecz</ActionButton>
                    <ActionButton disabled={!homeForm.home_city || busy === "profile"} onClick={() => void post("profile", homeForm, "Zapisano dom i lokalizację.").then(() => setIndex(2))}>
                      {busy === "profile" ? <LoaderCircle size={14} className="animate-spin" /> : null} Zapisz i dalej <ArrowRight size={14} />
                    </ActionButton>
                  </>
                }
              >
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label hint="Wyświetlana w nagłówku dashboardu i w kafelku pogody">Miejscowość</Label>
                    <Input value={homeForm.home_city} onChange={(event) => setHomeForm({ ...homeForm, home_city: event.target.value })} placeholder="np. Kraków" maxLength={80} />
                  </div>
                  <div>
                    <Label hint="Dane pogodowe pobieramy z Open-Meteo">Szerokość geograficzna</Label>
                    <Input type="number" step="any" min={-90} max={90} value={homeForm.city_lat} onChange={(event) => setHomeForm({ ...homeForm, city_lat: event.target.value })} placeholder="50.0614" />
                  </div>
                  <div>
                    <Label>Długość geograficzna</Label>
                    <Input type="number" step="any" min={-180} max={180} value={homeForm.city_lon} onChange={(event) => setHomeForm({ ...homeForm, city_lon: event.target.value })} placeholder="19.9372" />
                  </div>
                  <div>
                    <Label hint="Powiedz to hasło, aby obudzić asystenta">Słowo wybudzające</Label>
                    <div className="relative">
                      <Mic size={14} className="pointer-events-none absolute left-3 top-1/2 mt-0.5 -translate-y-1/2 text-slate-600" />
                      <Input className="pl-9" value={homeForm.wake_word} onChange={(event) => setHomeForm({ ...homeForm, wake_word: event.target.value })} maxLength={48} />
                    </div>
                  </div>
                  <div>
                    <Label hint="Głos lektora Microsoft Edge TTS">Głos odpowiedzi</Label>
                    <Select value={homeForm.tts_voice} onChange={(event) => setHomeForm({ ...homeForm, tts_voice: event.target.value })}>
                      <option value="pl-PL-ZofiaNeural">Zofia (kobiecy)</option>
                      <option value="pl-PL-MarekNeural">Marek (męski)</option>
                    </Select>
                  </div>
                </div>
              </StepShell>
            )}

            {step.id === "family" && (
              <StepShell
                step={step}
                footer={
                  <>
                    <ActionButton variant="subtle" onClick={() => setIndex(1)}><ArrowLeft size={14} /> Wstecz</ActionButton>
                    <ActionButton disabled={(status?.family.length || 0) === 0} onClick={() => setIndex(3)}>Dalej <ArrowRight size={14} /></ActionButton>
                  </>
                }
              >
                <div className="space-y-3.5">
                  <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
                    <div>
                      <Label>Imię domownika</Label>
                      <Input value={memberDraft.name} onChange={(event) => setMemberDraft({ ...memberDraft, name: event.target.value })} placeholder="np. Ania" maxLength={48} />
                    </div>
                    <div>
                      <Label>Rola</Label>
                      <Select value={memberDraft.role} onChange={(event) => setMemberDraft({ ...memberDraft, role: event.target.value as "parent" | "child" })}>
                        <option value="parent">Rodzic</option>
                        <option value="child">Dziecko</option>
                      </Select>
                    </div>
                    <div className="flex items-end">
                      <ActionButton
                        disabled={!memberDraft.name.trim() || busy === "family"}
                        onClick={() =>
                          void post(
                            "family",
                            { members: [...(status?.family || []), { name: memberDraft.name.trim(), role: memberDraft.role }] },
                            `${memberDraft.name.trim()} dodany do rodziny.`,
                          ).then(() => setMemberDraft({ name: "", role: "parent" }))
                        }
                      >
                        <Plus size={14} /> Dodaj
                      </ActionButton>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {(status?.family || []).length === 0 && (
                      <div className="rounded-xl border border-dashed border-slate-800 px-4 py-7 text-center text-[10px] text-slate-600">
                        Dodaj domowników — ich imiona pojawią się przy zadaniach i w planie lekcji.
                      </div>
                    )}
                    {(status?.family || []).map((member, memberIndex) => (
                      <div key={`${member.name}-${memberIndex}`} className="flex items-center gap-3 rounded-xl border border-slate-800/80 bg-white/[.02] px-3.5 py-2.5">
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${member.role === "child" ? "bg-violet-300/[.09] text-violet-200" : "bg-emerald-200/[.08] text-emerald-100"}`}>
                          <Users size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-medium text-slate-200">{member.name}</span>
                          <span className="text-[9px] text-slate-600">{member.role === "child" ? "Dziecko · plan lekcji" : "Rodzic · zadania i dokumenty"}</span>
                        </span>
                        <button
                          onClick={() => void post("family", { members: (status?.family || []).filter((_, position) => position !== memberIndex) }, "Usunięto domownika.")}
                          className="rounded-lg p-1.5 text-slate-600 hover:bg-rose-300/10 hover:text-rose-200"
                          title="Usuń domownika"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </StepShell>
            )}

            {step.id === "lessons" && (
              <StepShell
                step={step}
                footer={
                  <>
                    <ActionButton variant="subtle" onClick={() => setIndex(2)}><ArrowLeft size={14} /> Wstecz</ActionButton>
                    <ActionButton onClick={() => setIndex(4)}>{children.length === 0 ? "Pomiń i dalej" : "Dalej"} <ArrowRight size={14} /></ActionButton>
                  </>
                }
              >
                {children.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-800 px-4 py-8 text-center text-[10px] leading-relaxed text-slate-600">
                    Nie dodano jeszcze żadnego dziecka. Wróć do kroku „Domownicy”, aby dodać dzieci, albo pomiń ten krok.
                  </div>
                ) : (
                  <div className="space-y-3.5">
                    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <Label>Dziecko</Label>
                        <Select value={lessonDraft.childName} onChange={(event) => setLessonDraft({ ...lessonDraft, childName: event.target.value })}>
                          <option value="">Wybierz…</option>
                          {children.map((child) => <option key={child.name} value={child.name}>{child.name}</option>)}
                        </Select>
                      </div>
                      <div>
                        <Label>Dzień</Label>
                        <Select value={lessonDraft.dayOfWeek} onChange={(event) => setLessonDraft({ ...lessonDraft, dayOfWeek: event.target.value })}>
                          {DAYS.map((day, dayIndex) => <option key={day} value={dayIndex + 1}>{day}</option>)}
                        </Select>
                      </div>
                      <div>
                        <Label>Od</Label>
                        <Input type="time" value={lessonDraft.startTime} onChange={(event) => setLessonDraft({ ...lessonDraft, startTime: event.target.value })} />
                      </div>
                      <div>
                        <Label>Do</Label>
                        <Input type="time" value={lessonDraft.endTime} onChange={(event) => setLessonDraft({ ...lessonDraft, endTime: event.target.value })} />
                      </div>
                      <div className="sm:col-span-2 lg:col-span-2">
                        <Label>Przedmiot</Label>
                        <Input value={lessonDraft.subject} onChange={(event) => setLessonDraft({ ...lessonDraft, subject: event.target.value })} placeholder="np. Matematyka" maxLength={80} />
                      </div>
                      <div>
                        <Label>Sala (opcjonalnie)</Label>
                        <Input value={lessonDraft.classroom} onChange={(event) => setLessonDraft({ ...lessonDraft, classroom: event.target.value })} placeholder="np. 12" maxLength={30} />
                      </div>
                      <div className="flex items-end">
                        <ActionButton
                          disabled={!lessonDraft.childName || !lessonDraft.subject || busy === "lesson-add"}
                          onClick={() => void post("lesson-add", { ...lessonDraft, dayOfWeek: Number(lessonDraft.dayOfWeek) }, "Lekcja dodana.").then(() => setLessonDraft({ ...lessonDraft, subject: "", classroom: "" }))}
                        >
                          {busy === "lesson-add" ? <LoaderCircle size={14} className="animate-spin" /> : <Plus size={14} />} Dodaj lekcję
                        </ActionButton>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      {children.map((child) => {
                        const childLessons = lessons.filter((lesson) => lesson.childName === child.name);
                        if (childLessons.length === 0) return null;
                        return (
                          <div key={child.name} className="rounded-xl border border-slate-800/80 bg-white/[.02] p-3">
                            <p className="mb-2 flex items-center gap-2 text-[10px] font-semibold text-slate-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-violet-300" /> {child.name}
                              <span className="ml-auto text-[9px] font-normal text-slate-600">{childLessons.length} lekcji</span>
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {childLessons.map((lesson) => (
                                <span key={lesson.id} className="group flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/40 px-2 py-1 text-[9px] text-slate-400">
                                  <span className="text-slate-600">{DAYS[lesson.dayOfWeek - 1]?.slice(0, 3)}</span>
                                  <span className="font-mono text-slate-500">{lesson.startTime}</span>
                                  <span className="text-slate-200">{lesson.subject}</span>
                                  <button onClick={() => void post("lesson-delete", { id: lesson.id })} className="text-slate-600 hover:text-rose-200" title="Usuń lekcję">
                                    <Trash2 size={10} />
                                  </button>
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                      {lessons.length === 0 && (
                        <div className="rounded-xl border border-dashed border-slate-800 px-4 py-6 text-center text-[10px] text-slate-600">Plan jest pusty — dodaj pierwsze zajęcia powyżej.</div>
                      )}
                    </div>
                  </div>
                )}
              </StepShell>
            )}

            {step.id === "waste" && (
              <StepShell
                step={step}
                footer={
                  <>
                    <ActionButton variant="subtle" onClick={() => setIndex(3)}><ArrowLeft size={14} /> Wstecz</ActionButton>
                    <ActionButton onClick={() => setIndex(5)}>Dalej <ArrowRight size={14} /></ActionButton>
                  </>
                }
              >
                <div className="space-y-3.5">
                  <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <div>
                      <Label>Frakcja</Label>
                      <Select value={wasteDraft.fraction} onChange={(event) => setWasteDraft({ ...wasteDraft, fraction: event.target.value })}>
                        {FRACTIONS.map((fraction) => <option key={fraction.key} value={fraction.key}>{fraction.label} · {fraction.hint}</option>)}
                      </Select>
                    </div>
                    <div>
                      <Label>Data odbioru</Label>
                      <Input type="date" value={wasteDraft.pickupDate} onChange={(event) => setWasteDraft({ ...wasteDraft, pickupDate: event.target.value })} />
                    </div>
                    <div className="flex items-end">
                      <ActionButton
                        disabled={!wasteDraft.pickupDate || busy === "waste-add"}
                        onClick={() => void post("waste-add", { fraction: wasteDraft.fraction, pickupDate: noonIso(wasteDraft.pickupDate) }, "Termin dodany.").then(() => setWasteDraft({ ...wasteDraft, pickupDate: "" }))}
                      >
                        {busy === "waste-add" ? <LoaderCircle size={14} className="animate-spin" /> : <Plus size={14} />} Dodaj termin
                      </ActionButton>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-200/10 bg-sky-200/[.035] p-3.5">
                    <Upload size={16} className="shrink-0 text-sky-200" />
                    <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-slate-500">
                      Masz harmonogram z gminy w pliku <b className="text-slate-300">.ics</b>? Wczytaj go — rozpoznamy cztery frakcje, także terminy cykliczne.
                      {icsPreview && <span className="mt-1 block text-sky-200">{icsPreview}</span>}
                    </p>
                    <label className="hd-button inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border border-sky-200/15 bg-sky-200/[.06] px-3 text-[10px] font-semibold text-sky-100 hover:bg-sky-200/10">
                      {busy === "ics-import" ? <LoaderCircle size={13} className="animate-spin" /> : <Upload size={13} />}
                      {busy === "ics-import" ? "Importuję…" : "Wybierz plik ICS"}
                      <input type="file" accept=".ics,text/calendar" disabled={!!busy} onChange={(event) => void importIcs(event)} className="sr-only" />
                    </label>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {FRACTIONS.map((fraction) => {
                      const entries = garbage.filter((item) => item.fraction === fraction.key);
                      return (
                        <div key={fraction.key} className="rounded-xl border border-slate-800/80 bg-white/[.02] p-3">
                          <p className="flex items-center gap-2 text-[10px] font-semibold text-slate-300">
                            <Recycle size={13} className="text-emerald-200" /> {fraction.label}
                            <span className="ml-auto text-[9px] font-normal text-slate-600">{entries.length}</span>
                          </p>
                          <div className="mt-2 space-y-1">
                            {entries.slice(0, 4).map((item) => (
                              <div key={item.id} className="flex items-center gap-2 text-[9px] text-slate-500">
                                <MapPin size={10} className="text-slate-700" /> {prettyDate(item.pickupDate)}
                                <button onClick={() => void post("waste-delete", { id: item.id })} className="ml-auto text-slate-600 hover:text-rose-200" title="Usuń termin"><Trash2 size={10} /></button>
                              </div>
                            ))}
                            {entries.length === 0 && <p className="text-[9px] text-slate-700">Brak terminów</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </StepShell>
            )}

            {step.id === "documents" && (
              <StepShell
                step={step}
                footer={
                  <>
                    <ActionButton variant="subtle" onClick={() => setIndex(4)}><ArrowLeft size={14} /> Wstecz</ActionButton>
                    <ActionButton onClick={() => setIndex(6)}>Dalej <ArrowRight size={14} /></ActionButton>
                  </>
                }
              >
                <div className="space-y-3.5">
                  <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <div>
                      <Label>Dokument / sprawa</Label>
                      <Input value={documentDraft.title} onChange={(event) => setDocumentDraft({ ...documentDraft, title: event.target.value })} placeholder="np. Przegląd samochodu" maxLength={100} />
                    </div>
                    <div>
                      <Label>Kategoria</Label>
                      <Select value={documentDraft.category} onChange={(event) => setDocumentDraft({ ...documentDraft, category: event.target.value })}>
                        <option value="DOKUMENT">Dokument</option>
                        <option value="AUTO">Samochód</option>
                        <option value="UBEZPIECZENIE">Ubezpieczenie</option>
                        <option value="ZDROWIE">Zdrowie</option>
                        <option value="INNE">Inne</option>
                      </Select>
                    </div>
                    <div>
                      <Label hint="Alert 30 dni przed">Ważny do</Label>
                      <Input type="date" value={documentDraft.expirationDate} onChange={(event) => setDocumentDraft({ ...documentDraft, expirationDate: event.target.value })} />
                    </div>
                    <div className="flex items-end">
                      <ActionButton
                        disabled={!documentDraft.title || !documentDraft.expirationDate || busy === "document-add"}
                        onClick={() => void post("document-add", { ...documentDraft, expirationDate: noonIso(documentDraft.expirationDate) }, "Przypomnienie dodane.").then(() => setDocumentDraft({ ...documentDraft, title: "", expirationDate: "" }))}
                      >
                        {busy === "document-add" ? <LoaderCircle size={14} className="animate-spin" /> : <Plus size={14} />} Dodaj
                      </ActionButton>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {documents.map((document) => (
                      <div key={document.id} className="flex items-center gap-3 rounded-xl border border-slate-800/80 bg-white/[.02] px-3.5 py-2.5">
                        <FileText size={14} className="shrink-0 text-slate-500" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-medium text-slate-200">{document.title}</span>
                          <span className="text-[9px] text-slate-600">{document.category} · {prettyDate(document.expirationDate)}</span>
                        </span>
                        <button onClick={() => void post("document-delete", { id: document.id })} className="rounded-lg p-1.5 text-slate-600 hover:bg-rose-300/10 hover:text-rose-200" title="Usuń"><Trash2 size={13} /></button>
                      </div>
                    ))}
                    {documents.length === 0 && (
                      <div className="rounded-xl border border-dashed border-slate-800 px-4 py-7 text-center text-[10px] text-slate-600">
                        Ten krok jest opcjonalny. Dodasz dokumenty później w panelu administratora.
                      </div>
                    )}
                  </div>
                </div>
              </StepShell>
            )}

            {step.id === "security" && (
              <StepShell
                step={step}
                footer={
                  <>
                    <ActionButton variant="subtle" onClick={() => setIndex(5)}><ArrowLeft size={14} /> Wstecz</ActionButton>
                    <ActionButton disabled={busy === "finish" || busy === "pin"} onClick={() => void finish()}>
                      {busy === "finish" || busy === "pin" ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />} Uruchom HomeDash
                    </ActionButton>
                  </>
                }
              >
                <div className="space-y-3.5">
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div>
                      <Label hint="4–8 cyfr, chroni panel /admin">PIN administratora</Label>
                      <Input
                        type="password"
                        inputMode="numeric"
                        minLength={4}
                        maxLength={8}
                        value={pinDraft}
                        onChange={(event) => setPinDraft(event.target.value.replace(/\D/g, ""))}
                        placeholder="••••"
                        className="tracking-[.35em]"
                      />
                    </div>
                    <div className="flex items-end">
                      <div className="w-full rounded-xl border border-slate-800/70 bg-slate-950/30 px-3.5 py-3 text-[9px] leading-relaxed text-slate-500">
                        PIN zapisujemy wyłącznie po stronie serwera i nigdy nie pokazujemy go na dashboardzie. Jeśli ustawisz zmienną <code className="text-slate-400">ADMIN_PIN</code>, to ona będzie nadrzędna.
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-800/80 bg-white/[.02] p-3.5">
                    <p className="hd-overline">PODSUMOWANIE KONFIGURACJI</p>
                    <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                      {[
                        { label: "Miejscowość", value: status?.config.home_city || "—", ok: Boolean(status?.config.home_city) },
                        { label: "Słowo wybudzające", value: status?.config.wake_word || "—", ok: Boolean(status?.config.wake_word) },
                        { label: "Domownicy", value: `${status?.family.length || 0}`, ok: (status?.family.length || 0) > 0 },
                        { label: "Lekcje w planie", value: `${lessons.length}`, ok: true },
                        { label: "Terminy odpadów", value: `${garbage.length}`, ok: true },
                        { label: "Dokumenty", value: `${documents.length}`, ok: true },
                      ].map((row) => (
                        <div key={row.label} className="flex items-center justify-between rounded-lg bg-slate-950/30 px-3 py-2 text-[10px]">
                          <span className="text-slate-500">{row.label}</span>
                          <span className={`flex items-center gap-1.5 font-medium ${row.ok ? "text-emerald-200" : "text-amber-200"}`}>
                            {row.ok ? <Check size={12} /> : null}{row.value}
                          </span>
                        </div>
                      ))}
                    </div>
                    {!canFinish && (
                      <p className="mt-3 text-[9px] text-amber-200/80">Uzupełnij miejscowość, domowników i PIN, aby zakończyć konfigurację.</p>
                    )}
                  </div>
                </div>
              </StepShell>
            )}
          </AnimatePresence>
        </section>
      </div>
    </main>
  );
}
