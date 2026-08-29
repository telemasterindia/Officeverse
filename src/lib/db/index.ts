/**
 * Officeverse — production database connection (MySQL / MariaDB via mysql2).
 *
 * Credentials come ONLY from environment variables — never hardcoded, never
 * logged. Accepts either a single `DATABASE_URL` or discrete `DB_*` vars.
 *
 * `getDb()` is lazy: importing this module never opens a connection or throws,
 * so `vite build` / SSR route-tree generation stay unaffected when no database
 * is configured. The pool is created on first real use.
 *
 * All `datetime` columns are IST wall-clock strings (see schema.ts). The pool
 * sets `dateStrings: true` and `timezone: "+05:30"` so mysql2 performs no
 * implicit timezone conversion.
 */
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql, { type Pool } from "mysql2/promise";
import * as schema from "./schema";

export { schema };

/** The Drizzle client type. */
export type DB = MySql2Database<typeof schema>;
/** The Drizzle transaction handle passed to `db.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
/** Either the pooled client or a transaction — repo functions accept this. */
export type DBX = DB | Tx;

let _pool: Pool | null = null;
let _db: MySql2Database<typeof schema> | null = null;

function readConfig(): mysql.PoolOptions {
  const url = process.env["DATABASE_URL"];
  if (url && url.trim()) {
    return {
      uri: url.trim(),
      dateStrings: true,
      timezone: "+05:30",
      charset: "utf8mb4",
      connectionLimit: Number(process.env["DB_POOL_LIMIT"] ?? 10),
      enableKeepAlive: true,
    };
  }

  const host = process.env["DB_HOST"];
  const name = process.env["DB_NAME"];
  const user = process.env["DB_USER"];
  if (!host || !name || !user) {
    throw new Error(
      "Database not configured. Set DATABASE_URL, or DB_HOST + DB_NAME + DB_USER (+ DB_PASSWORD).",
    );
  }

  return {
    host,
    port: Number(process.env["DB_PORT"] ?? 3306),
    database: name,
    user,
    password: process.env["DB_PASSWORD"] ?? "",
    dateStrings: true,
    timezone: "+05:30",
    charset: "utf8mb4",
    connectionLimit: Number(process.env["DB_POOL_LIMIT"] ?? 10),
    enableKeepAlive: true,
  };
}

/** The shared connection pool. Created on first call. */
export function getPool(): Pool {
  if (!_pool) _pool = mysql.createPool(readConfig());
  return _pool;
}

/** The Drizzle client. Lazy — safe to import anywhere. */
export function getDb(): MySql2Database<typeof schema> {
  if (!_db) _db = drizzle(getPool(), { schema, mode: "default" });
  return _db;
}

/** Close the pool (tests / graceful shutdown). */
export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
}

/** True when DATABASE_URL or the discrete DB_* vars are present. */
export function isDbConfigured(): boolean {
  if (process.env["DATABASE_URL"]?.trim()) return true;
  return Boolean(process.env["DB_HOST"] && process.env["DB_NAME"] && process.env["DB_USER"]);
}
