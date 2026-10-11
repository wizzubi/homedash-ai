import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * HomeDash uses libSQL (SQLite) everywhere:
 *  - production: Turso cloud database (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN)
 *  - development: single local file  data/homedash.db
 *
 * Turso wins whenever its URL is configured, so switching environments is only
 * a matter of filling one variable.
 */
export type DatabaseTarget = "turso" | "local-file";

function normalizeUrl(raw?: string | null) {
  const value = (raw || "").trim().replace(/^"|"$/g, "");
  if (!value) return "";
  if (value.startsWith("libsql://")) return value;
  if (/^https?:\/\/.+\.turso\.io/i.test(value)) return value;
  if (value.startsWith("file:")) return value;
  if (/^\.?\/?[\w./-]+\.db$/i.test(value)) return `file:${value}`;
  return "";
}

function resolveTarget(): { url: string; target: DatabaseTarget; authToken?: string } {
  const tursoUrl = normalizeUrl(process.env.TURSO_DATABASE_URL) || normalizeUrl(process.env.DATABASE_URL);
  if (tursoUrl.startsWith("libsql://") || tursoUrl.includes(".turso.io")) {
    return {
      url: tursoUrl,
      target: "turso",
      authToken: (process.env.TURSO_AUTH_TOKEN || "").trim().replace(/^"|"$/g, "") || undefined,
    };
  }
  return { url: normalizeUrl(process.env.DATABASE_URL) || "file:./data/homedash.db", target: "local-file" };
}

const resolved = resolveTarget();

export const databaseTarget: DatabaseTarget = resolved.target;
export const databaseUrl = resolved.url;

// Local file mode: make sure the folder exists before libSQL opens the database.
if (resolved.target === "local-file" && resolved.url.startsWith("file:")) {
  try {
    const filePath = resolved.url.replace(/^file:/, "");
    const dir = path.dirname(path.resolve(process.cwd(), filePath));
    mkdirSync(dir, { recursive: true });
  } catch {
    // Read-only filesystems fall back to Turso or an in-memory error at query time.
  }
}

const globalForDb = globalThis as typeof globalThis & {
  __homeDashLibsqlClient?: Client;
  __homeDashDb?: LibSQLDatabase;
};

const client: Client =
  globalForDb.__homeDashLibsqlClient ??
  createClient({ url: resolved.url, authToken: resolved.authToken });

export const db: LibSQLDatabase =
  globalForDb.__homeDashDb ?? drizzle(client);

if (process.env.NODE_ENV !== "production") {
  globalForDb.__homeDashLibsqlClient = client;
  globalForDb.__homeDashDb = db;
}

export { client };
