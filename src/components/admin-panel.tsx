"use client";

import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Home,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MapPin,
  Pencil,
  Plus,
  Recycle,
  Save,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

type TaskItem = { id: string; title: string; assignedTo: string | null; isCompleted: boolean; dueDate: string | null };
type WorkLog = { id: string; date: string; hours: number; startTime: string | null; endTime: string | null; note: string | null };
type GarbageItem = { id: string; fraction: string; pickupDate: string };
type DocumentItem = { id: string; title: string; category: string; expirationDate: string };
type Lesson = { id: string; childName: string; dayOfWeek: number; startTime: string; endTime: string; subject: string; classroom: string | null };
type FamilyMember = { name: string; role: "parent" | "child" };
type AdminData = {
  tasks: TaskItem[];
  workLogs: WorkLog[];
  garbage: GarbageItem[];
  documents: DocumentItem[];
  timetable: Lesson[];
  notes: unknown[];
  config: Record<string, string>;
  family?: FamilyMember[];
  databaseTarget?: "turso" | "local-file";
};
type TabId = "overview" | "lessons" | "waste" | "documents" | "work" | "settings";
type LessonForm = { id: string; childName: string; dayOfWeek: string; startTime: string; endTime: string; subject: string; classroom: string };
type WasteForm = { id: string; fraction: string; pickupDate: string };
type DocumentForm = { id: string; title: string; category: string; expirationDate: string };
type WorkForm = { id: string; date: string; hours: string; startTime: string; endTime: string; note: string };

const DAYS = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek"];
const FRACTIONS = [
  { key: "MIXED", label: "Zmieszane" },
  { key: "GLASS", label: "Szkło" },
  { key: "PLASTIC_METAL", label: "Plastik i metal" },
  { key: "BIO", label: "Bio" },
];
const TABS: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Przegląd", icon: Home },
  { id: "lessons", label: "Plan lekcji", icon: CalendarDays },
  { id: "waste", label: "Odpady i ICS", icon: Recycle },
  { id: "documents", label: "Dokumenty", icon: FileText },
  { id: "work", label: "Godziny pracy", icon: Clock3 },
  { id: "settings", label: "Ustawienia domu", icon: Settings },
];

function localDateValue(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function noonIso(value: string) {
  return value ? new Date(`${value}T12:00:00`).toISOString() : "";
}

function dateText(value: string) {
  return new Date(value).toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" });
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block min-w-0 text-[10px] font-medium text-slate-400 ${className}`}>{label}<span className="mt-1.5 block">{children}</span></label>;
}

function AdminInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`hd-input h-10 px-3 text-[12px] ${props.className || ""}`} />;
}

function AdminSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`hd-input h-10 px-3 text-[12px] ${props.className || ""}`} />;
}

function AdminButton({ children, onClick, type = "button", disabled, variant = "primary" }: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  variant?: "primary" | "subtle" | "danger";
}) {
  const style = variant === "primary"
    ? "border-emerald-200/20 bg-emerald-200/[.1] text-emerald-100 hover:bg-emerald-200/[.16]"
    : variant === "danger"
      ? "border-rose-300/15 bg-rose-300/[.05] text-rose-200 hover:bg-rose-300/10"
      : "border-slate-700 bg-white/[.02] text-slate-300 hover:bg-white/[.06]";
  return <button type={type} onClick={onClick} disabled={disabled} className={`hd-button inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${style}`}>{children}</button>;
}

export default function AdminPanel() {
  const [pin, setPin] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [data, setData] = useState<AdminData | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [configForm, setConfigForm] = useState({ home_city: "", city_lat: "", city_lon: "", wake_word: "Hej Dash", tts_voice: "pl-PL-ZofiaNeural" });
  const [memberDraft, setMemberDraft] = useState({ name: "", role: "parent" as "parent" | "child" });
  const [newPin, setNewPin] = useState("");
  const [lessonFilter, setLessonFilter] = useState({ child: "Lena", day: "1" });
  const [lessonForm, setLessonForm] = useState<LessonForm>({ id: "", childName: "Lena", dayOfWeek: "1", startTime: "08:00", endTime: "08:45", subject: "", classroom: "" });
  const [timetableImport, setTimetableImport] = useState({ childName: "", replace: true });
  const [wasteForm, setWasteForm] = useState<WasteForm>({ id: "", fraction: "BIO", pickupDate: "" });
  const [documentForm, setDocumentForm] = useState<DocumentForm>({ id: "", title: "", category: "DOKUMENT", expirationDate: "" });
  const [workForm, setWorkForm] = useState<WorkForm>({ id: "", date: localDateValue(new Date()), hours: "8", startTime: "", endTime: "", note: "" });
  const [pinError, setPinError] = useState("");

  async function adminRequest<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, action, ...payload }),
    });
    const result = await response.json().catch(() => ({})) as { error?: string } & T;
    if (!response.ok) throw new Error(result.error || "Nie udało się wykonać operacji.");
    return result;
  }

  function applyData(next: AdminData) {
    setData(next);
    const config = next.config || {};
    setConfigForm({
      home_city: config.home_city || "",
      city_lat: config.city_lat || "",
      city_lon: config.city_lon || "",
      wake_word: config.wake_word || "Hej Dash",
      tts_voice: config.tts_voice || "pl-PL-ZofiaNeural",
    });
    const child = next.timetable[0]?.childName || (next.family || []).find((member) => member.role === "child")?.name || "";
    setLessonFilter((previous) => ({ ...previous, child: previous.child || child }));
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("login");
    setPinError("");
    try {
      const result = await adminRequest<AdminData>("load");
      applyData(result);
      setUnlocked(true);
    } catch (reason) {
      setPinError(reason instanceof Error ? reason.message : "Nieprawidłowy PIN.");
    } finally { setBusy(""); }
  }

  async function reload() {
    const result = await adminRequest<AdminData>("load");
    applyData(result);
  }

  async function perform(action: string, payload: Record<string, unknown>, success: string) {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      await adminRequest(action, payload);
      await reload();
      setNotice(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się zapisać zmian.");
    } finally { setBusy(""); }
  }

  async function deleteItem(action: string, id: string, label: string) {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      await adminRequest(action, { id });
      await reload();
      setNotice(`${label} usunięto.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się usunąć elementu.");
    } finally { setBusy(""); }
  }

  async function saveLesson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform("lesson-save", { ...lessonForm, dayOfWeek: Number(lessonForm.dayOfWeek) }, lessonForm.id ? "Zmieniono lekcję." : "Dodano lekcję do planu.");
    setLessonForm((previous) => ({ ...previous, id: "", subject: "", classroom: "" }));
  }

  async function importTimetable(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 500_000) { setError("Plik JSON może mieć maksymalnie 500 KB."); event.target.value = ""; return; }
    const childName = timetableImport.childName.trim() || lessonFilter.child || "";
    if (!childName) { setError("Podaj imię dziecka, do którego przypisać plan."); event.target.value = ""; return; }
    setBusy("timetable-import");
    setError("");
    setNotice("");
    try {
      const content = await file.text();
      const result = await adminRequest<{
        imported: number; removed: number; replaced: boolean; childName: string;
        meta?: { oddzial: string; szkola: string; obowiazuje_od: string };
        warnings?: string[];
      }>("timetable-import", { content, childName, replace: timetableImport.replace });
      await reload();
      const scope = result.meta?.oddzial || result.meta?.szkola
        ? ` (${[result.meta.oddzial, result.meta.szkola].filter(Boolean).join(" · ")})`
        : "";
      const extra = result.replaced ? ` · zastąpiono ${result.removed} lekcji` : "";
      const warnings = result.warnings?.length ? ` · uwagi: ${result.warnings.slice(0, 2).join("; ")}` : "";
      setNotice(`Plan dla „${result.childName}”${scope}: dodano ${result.imported} lekcji${extra}${warnings}.`);
      setLessonFilter((previous) => ({ ...previous, child: result.childName }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się odczytać planu JSON.");
    } finally { setBusy(""); event.target.value = ""; }
  }

  async function saveWaste(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform("waste-save", { ...wasteForm, pickupDate: noonIso(wasteForm.pickupDate) }, wasteForm.id ? "Zmieniono termin odbioru." : "Termin odbioru dodany.");
    setWasteForm({ id: "", fraction: "BIO", pickupDate: "" });
  }

  async function saveDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform("document-save", { ...documentForm, expirationDate: noonIso(documentForm.expirationDate) }, documentForm.id ? "Zaktualizowano ważność dokumentu." : "Dodano przypomnienie o dokumencie.");
    setDocumentForm({ id: "", title: "", category: "DOKUMENT", expirationDate: "" });
  }

  async function saveWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform("worklog-save", { ...workForm, date: noonIso(workForm.date), hours: Number(workForm.hours) }, workForm.id ? "Zaktualizowano wpis pracy." : "Wpis pracy zapisany.");
    setWorkForm({ id: "", date: localDateValue(new Date()), hours: "8", startTime: "", endTime: "", note: "" });
  }

  async function importIcs(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) { setError("Plik ICS może mieć maksymalnie 1 MB."); event.target.value = ""; return; }
    setBusy("ics-import");
    setError("");
    setNotice("");
    try {
      const content = await file.text();
      const result = await adminRequest<{ imported: number; detected: number; unmatched?: string[] }>("ics-import", { content });
      await reload();
      const skipped = result.unmatched?.length
        ? ` · pominięto ${result.unmatched.length} bez koszyka (${[...new Set(result.unmatched.map((item) => item.replace(/^Odbiór odpadów:\s*/, "")))].slice(0, 3).join(" · ")})`
        : "";
      setNotice(`Import zakończony: ${result.imported} nowych terminów${result.detected ? ` · rozpoznano ${result.detected} wydarzeń` : ""}${skipped}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się odczytać pliku ICS.");
    } finally { setBusy(""); event.target.value = ""; }
  }

  const childNames = useMemo(() => {
    const fromLessons = [...new Set(data?.timetable.map((lesson) => lesson.childName) ?? [])];
    const fromFamily = (data?.family || []).filter((member) => member.role === "child").map((member) => member.name);
    return [...new Set([...fromFamily, ...fromLessons])];
  }, [data]);

  const filteredLessons = (data?.timetable || [])
    .filter((lesson) => lesson.childName === lessonFilter.child && String(lesson.dayOfWeek) === lessonFilter.day)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const today = new Date();
  const thisWeekLogs = (data?.workLogs || []).filter((log) => {
    const date = new Date(log.date);
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    return date >= monday && date <= today;
  });
  const weekHours = thisWeekLogs.reduce((sum, log) => sum + log.hours, 0);
  const openTaskCount = (data?.tasks || []).filter((task) => !task.isCompleted).length;
  const expiringSoon = (data?.documents || []).filter((document) => (new Date(document.expirationDate).getTime() - today.getTime()) / 86_400_000 <= 30).length;

  if (!unlocked) {
    return (
      <main className="admin-page grid min-h-screen place-items-center px-4 py-10">
        <div className="hd-card w-full max-w-[420px] p-6 sm:p-8">
          <Link href="/" className="mb-8 inline-flex items-center gap-2 text-[10px] text-slate-500 transition hover:text-emerald-100"><ArrowLeft size={14} /> Wróć do dashboardu</Link>
          <div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl border border-emerald-200/15 bg-emerald-200/[.08] text-emerald-100"><LockKeyhole size={21} /></div>
          <p className="hd-overline">HOMEDASH AI · STREFA RODZICA</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-.04em] text-slate-100">Panel administratora</h1>
          <p className="mt-2 text-[12px] leading-relaxed text-slate-500">Wpisz rodzinny PIN, aby edytować plan domu, dokumenty i ustawienia.</p>
          <form onSubmit={(event) => void unlock(event)} className="mt-6 space-y-3">
            <label className="block text-[10px] font-medium text-slate-400">PIN administratora<input autoFocus type="password" inputMode="numeric" autoComplete="current-password" minLength={4} maxLength={8} required value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} placeholder="••••" className="hd-input mt-1.5 h-12 px-4 text-lg tracking-[.35em]" /></label>
            {pinError && <p role="alert" className="text-[10px] text-rose-200">{pinError}</p>}
            <button type="submit" disabled={busy === "login" || pin.length < 4} className="hd-button flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-200/20 bg-emerald-200/[.1] text-[11px] font-semibold text-emerald-100 hover:bg-emerald-200/[.16] disabled:opacity-50">{busy === "login" ? <LoaderCircle size={14} className="animate-spin" /> : <ShieldCheck size={15} />} Odblokuj panel</button>
          </form>
          <div className="mt-5 rounded-xl border border-slate-700/60 bg-white/[.025] px-3 py-2.5 text-[9px] leading-relaxed text-slate-600">Nowa instalacja: PIN startowy <b className="font-semibold text-slate-400">2468</b>. Dla wdrożenia ustaw zmienną środowiskową <code className="text-slate-400">ADMIN_PIN</code>.</div>
        </div>
      </main>
    );
  }

  return (
    <main className="admin-page min-h-screen text-slate-100">
      <header className="sticky top-0 z-20 border-b border-white/[.055] bg-[#090d16]/90 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-700/70 bg-white/[.025] text-slate-400 hover:text-emerald-100" title="Powrót do dashboardu"><ArrowLeft size={16} /></Link>
            <div className="min-w-0"><p className="truncate text-sm font-semibold tracking-tight">HomeDash <span className="text-emerald-200">/ Admin</span></p><p className="hidden text-[9px] text-slate-600 sm:block">Centrum konfiguracji domu i rodziny</p></div>
          </div>
          <div className="flex items-center gap-2"><span className="hidden items-center gap-1.5 rounded-full border border-emerald-200/10 bg-emerald-200/[.04] px-2.5 py-1.5 text-[9px] text-emerald-100/80 sm:flex"><ShieldCheck size={11} /> PIN zweryfikowany</span><button onClick={() => { setUnlocked(false); setPin(""); setData(null); }} className="hd-button flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[9px] text-slate-500 hover:bg-white/5 hover:text-slate-200"><LogOut size={13} /> Wyloguj</button></div>
        </div>
      </header>

      <div className="admin-layout mx-auto grid max-w-[1500px] gap-4 p-4 sm:p-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="h-fit rounded-2xl border border-slate-800/80 bg-slate-900/40 p-2 lg:sticky lg:top-[76px]">
          <div className="hidden px-3 pb-2 pt-2 lg:block"><p className="hd-overline">KONFIGURACJA</p></div>
          <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {TABS.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setActiveTab(id)} className={`hd-button flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[10px] font-medium lg:w-full ${activeTab === id ? "border border-emerald-200/10 bg-emerald-200/[.08] text-emerald-100" : "border border-transparent text-slate-500 hover:bg-white/[.035] hover:text-slate-200"}`}><Icon size={15} />{label}{activeTab === id && <span className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-emerald-200 lg:block" />}</button>)}
          </nav>
          <div className="mt-4 hidden rounded-xl border border-slate-800/80 bg-slate-950/40 p-3 lg:block"><div className="flex items-center gap-2 text-[9px] font-semibold text-slate-400"><Sparkles size={13} className="text-emerald-200" /> Dom jest pod kontrolą</div><p className="mt-1.5 text-[8px] leading-relaxed text-slate-600">Wszystkie zmiany zapisują się na bieżąco w domowej bazie danych.</p></div>
        </aside>

        <section className="min-w-0 pb-8">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div><p className="hd-overline">PANEL DOMOWY · {data?.config.home_city || "RODZINA"}</p><h1 className="mt-1 text-[clamp(1.45rem,3vw,2rem)] font-semibold tracking-[-.045em] text-slate-100">{TABS.find((tab) => tab.id === activeTab)?.label}</h1></div>
            <span className="text-[9px] text-slate-600">Zmiany są zapisywane od razu</span>
          </div>

          {error && <div role="alert" className="mb-3 rounded-xl border border-rose-300/15 bg-rose-300/[.06] px-3 py-2.5 text-[10px] text-rose-100">{error}</div>}
          {notice && <div role="status" className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200/15 bg-emerald-200/[.055] px-3 py-2.5 text-[10px] text-emerald-100"><CheckCircle2 size={14} />{notice}</div>}

          {activeTab === "overview" && <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {[
                { label: "Zadania otwarte", value: openTaskCount, suffix: "do zrobienia", icon: CheckCircle2, color: "text-amber-200" },
                { label: "Godziny · ten tydzień", value: weekHours.toLocaleString("pl-PL"), suffix: "h zapisanych", icon: Activity, color: "text-emerald-200" },
                { label: "Terminy odpadów", value: data?.garbage.length || 0, suffix: "w kalendarzu", icon: Recycle, color: "text-sky-200" },
                { label: "Dokumenty do sprawdzenia", value: expiringSoon, suffix: "w ciągu 30 dni", icon: FileText, color: "text-rose-200" },
              ].map(({ label, value, suffix, icon: Icon, color }) => <div key={label} className="hd-card p-4"><div className="flex items-center justify-between"><p className="text-[9px] font-medium text-slate-500">{label}</p><Icon size={15} className={color} /></div><p className="mt-3 text-3xl font-light tracking-[-.06em] text-slate-100">{value}</p><p className="mt-1 text-[9px] text-slate-600">{suffix}</p></div>)}
            </div>
            <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
              <div className="hd-card p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-200">Szybki dostęp</h2><span className="hd-overline">DOM · RODZINA</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{TABS.slice(1).map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setActiveTab(id)} className="hd-button flex min-h-[74px] flex-col items-start justify-between rounded-xl border border-slate-800/80 bg-white/[.02] p-3 text-left hover:border-emerald-200/15 hover:bg-emerald-200/[.035]"><Icon size={16} className="text-emerald-100/80" /><span className="flex w-full items-center justify-between text-[10px] text-slate-300">{label}<span className="text-slate-600">→</span></span></button>)}</div></div>
              <div className="hd-card p-4 sm:p-5"><div className="mb-3 flex items-center gap-2"><Users size={16} className="text-violet-200" /><h2 className="text-sm font-semibold text-slate-200">Domownicy i plan</h2></div><p className="text-[11px] leading-relaxed text-slate-500">{childNames.join(" · ") || "Dodaj dzieci w ustawieniach"} <span className="text-slate-700">·</span> {data?.timetable.length || 0} wpisów w planie lekcji.</p><div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-800/70 bg-slate-950/25 p-3 text-[9px] text-slate-500"><ShieldCheck size={14} className="shrink-0 text-emerald-200/80" /> Dostęp do ustawień zabezpieczony PIN-em administratora.</div></div>
            </div>
            <div className="hd-card p-4 sm:p-5"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-200">Nadchodzące terminy</h2><button onClick={() => setActiveTab("waste")} className="text-[9px] text-slate-500 hover:text-emerald-100">Kalendarz odpadów →</button></div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{[...(data?.garbage || [])].sort((a, b) => new Date(a.pickupDate).getTime() - new Date(b.pickupDate).getTime()).slice(0, 3).map((item) => <div key={item.id} className="flex items-center justify-between rounded-xl border border-slate-800/70 bg-white/[.02] px-3 py-2.5"><span className="flex items-center gap-2 text-[10px] text-slate-300"><Recycle size={13} className="text-emerald-200" />{FRACTIONS.find((fraction) => fraction.key === item.fraction)?.label || item.fraction}</span><span className="text-[9px] text-slate-500">{dateText(item.pickupDate)}</span></div>)}</div></div>
          </div>}

          {activeTab === "lessons" && <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,.78fr)]">
            <div className="hd-card p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-200">Plan tygodnia</h2><p className="mt-1 text-[9px] text-slate-600">Wybierz domownika i dzień, aby zobaczyć zajęcia.</p></div><div className="flex gap-2"><select value={lessonFilter.child} onChange={(event) => setLessonFilter((previous) => ({ ...previous, child: event.target.value }))} className="hd-input h-9 max-w-[130px] px-2 text-[10px]">{childNames.map((child) => <option key={child} value={child}>{child}</option>)}</select><select value={lessonFilter.day} onChange={(event) => setLessonFilter((previous) => ({ ...previous, day: event.target.value }))} className="hd-input h-9 max-w-[150px] px-2 text-[10px]">{DAYS.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></div></div>
              <div className="space-y-1.5">{filteredLessons.length ? filteredLessons.map((lesson) => <div key={lesson.id} className="flex items-center gap-3 rounded-xl border border-slate-800/70 bg-white/[.02] px-3 py-2.5"><span className="min-w-[88px] font-mono text-[10px] text-slate-400">{lesson.startTime} – {lesson.endTime}</span><span className="h-6 w-px bg-slate-700" /><span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-200">{lesson.subject}<span className="ml-2 text-[9px] font-normal text-slate-600">{lesson.classroom ? `sala ${lesson.classroom}` : ""}</span></span><button onClick={() => setLessonForm({ id: lesson.id, childName: lesson.childName, dayOfWeek: String(lesson.dayOfWeek), startTime: lesson.startTime, endTime: lesson.endTime, subject: lesson.subject, classroom: lesson.classroom || "" })} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-emerald-100" title="Edytuj"><Pencil size={13} /></button><button onClick={() => void deleteItem("lesson-delete", lesson.id, "Lekcję")} className="rounded-lg p-1.5 text-slate-600 hover:bg-rose-300/10 hover:text-rose-200" title="Usuń"><Trash2 size={13} /></button></div>) : <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-[10px] text-slate-600">Brak lekcji dla wybranego dnia.</div>}</div>
            </div>
            <form onSubmit={(event) => void saveLesson(event)} className="hd-card space-y-3 p-4 sm:p-5">
              <div className="mb-1 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-slate-200">{lessonForm.id ? "Edytuj lekcję" : "Dodaj lekcję"}</h2><p className="mt-1 text-[9px] text-slate-600">Plan powtarza się co tydzień.</p></div>{lessonForm.id && <button type="button" onClick={() => setLessonForm({ id: "", childName: childNames[0] || "Lena", dayOfWeek: lessonFilter.day, startTime: "08:00", endTime: "08:45", subject: "", classroom: "" })} className="text-[9px] text-slate-500 hover:text-white">Wyczyść</button>}</div>
              <div className="grid grid-cols-2 gap-2.5"><Field label="Dziecko"><AdminSelect value={lessonForm.childName} onChange={(event) => setLessonForm({ ...lessonForm, childName: event.target.value })}>{childNames.map((child) => <option key={child}>{child}</option>)}</AdminSelect></Field><Field label="Dzień tygodnia"><AdminSelect value={lessonForm.dayOfWeek} onChange={(event) => setLessonForm({ ...lessonForm, dayOfWeek: event.target.value })}>{DAYS.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</AdminSelect></Field></div>
              <Field label="Przedmiot"><AdminInput value={lessonForm.subject} required maxLength={80} onChange={(event) => setLessonForm({ ...lessonForm, subject: event.target.value })} placeholder="np. Matematyka" /></Field>
              <div className="grid grid-cols-2 gap-2.5"><Field label="Początek"><AdminInput type="time" value={lessonForm.startTime} required onChange={(event) => setLessonForm({ ...lessonForm, startTime: event.target.value })} /></Field><Field label="Koniec"><AdminInput type="time" value={lessonForm.endTime} required onChange={(event) => setLessonForm({ ...lessonForm, endTime: event.target.value })} /></Field></div>
              <Field label="Sala / klasa (opcjonalnie)"><AdminInput value={lessonForm.classroom} maxLength={30} onChange={(event) => setLessonForm({ ...lessonForm, classroom: event.target.value })} placeholder="np. 12" /></Field>
              <AdminButton type="submit" disabled={!!busy}><Save size={13} />{busy === "lesson-save" ? "Zapisuję…" : lessonForm.id ? "Zapisz zmiany" : "Dodaj do planu"}</AdminButton>
            </form>
            <div className="hd-card flex flex-wrap items-center gap-4 p-4 sm:p-5 xl:col-span-2"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-violet-200/10 bg-violet-200/[.06] text-violet-100"><CalendarDays size={17} /></span><div className="min-w-[220px] flex-1"><h2 className="text-[12px] font-semibold text-slate-200">Import planu z JSON</h2><p className="mt-1 text-[9px] leading-relaxed text-slate-600">Wczytaj plan oddziału (pola poniedzialek…piatek, godziny GG:MM-GG:MM, grupy jako listy). Null to okienko.</p><div className="mt-2.5 flex flex-wrap items-center gap-2">{childNames.length > 0 ? <AdminSelect value={timetableImport.childName || lessonFilter.child} onChange={(event) => setTimetableImport({ ...timetableImport, childName: event.target.value })} title="Dziecko z bazy danych" className="h-9 max-w-[170px]">{[...new Set([timetableImport.childName || lessonFilter.child, ...childNames].filter(Boolean))].map((name) => <option key={name} value={name}>{name}</option>)}</AdminSelect> : <AdminInput value={timetableImport.childName} onChange={(event) => setTimetableImport({ ...timetableImport, childName: event.target.value })} placeholder="Dziecko (brak w bazie — wpisz imię)" maxLength={48} className="h-9 max-w-[170px]" />}<label className="flex cursor-pointer items-center gap-1.5 text-[9px] text-slate-500"><input type="checkbox" checked={timetableImport.replace} onChange={(event) => setTimetableImport({ ...timetableImport, replace: event.target.checked })} className="h-3.5 w-3.5 accent-emerald-300" /> Zastąp obecny plan dziecka</label></div></div><label className="hd-button inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border border-violet-200/15 bg-violet-200/[.06] px-3 text-[10px] font-semibold text-violet-100 hover:bg-violet-200/10">{busy === "timetable-import" ? <LoaderCircle size={13} className="animate-spin" /> : <Upload size={13} />}{busy === "timetable-import" ? "Importuję…" : "Wybierz plik JSON"}<input type="file" accept=".json,application/json" disabled={!!busy} onChange={(event) => void importTimetable(event)} className="sr-only" /></label></div>
          </div>}

          {activeTab === "waste" && <div className="space-y-4">
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(310px,.72fr)]">
              <div className="hd-card p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-slate-200">Harmonogram odbioru</h2><p className="mt-1 text-[9px] text-slate-600">Najbliższe wywozy i terminy dodane do kalendarza.</p></div><span className="rounded-full border border-emerald-200/10 bg-emerald-200/[.04] px-2.5 py-1 text-[9px] text-emerald-100">{data?.garbage.length || 0} terminów</span></div><div className="space-y-1.5">{[...(data?.garbage || [])].sort((a, b) => new Date(a.pickupDate).getTime() - new Date(b.pickupDate).getTime()).map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl border border-slate-800/70 bg-white/[.02] px-3 py-2.5"><span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-200/[.07] text-emerald-100"><Recycle size={15} /></span><span className="min-w-0 flex-1"><span className="block text-[10px] font-medium text-slate-200">{FRACTIONS.find((fraction) => fraction.key === item.fraction)?.label || item.fraction}</span><span className="mt-0.5 block text-[9px] text-slate-600">{dateText(item.pickupDate)}</span></span><button onClick={() => setWasteForm({ id: item.id, fraction: item.fraction, pickupDate: localDateValue(item.pickupDate) })} className="rounded-lg p-1.5 text-slate-500 hover:text-emerald-100" title="Edytuj"><Pencil size={13} /></button><button onClick={() => void deleteItem("waste-delete", item.id, "Termin")} className="rounded-lg p-1.5 text-slate-600 hover:text-rose-200" title="Usuń"><Trash2 size={13} /></button></div>)}{!data?.garbage.length && <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-[10px] text-slate-600">Nie ma jeszcze terminów.</div>}</div></div>
              <form onSubmit={(event) => void saveWaste(event)} className="hd-card space-y-3 p-4 sm:p-5"><div><h2 className="text-sm font-semibold text-slate-200">{wasteForm.id ? "Edytuj termin" : "Dodaj termin"}</h2><p className="mt-1 text-[9px] text-slate-600">Datę możesz wpisać ręcznie albo zaimportować niżej.</p></div><Field label="Frakcja"><AdminSelect value={wasteForm.fraction} onChange={(event) => setWasteForm({ ...wasteForm, fraction: event.target.value })}>{FRACTIONS.map((fraction) => <option key={fraction.key} value={fraction.key}>{fraction.label}</option>)}</AdminSelect></Field><Field label="Data odbioru"><AdminInput type="date" value={wasteForm.pickupDate} required onChange={(event) => setWasteForm({ ...wasteForm, pickupDate: event.target.value })} /></Field><AdminButton type="submit" disabled={!!busy}><Save size={13} />{busy === "waste-save" ? "Zapisuję…" : wasteForm.id ? "Zapisz termin" : "Dodaj termin"}</AdminButton>{wasteForm.id && <button type="button" onClick={() => setWasteForm({ id: "", fraction: "BIO", pickupDate: "" })} className="ml-2 text-[9px] text-slate-500 hover:text-slate-300">Anuluj edycję</button>}</form>
            </div>
            <div className="hd-card flex flex-wrap items-center gap-4 p-4 sm:p-5"><span className="grid h-10 w-10 place-items-center rounded-xl border border-sky-200/10 bg-sky-200/[.06] text-sky-100"><Upload size={17} /></span><div className="min-w-0 flex-1"><h2 className="text-[12px] font-semibold text-slate-200">Import kalendarza .ics</h2><p className="mt-1 text-[9px] leading-relaxed text-slate-600">Wczytaj plik z gminy lub wspólnoty. Rozpoznajemy Bio, szkło, plastik/metal i odpady zmieszane, również wydarzenia cykliczne.</p></div><label className="hd-button inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border border-sky-200/15 bg-sky-200/[.06] px-3 text-[10px] font-semibold text-sky-100 hover:bg-sky-200/10">{busy === "ics-import" ? <LoaderCircle size={13} className="animate-spin" /> : <Upload size={13} />}{busy === "ics-import" ? "Importuję…" : "Wybierz plik ICS"}<input type="file" accept=".ics,text/calendar" disabled={!!busy} onChange={(event) => void importIcs(event)} className="sr-only" /></label></div>
          </div>}

          {activeTab === "documents" && <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,.72fr)]">
            <div className="hd-card p-4 sm:p-5"><div className="mb-4"><h2 className="text-sm font-semibold text-slate-200">Monitor ważności</h2><p className="mt-1 text-[9px] text-slate-600">Dashboard ostrzega na 30 dni przed końcem ważności.</p></div><div className="space-y-1.5">{[...(data?.documents || [])].sort((a, b) => new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime()).map((document) => { const days = Math.ceil((new Date(document.expirationDate).getTime() - Date.now()) / 86_400_000); return <div key={document.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${days <= 30 ? "border-rose-300/10 bg-rose-300/[.035]" : "border-slate-800/70 bg-white/[.02]"}`}><span className={`grid h-8 w-8 place-items-center rounded-xl ${days <= 30 ? "bg-rose-300/10 text-rose-200" : "bg-white/[.04] text-slate-400"}`}><FileText size={14} /></span><span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-medium text-slate-200">{document.title}</span><span className="mt-0.5 block text-[9px] text-slate-600">{document.category} · {dateText(document.expirationDate)}</span></span><span className={`hidden text-[9px] sm:block ${days <= 30 ? "text-rose-200" : "text-slate-500"}`}>{days < 0 ? "wygasł" : days === 0 ? "dziś" : `${days} dni`}</span><button onClick={() => setDocumentForm({ id: document.id, title: document.title, category: document.category, expirationDate: localDateValue(document.expirationDate) })} className="rounded-lg p-1.5 text-slate-500 hover:text-emerald-100" title="Edytuj"><Pencil size={13} /></button><button onClick={() => void deleteItem("document-delete", document.id, "Dokument")} className="rounded-lg p-1.5 text-slate-600 hover:text-rose-200" title="Usuń"><Trash2 size={13} /></button></div>; })}{!data?.documents.length && <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-[10px] text-slate-600">Dodaj pierwszy dokument do monitorowania.</div>}</div></div>
            <form onSubmit={(event) => void saveDocument(event)} className="hd-card space-y-3 p-4 sm:p-5"><div><h2 className="text-sm font-semibold text-slate-200">{documentForm.id ? "Edytuj przypomnienie" : "Nowe przypomnienie"}</h2><p className="mt-1 text-[9px] text-slate-600">Paszport, dowód, przegląd, ubezpieczenie…</p></div><Field label="Nazwa"><AdminInput required maxLength={100} value={documentForm.title} onChange={(event) => setDocumentForm({ ...documentForm, title: event.target.value })} placeholder="np. Dowód osobisty · Mama" /></Field><Field label="Kategoria"><AdminSelect value={documentForm.category} onChange={(event) => setDocumentForm({ ...documentForm, category: event.target.value })}><option value="DOKUMENT">Dokument</option><option value="AUTO">Samochód</option><option value="UBEZPIECZENIE">Ubezpieczenie</option><option value="ZDROWIE">Zdrowie</option><option value="INNE">Inne</option></AdminSelect></Field><Field label="Data ważności"><AdminInput required type="date" value={documentForm.expirationDate} onChange={(event) => setDocumentForm({ ...documentForm, expirationDate: event.target.value })} /></Field><div className="flex items-center gap-2 rounded-lg bg-rose-300/[.04] p-2.5 text-[9px] text-slate-500"><ShieldCheck size={13} className="shrink-0 text-rose-200/70" /> Alert pojawi się 30 dni przed terminem.</div><AdminButton type="submit" disabled={!!busy}><Save size={13} />{busy === "document-save" ? "Zapisuję…" : documentForm.id ? "Zapisz zmiany" : "Dodaj dokument"}</AdminButton>{documentForm.id && <button type="button" onClick={() => setDocumentForm({ id: "", title: "", category: "DOKUMENT", expirationDate: "" })} className="ml-2 text-[9px] text-slate-500 hover:text-slate-300">Anuluj</button>}</form>
          </div>}

          {activeTab === "work" && <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(310px,.7fr)]">
            <div className="hd-card p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-slate-200">Rejestr godzin pracy</h2><p className="mt-1 text-[9px] text-slate-600">W tym tygodniu: <b className="font-semibold text-emerald-100">{weekHours.toLocaleString("pl-PL")} h</b></p></div><Activity size={17} className="text-emerald-200" /></div><div className="space-y-1.5">{[...(data?.workLogs || [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((log) => <div key={log.id} className="flex items-center gap-3 rounded-xl border border-slate-800/70 bg-white/[.02] px-3 py-2.5"><span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-200/[.06] text-emerald-100"><Clock3 size={14} /></span><span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-medium text-slate-200">{log.note || "Godziny pracy"}</span><span className="mt-0.5 block text-[9px] text-slate-600">{dateText(log.date)} {log.startTime && `· ${log.startTime}${log.endTime ? `–${log.endTime}` : ""}`}</span></span><span className="text-[12px] font-semibold text-emerald-100">{log.hours.toLocaleString("pl-PL")} h</span><button onClick={() => setWorkForm({ id: log.id, date: localDateValue(log.date), hours: String(log.hours), startTime: log.startTime || "", endTime: log.endTime || "", note: log.note || "" })} className="rounded-lg p-1.5 text-slate-500 hover:text-emerald-100" title="Edytuj"><Pencil size={13} /></button><button onClick={() => void deleteItem("worklog-delete", log.id, "Wpis")} className="rounded-lg p-1.5 text-slate-600 hover:text-rose-200" title="Usuń"><Trash2 size={13} /></button></div>)}{!data?.workLogs.length && <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-[10px] text-slate-600">Nie ma jeszcze wpisów pracy.</div>}</div></div>
            <form onSubmit={(event) => void saveWork(event)} className="hd-card space-y-3 p-4 sm:p-5"><div><h2 className="text-sm font-semibold text-slate-200">{workForm.id ? "Edytuj wpis" : "Dodaj wpis pracy"}</h2><p className="mt-1 text-[9px] text-slate-600">Możesz podać liczbę godzin lub przedział czasowy.</p></div><Field label="Data"><AdminInput type="date" required value={workForm.date} onChange={(event) => setWorkForm({ ...workForm, date: event.target.value })} /></Field><Field label="Liczba godzin"><AdminInput type="number" min="0.25" max="24" step="0.25" required value={workForm.hours} onChange={(event) => setWorkForm({ ...workForm, hours: event.target.value })} /></Field><div className="grid grid-cols-2 gap-2.5"><Field label="Od"><AdminInput type="time" value={workForm.startTime} onChange={(event) => setWorkForm({ ...workForm, startTime: event.target.value })} /></Field><Field label="Do"><AdminInput type="time" value={workForm.endTime} onChange={(event) => setWorkForm({ ...workForm, endTime: event.target.value })} /></Field></div><Field label="Notatka"><AdminInput maxLength={180} value={workForm.note} onChange={(event) => setWorkForm({ ...workForm, note: event.target.value })} placeholder="np. Projekt HomeDash" /></Field><AdminButton type="submit" disabled={!!busy}><Save size={13} />{busy === "worklog-save" ? "Zapisuję…" : workForm.id ? "Zapisz zmiany" : "Dodaj wpis"}</AdminButton>{workForm.id && <button type="button" onClick={() => setWorkForm({ id: "", date: localDateValue(new Date()), hours: "8", startTime: "", endTime: "", note: "" })} className="ml-2 text-[9px] text-slate-500 hover:text-slate-300">Anuluj edycję</button>}</form>
          </div>}

          {activeTab === "settings" && <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,.75fr)]">
            <form onSubmit={(event) => { event.preventDefault(); void perform("config-save", configForm, "Ustawienia domu zostały zapisane."); }} className="hd-card space-y-4 p-4 sm:p-5"><div><h2 className="text-sm font-semibold text-slate-200">Dom i rodzina</h2><p className="mt-1 text-[9px] text-slate-600">Lokalizacja pogody, członkowie rodziny i aktywacja głosowa.</p></div><Field label="Nazwa miejscowości"><AdminInput required maxLength={80} value={configForm.home_city} onChange={(event) => setConfigForm({ ...configForm, home_city: event.target.value })} placeholder="np. Warszawa" /></Field><div className="grid grid-cols-2 gap-3"><Field label="Szerokość geograficzna"><AdminInput required type="number" step="any" min="-90" max="90" value={configForm.city_lat} onChange={(event) => setConfigForm({ ...configForm, city_lat: event.target.value })} /></Field><Field label="Długość geograficzna"><AdminInput required type="number" step="any" min="-180" max="180" value={configForm.city_lon} onChange={(event) => setConfigForm({ ...configForm, city_lon: event.target.value })} /></Field></div><Field label="Głos lektora (Edge TTS)"><AdminSelect value={configForm.tts_voice} onChange={(event) => setConfigForm({ ...configForm, tts_voice: event.target.value })}><option value="pl-PL-ZofiaNeural">Zofia (kobiecy)</option><option value="pl-PL-MarekNeural">Marek (męski)</option></AdminSelect></Field><Field label="Twoje słowo wybudzające"><AdminInput required maxLength={48} value={configForm.wake_word} onChange={(event) => setConfigForm({ ...configForm, wake_word: event.target.value })} placeholder="Hej Dash" /></Field><div className="flex items-center gap-2 rounded-xl border border-sky-200/10 bg-sky-200/[.035] p-3 text-[9px] leading-relaxed text-slate-500"><MapPin size={14} className="shrink-0 text-sky-200" /> Pogoda pochodzi z Open‑Meteo. Zmień współrzędne, aby ustawić lokalizację domu.</div><AdminButton type="submit" disabled={!!busy}><Save size={13} />{busy === "config-save" ? "Zapisuję…" : "Zapisz ustawienia domu"}</AdminButton></form>
            <div className="space-y-4">
              <div className="hd-card space-y-3 p-4 sm:p-5">
                <div><h2 className="text-sm font-semibold text-slate-200">Domownicy</h2><p className="mt-1 text-[9px] text-slate-600">Dzieci pojawiają się w planie lekcji, rodzice na listach zadań.</p></div>
                <div className="grid grid-cols-[minmax(0,1fr)_110px_auto] gap-2">
                  <AdminInput maxLength={48} value={memberDraft.name} onChange={(event) => setMemberDraft({ ...memberDraft, name: event.target.value })} placeholder="Imię" />
                  <AdminSelect value={memberDraft.role} onChange={(event) => setMemberDraft({ ...memberDraft, role: event.target.value as "parent" | "child" })}><option value="parent">Rodzic</option><option value="child">Dziecko</option></AdminSelect>
                  <AdminButton disabled={!memberDraft.name.trim() || !!busy} onClick={() => void perform("family-save", { members: [...(data?.family || []), { name: memberDraft.name.trim(), role: memberDraft.role }] }, "Dodano domownika.").then(() => setMemberDraft({ name: "", role: "parent" }))}><Plus size={13} /> Dodaj</AdminButton>
                </div>
                <div className="space-y-1.5">{(data?.family || []).map((member, index) => <div key={`${member.name}-${index}`} className="flex items-center gap-2.5 rounded-xl border border-slate-800/70 bg-white/[.02] px-3 py-2"><Users size={13} className={member.role === "child" ? "text-violet-200" : "text-emerald-200"} /><span className="min-w-0 flex-1 truncate text-[10px] text-slate-200">{member.name}<span className="ml-2 text-[8px] text-slate-600">{member.role === "child" ? "dziecko" : "rodzic"}</span></span><button onClick={() => void perform("family-save", { members: (data?.family || []).filter((_, position) => position !== index) }, "Usunięto domownika.")} className="rounded-lg p-1.5 text-slate-600 hover:bg-rose-300/10 hover:text-rose-200" title="Usuń"><Trash2 size={12} /></button></div>)}{!(data?.family || []).length && <p className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-center text-[9px] text-slate-600">Brak domowników.</p>}</div>
              </div>
              <form onSubmit={(event) => { event.preventDefault(); void perform("pin-change", { newPin }, "Zmieniono PIN administratora.").then(() => setNewPin("")); }} className="hd-card space-y-3 p-4 sm:p-5"><div><h2 className="text-sm font-semibold text-slate-200">Bezpieczeństwo panelu</h2><p className="mt-1 text-[9px] text-slate-600">Zmień rodzinny PIN dostępu (4–8 cyfr).</p></div><Field label="Nowy PIN"><AdminInput type="password" inputMode="numeric" minLength={4} maxLength={8} pattern="[0-9]{4,8}" required value={newPin} onChange={(event) => setNewPin(event.target.value.replace(/\D/g, ""))} placeholder="••••" /></Field><AdminButton type="submit" disabled={!!busy}><ShieldCheck size={13} />{busy === "pin-change" ? "Aktualizuję…" : "Zmień PIN"}</AdminButton><p className="text-[8px] leading-relaxed text-slate-600">Jeśli ustawiono zmienną środowiskową <code className="text-slate-400">ADMIN_PIN</code>, zmień ją w konfiguracji wdrożenia.</p></form>
              <div className="hd-card p-4 sm:p-5"><div className="flex items-center gap-2"><Sparkles size={15} className="text-violet-200" /><h2 className="text-[12px] font-semibold text-slate-200">Asystent i integracje</h2></div><div className="mt-3 space-y-2 text-[9px] text-slate-500"><div className="flex items-center justify-between rounded-lg bg-white/[.025] px-3 py-2"><span>Baza danych</span><span className={data?.databaseTarget === "turso" ? "text-sky-200" : "text-emerald-200"}>{data?.databaseTarget === "turso" ? "Turso · libSQL (chmura)" : "Lokalny plik SQLite"}</span></div><div className="flex items-center justify-between rounded-lg bg-white/[.025] px-3 py-2"><span>Prognoza pogody</span><span className="text-emerald-200">Open‑Meteo · aktywna</span></div><div className="flex items-center justify-between rounded-lg bg-white/[.025] px-3 py-2"><span>Synteza mowy</span><span className="text-emerald-200">Edge TTS · {data?.config.tts_voice === "pl-PL-MarekNeural" ? "Marek" : "Zofia"}</span></div><div className="flex items-center justify-between rounded-lg bg-white/[.025] px-3 py-2"><span>Rozmowa AI</span><span className="text-slate-400">Klucz OPENROUTER_API_KEY</span></div></div><AdminButton variant="subtle" disabled={!!busy} onClick={() => void perform("setup-reopen", {}, "Kreator konfiguracji został ponownie otwarty — przejdź do /setup.")}>Ponownie otwórz kreator</AdminButton><p className="mt-3 text-[8px] leading-relaxed text-slate-600">Klucze API pozostają po stronie serwera. Dodaj OPENROUTER_API_KEY jako zmienną środowiskową wdrożenia — panel nigdy nie wyświetla sekretów.</p></div>
            </div>
          </div>}
        </section>
      </div>
    </main>
  );
}
