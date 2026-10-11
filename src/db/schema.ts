import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { randomUUID } from "crypto";

const uuid = () => randomUUID();
const now = () => new Date();

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey().$defaultFn(uuid),
  title: text("title").notNull(),
  assignedTo: text("assigned_to"),
  dueDate: integer("due_date", { mode: "timestamp" }),
  isCompleted: integer("is_completed", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
});

export const workLogs = sqliteTable("work_logs", {
  id: text("id").primaryKey().$defaultFn(uuid),
  date: integer("date", { mode: "timestamp" }).notNull().$defaultFn(now),
  hours: real("hours").notNull(),
  startTime: text("start_time"),
  endTime: text("end_time"),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
});

export const garbageSchedules = sqliteTable("garbage_schedules", {
  id: text("id").primaryKey().$defaultFn(uuid),
  fraction: text("fraction").notNull(),
  pickupDate: integer("pickup_date", { mode: "timestamp" }).notNull(),
});

export const documentReminders = sqliteTable("document_reminders", {
  id: text("id").primaryKey().$defaultFn(uuid),
  title: text("title").notNull(),
  expirationDate: integer("expiration_date", { mode: "timestamp" }).notNull(),
  category: text("category").notNull(),
});

export const timetable = sqliteTable("timetable", {
  id: text("id").primaryKey().$defaultFn(uuid),
  childName: text("child_name").notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  subject: text("subject").notNull(),
  classroom: text("classroom"),
});

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey().$defaultFn(uuid),
  title: text("title"),
  content: text("content").notNull(),
  color: text("color").notNull().default("amber"),
  isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(now),
});

export const systemConfig = sqliteTable("system_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
