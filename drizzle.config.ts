import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

dotenv.config({ path: [".env.local", ".env"] });

function normalize(raw?: string | null) {
  const value = (raw || "").trim().replace(/^"|"$/g, "");
  if (value.startsWith("libsql://") || /^https?:\/\/.+\.turso\.io/i.test(value)) return value;
  if (value.startsWith("file:")) return value;
  if (/^\.?\/?[\w./-]+\.db$/i.test(value)) return `file:${value}`;
  return "";
}

const tursoUrl = normalize(process.env.TURSO_DATABASE_URL) || normalize(process.env.DATABASE_URL);
const isTurso = tursoUrl.startsWith("libsql://") || tursoUrl.includes(".turso.io");
const url = isTurso ? tursoUrl : normalize(process.env.DATABASE_URL) || "file:./data/homedash.db";
const authToken = (process.env.TURSO_AUTH_TOKEN || "").trim().replace(/^"|"$/g, "");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: isTurso ? "turso" : "sqlite",
  verbose: true,
  strict: true,
  dbCredentials: {
    url,
    ...(isTurso && authToken ? { authToken } : {}),
  },
});
