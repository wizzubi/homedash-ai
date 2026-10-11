#!/usr/bin/env node
/**
 * Pushes the HomeDash schema to the configured libSQL database.
 *
 *   node scripts/push-schema.mjs
 *
 * Target resolution (same rules as src/db/index.ts):
 *   1. TURSO_DATABASE_URL  (libsql://... or https://....turso.io)
 *   2. DATABASE_URL        (libsql://... or file:...)
 *   3. fallback            file:./data/homedash.db
 *
 * The DDL is idempotent (CREATE TABLE / INDEX IF NOT EXISTS), so it is safe to
 * run on every deploy — the app itself also does this on the first request.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(name) {
  const file = resolve(root, name);
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^"|"$/g, "");
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

function normalize(raw) {
  const value = (raw || "").trim().replace(/^"|"$/g, "");
  if (!value) return "";
  if (value.startsWith("libsql://") || /^https?:\/\/.+\.turso\.io/i.test(value)) return value;
  if (value.startsWith("file:")) return value;
  if (/^\.?\/?[\w./-]+\.db$/i.test(value)) return `file:${value}`;
  return "";
}

const tursoUrl = normalize(process.env.TURSO_DATABASE_URL) || normalize(process.env.DATABASE_URL);
const isTurso = tursoUrl.startsWith("libsql://") || tursoUrl.includes(".turso.io");
const url = isTurso ? tursoUrl : normalize(process.env.DATABASE_URL) || `file:${resolve(root, "data", "homedash.db")}`;
const authToken = (process.env.TURSO_AUTH_TOKEN || "").trim().replace(/^"|"$/g, "");

if (isTurso && !authToken) {
  console.error("✖ TURSO_AUTH_TOKEN jest wymagany dla bazy zdalnej.");
  process.exit(1);
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS tasks (
    id text PRIMARY KEY NOT NULL,
    title text NOT NULL,
    assigned_to text,
    due_date integer,
    is_completed integer NOT NULL DEFAULT 0,
    created_at integer NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS work_logs (
    id text PRIMARY KEY NOT NULL,
    date integer NOT NULL,
    hours real NOT NULL,
    start_time text,
    end_time text,
    note text,
    created_at integer NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS garbage_schedules (
    id text PRIMARY KEY NOT NULL,
    fraction text NOT NULL,
    pickup_date integer NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS document_reminders (
    id text PRIMARY KEY NOT NULL,
    title text NOT NULL,
    expiration_date integer NOT NULL,
    category text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS timetable (
    id text PRIMARY KEY NOT NULL,
    child_name text NOT NULL,
    day_of_week integer NOT NULL,
    start_time text NOT NULL,
    end_time text NOT NULL,
    subject text NOT NULL,
    classroom text
  )`,
  `CREATE TABLE IF NOT EXISTS notes (
    id text PRIMARY KEY NOT NULL,
    title text,
    content text NOT NULL,
    color text NOT NULL DEFAULT 'amber',
    is_pinned integer NOT NULL DEFAULT 1,
    created_at integer NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS system_config (
    key text PRIMARY KEY NOT NULL,
    value text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS tasks_created_at_idx ON tasks (created_at)`,
  `CREATE INDEX IF NOT EXISTS work_logs_date_idx ON work_logs (date)`,
  `CREATE INDEX IF NOT EXISTS garbage_pickup_date_idx ON garbage_schedules (pickup_date)`,
  `CREATE INDEX IF NOT EXISTS document_expiration_idx ON document_reminders (expiration_date)`,
  `CREATE INDEX IF NOT EXISTS timetable_child_day_idx ON timetable (child_name, day_of_week)`,
];

console.log(`→ Cel bazy: ${isTurso ? "Turso (libSQL, chmura)" : "lokalny plik SQLite"}`);
console.log(`→ URL: ${isTurso ? url : url.replace(root, ".")}`);

const client = createClient(isTurso ? { url, authToken } : { url });

try {
  for (const statement of DDL) await client.execute(statement);
  const result = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  const tables = result.rows.map((row) => row.name).filter((name) => !name.startsWith("sqlite_"));
  const counts = await Promise.all(
    tables.map(async (table) => {
      const rows = await client.execute(`SELECT COUNT(*) AS total FROM "${table}"`);
      return `${table}: ${rows.rows[0]?.total ?? 0}`;
    }),
  );
  console.log(`✔ Schemat gotowy (${tables.length} tabel)`);
  console.log(`  ${counts.join("\n  ")}`);
  console.log("✔ Baza jest pusta — dane wprowadzisz w kreatorze /setup.");
} catch (error) {
  console.error(`✖ Push nie powiódł się: ${error.message}`);
  if (isTurso) {
    console.error("  Sprawdź TURSO_DATABASE_URL (turso db show <baza> --url) i ważność tokena.");
  }
  process.exit(1);
} finally {
  client.close();
}
