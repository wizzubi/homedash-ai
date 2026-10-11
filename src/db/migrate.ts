import { client } from "@/db";

/**
 * Idempotent DDL for the HomeDash schema.
 *
 * The very first request against a fresh database (a brand new Turso instance or
 * an empty local file) creates every table automatically, so deploying the app is
 * enough — no separate migration step required. `drizzle-kit push` still works
 * for schema diffing during development.
 */
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

let schemaPromise: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      for (const statement of DDL) await client.execute(statement);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}
