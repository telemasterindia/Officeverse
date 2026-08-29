import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config — MySQL / MariaDB (GoDaddy cPanel target).
 *
 *   npm run db:generate   → diff schema.ts into ./drizzle/*.sql   (no DB needed)
 *   npm run db:migrate    → apply pending migrations               (needs DB)
 *   npm run db:studio     → browse the DB                          (needs DB)
 *
 * Credentials are read from the environment only (DATABASE_URL or DB_*), never
 * hardcoded. `generate` does not connect; the placeholder URL below is only so
 * the config type-checks when no env is set.
 */
function url(): string {
  const direct = process.env["DATABASE_URL"];
  if (direct && direct.trim()) return direct.trim();
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;
  if (DB_HOST && DB_NAME && DB_USER) {
    const pw = DB_PASSWORD ? `:${encodeURIComponent(DB_PASSWORD)}` : "";
    return `mysql://${DB_USER}${pw}@${DB_HOST}:${DB_PORT ?? 3306}/${DB_NAME}`;
  }
  return "mysql://user:pass@localhost:3306/officeverse"; // generate-only placeholder
}

export default defineConfig({
  dialect: "mysql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: url() },
  strict: true,
  verbose: true,
});
