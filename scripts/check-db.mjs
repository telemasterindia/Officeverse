/**
 * Officeverse — SAFE, read-only GoDaddy MySQL connectivity + migration-state probe.
 *
 *   node scripts/check-db.mjs
 *
 * Reads DATABASE_URL or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD from the
 * environment (load with `node --env-file=.env scripts/check-db.mjs` on Node 20+,
 * or export them first). It runs only:
 *   SELECT 1
 *   SELECT DATABASE(), CURRENT_USER()
 *   SHOW TABLES
 *   SELECT ... FROM `__drizzle_migrations`   (if the table exists)
 *
 * It NEVER writes, NEVER drops, NEVER migrates, and NEVER prints the password
 * or the connection string.
 */
import mysql from "mysql2/promise";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, "..", "drizzle");

function poolOptions() {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return { uri: url, connectionLimit: 1, dateStrings: true, timezone: "+05:30" };
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;
  if (!DB_HOST || !DB_NAME || !DB_USER) {
    console.error("NOT VERIFIED — no DB credentials in the environment.");
    console.error("Set DATABASE_URL, or DB_HOST + DB_NAME + DB_USER (+ DB_PASSWORD).");
    process.exit(2);
  }
  return {
    host: DB_HOST,
    port: Number(DB_PORT ?? 3306),
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD ?? "",
    connectionLimit: 1,
    dateStrings: true,
    timezone: "+05:30",
  };
}

function localMigrations() {
  try {
    return readdirSync(drizzleDir)
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .sort();
  } catch {
    return [];
  }
}

const local = localMigrations();
console.log(`Local migration files: ${local.length}`);
for (const f of local) console.log(`  - ${f}`);

let pool;
try {
  pool = mysql.createPool(poolOptions());
  await pool.query("SELECT 1");
  const [[who]] = await pool.query("SELECT DATABASE() AS db, CURRENT_USER() AS usr");
  console.log(`\nDATABASE: OK  (db=${who.db}, user=${String(who.usr).split("@")[0]})`);

  const [tables] = await pool.query("SHOW TABLES");
  console.log(`TABLES: ${tables.length} present`);

  try {
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS n, MAX(created_at) AS last FROM `__drizzle_migrations`",
    );
    const n = Number(rows[0].n ?? 0);
    console.log(`MIGRATIONS: ${n} applied (last: ${rows[0].last ?? "n/a"})`);
    console.log(
      n >= local.length
        ? "MIGRATION STATE: up to date"
        : `MIGRATION STATE: ${local.length - n} pending — run: npm run db:migrate`,
    );
  } catch {
    console.log("MIGRATIONS: __drizzle_migrations table not found — 0 applied (fresh database)");
    console.log(`MIGRATION STATE: ${local.length} pending — run: npm run db:migrate`);
  }
} catch (err) {
  const msg = String(err?.message ?? err).replace(/password[^,)\s]*/gi, "password=***");
  console.error(`\nNOT VERIFIED — connection failed: ${msg}`);
  process.exitCode = 1;
} finally {
  await pool?.end().catch(() => {});
}
