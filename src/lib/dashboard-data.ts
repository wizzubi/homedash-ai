import { db, databaseTarget } from "@/db";
import { ensureSchema } from "@/db/migrate";
import {
  documentReminders,
  garbageSchedules,
  notes,
  systemConfig,
  tasks,
  timetable,
  workLogs,
} from "@/db/schema";
import { asc, desc, eq } from "drizzle-orm";

export type FamilyMember = { name: string; role: "parent" | "child" };

export const CONFIG_KEYS = [
  "setup_completed",
  "home_city",
  "city_lat",
  "city_lon",
  "wake_word",
  "tts_voice",
  "family_members",
  "admin_pin",
] as const;

const SECRET_CONFIG_KEYS = new Set<string>(["admin_pin"]);

export async function getConfig(): Promise<Record<string, string>> {
  await ensureSchema();
  const rows = await db.select().from(systemConfig);
  return Object.fromEntries(rows.map(({ key, value }) => [key, value]));
}

export function getPublicConfig(config: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(config).filter(([key]) => !SECRET_CONFIG_KEYS.has(key)),
  );
}

export async function setConfigValues(entries: Record<string, string>) {
  await ensureSchema();
  for (const [key, value] of Object.entries(entries)) {
    await db
      .insert(systemConfig)
      .values({ key, value })
      .onConflictDoUpdate({ target: systemConfig.key, set: { value } })
      .run();
  }
}

export function parseFamilyMembers(raw?: string): FamilyMember[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is { name?: unknown; role?: unknown } => !!item && typeof item === "object")
      .map((item): FamilyMember => ({
        name: typeof item.name === "string" ? item.name.trim().slice(0, 48) : "",
        role: item.role === "child" ? "child" : "parent",
      }))
      .filter((item) => item.name.length > 0)
      .slice(0, 12);
  } catch {
    return [];
  }
}

export async function getSetupState() {
  const config = await getConfig();
  const hasPin = Boolean(config.admin_pin) || Boolean(process.env.ADMIN_PIN);
  return {
    completed: config.setup_completed === "true",
    hasPin,
    databaseTarget,
    family: parseFamilyMembers(config.family_members),
    config: getPublicConfig(config),
  };
}

export async function isSetupComplete() {
  const config = await getConfig();
  return config.setup_completed === "true";
}

export async function getAdminPin() {
  if (process.env.ADMIN_PIN) return process.env.ADMIN_PIN;
  const [row] = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, "admin_pin"))
    .limit(1);
  return row?.value ?? "";
}

/**
 * No demo content is created anywhere: the database starts completely empty and
 * is filled exclusively by the setup wizard, the admin panel and the dashboard.
 */
export async function getDashboardData() {
  await ensureSchema();
  const [taskRows, workRows, wasteRows, documentRows, lessonRows, noteRows] = await Promise.all([
    db.select().from(tasks).orderBy(asc(tasks.isCompleted), asc(tasks.dueDate), desc(tasks.createdAt)).all(),
    db.select().from(workLogs).orderBy(desc(workLogs.date)).all(),
    db.select().from(garbageSchedules).orderBy(asc(garbageSchedules.pickupDate)).all(),
    db.select().from(documentReminders).orderBy(asc(documentReminders.expirationDate)).all(),
    db.select().from(timetable).orderBy(asc(timetable.dayOfWeek), asc(timetable.startTime)).all(),
    db.select().from(notes).orderBy(desc(notes.isPinned), desc(notes.createdAt)).all(),
  ]);
  const config = await getConfig();

  return {
    tasks: taskRows,
    workLogs: workRows,
    garbage: wasteRows,
    documents: documentRows,
    timetable: lessonRows,
    notes: noteRows,
    config: getPublicConfig(config),
    family: parseFamilyMembers(config.family_members),
    setupCompleted: config.setup_completed === "true",
    databaseTarget,
  };
}
