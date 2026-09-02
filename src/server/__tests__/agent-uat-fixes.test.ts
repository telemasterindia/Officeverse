/**
 * Agent-side Owner UAT — regression + placement checks for the 16 findings.
 * Every RESTRICTION is enforced server-side; these assert the server code, not
 * just the UI.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatUsPhone, isValidUsPhone, usPhoneDigits, usPhoneSchema } from "../validation/phone";

const root = join(__dirname, "..", "..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const code = (rel: string) => strip(read(rel));

/* --------------------------- #6 US phone ---------------------------- */

describe("#6 — strict US phone validation", () => {
  it("accepts a clean 10-digit US number (any separators)", () => {
    expect(usPhoneDigits("(305) 555-0123")).toBe("3055550123");
    expect(usPhoneDigits("305.555.0123")).toBe("3055550123");
    expect(isValidUsPhone("3055550123")).toBe(true);
  });
  it("accepts 11 digits ONLY when the extra digit is the country code 1", () => {
    expect(usPhoneDigits("1 305 555 0123")).toBe("3055550123");
    expect(usPhoneDigits("+1 (305) 555-0123")).toBe("3055550123");
    expect(usPhoneDigits("23055550123")).toBeNull(); // 11 digits, not leading 1
  });
  it("rejects 12+ digit values", () => {
    expect(usPhoneDigits("130555501234")).toBeNull();
    expect(usPhoneDigits("+44 20 7946 0958")).toBeNull(); // UK number
    expect(isValidUsPhone("919810012345")).toBe(false); // India number
  });
  it("rejects short values and non-NANP area / exchange codes", () => {
    expect(usPhoneDigits("555")).toBeNull();
    expect(usPhoneDigits("055 555 0123")).toBeNull(); // area code starts with 0
    expect(usPhoneDigits("305 155 0123")).toBeNull(); // exchange starts with 1
  });
  it("the zod schema surfaces a clear message and blocks bad input", () => {
    expect(usPhoneSchema.safeParse("(305) 555-0123").success).toBe(true);
    const bad = usPhoneSchema.safeParse("13055550123999");
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]!.message).toMatch(/valid US phone/i);
  });
  it("formatUsPhone normalises accepted input", () => {
    expect(formatUsPhone("13055550123")).toBe("(305) 555-0123");
  });
});

/* ----------------------- #5 shift date (server) --------------------- */

describe("#5 — the capture date is derived server-side for Agents", () => {
  const leadSvc = code("server/leads/service.ts");
  const fuSvc = code("server/followups/service.ts");
  it("createLead ignores a client date for an agent caller", () => {
    expect(leadSvc).toMatch(
      /user\.role === "agent"\s*\?\s*currentShiftDate\(process\)\s*:\s*\(input\.date/,
    );
  });
  it("createFollowUp ignores a client date for an agent caller", () => {
    expect(fuSvc).toMatch(/user\.role === "agent"\s*\?\s*currentShiftDate\(user\.process\)/);
  });
  it("the New-Customer form no longer sends a date and shows a read-only shift date", () => {
    const form = read("routes/_shell.leads.new.tsx");
    expect(form).not.toMatch(/name="lead_date"/);
    expect(form).not.toMatch(/type="date"[^>]*id="lead_date"/);
    expect(form).toMatch(/Set automatically from your assigned shift/);
  });
});

/* --------------------- #7 duplicate phone (server) ----------------- */

describe("#7 — duplicate-phone protection is server-enforced for Agents", () => {
  const leadSvc = code("server/leads/service.ts");
  it("createLead rejects a duplicate phone for an agent with 409 duplicate_phone", () => {
    const body = leadSvc.slice(leadSvc.indexOf("export async function createLead"));
    expect(body).toMatch(/if \(user\.role === "agent"\)/);
    expect(body).toMatch(/repo\.findPossibleDuplicates\(\{ phoneLast10 \}\)/);
    expect(body).toMatch(/usPhoneDigits\(input\.phone\)/);
    expect(body).toMatch(/"duplicate_phone"/);
    expect(body).toMatch(/409/);
  });
  it("there is no client flag that disables the check", () => {
    expect(code("server/validation/leads.ts")).not.toMatch(/skipDuplicate|allowDuplicate|force/i);
  });
});

/* ------------------------- #1 photo (server) ---------------------- */

describe("#1 — only Admin / HR may set or remove the official photo", () => {
  const svc = code("server/hr/photo-service.ts");
  it("setProfilePhoto and removeProfilePhoto both reject non-managers", () => {
    const set = svc.slice(svc.indexOf("export async function setProfilePhoto"));
    const rem = svc.slice(svc.indexOf("export async function removeProfilePhoto"));
    for (const [name, part] of [
      ["set", set.slice(0, set.indexOf("export async function removeProfilePhoto"))],
      ["remove", rem],
    ] as const) {
      expect(part, name).toMatch(/if \(!isPhotoManager\(actor\.role\)\)/);
      expect(part, name).toMatch(/403/);
    }
  });
  it("the Profile page hides the upload controls unless the user is Admin / HR", () => {
    const page = read("routes/_shell.profile.tsx");
    expect(page).toMatch(/canManagePhoto = user\.role === "admin" \|\| user\.role === "hr"/);
    expect(page).toMatch(/\{canManagePhoto \?/);
    expect(page).not.toMatch(/RecognitionPreview/); // #12
  });
});

/* ---------------------- #2 route restrictions -------------------- */

describe("#2 — Settings & Team are not Agent screens", () => {
  it("Settings is gated to admin | hr", () => {
    expect(read("routes/_shell.settings.tsx")).toMatch(/RoleGate allow=\{\["admin", "hr"\]\}/);
  });
  it("Team is gated to closer | admin | hr (no agents)", () => {
    expect(read("routes/_shell.team.tsx")).toMatch(
      /RoleGate allow=\{\["closer", "admin", "hr"\]\}/,
    );
  });
  it("the agent nav never links to Settings", () => {
    const nav = read("lib/officeverse/nav.ts");
    const agentBlock = nav.slice(nav.indexOf("agent: ["), nav.indexOf("closer: ["));
    expect(agentBlock).not.toMatch(/to: "\/settings"/);
    expect(agentBlock).not.toMatch(/to: "\/team"/);
  });
});

/* ----------------------- #3 / #4 shift + tz --------------------- */

describe("#3 / #4 — assigned shift is read-only; timezone reads clearly", () => {
  it("a single IST label is defined and used", () => {
    expect(code("lib/officeverse/followups.ts")).toMatch(
      /IST_TZ_LABEL = "India Standard Time \(IST · UTC\+05:30\)"/,
    );
    expect(read("routes/_shell.profile.tsx")).toMatch(/IST_TZ_LABEL/);
    expect(read("routes/_shell.settings.tsx")).toMatch(/IST_TZ_LABEL/);
  });
  it("Settings no longer offers a timezone selector", () => {
    const s = read("routes/_shell.settings.tsx");
    expect(s).not.toMatch(/"GMT", "EST", "AEST"/);
    expect(s).not.toMatch(/Default timezone/);
  });
  it("the Profile page presents the shift read-only (no editable inputs / Save)", () => {
    const p = read("routes/_shell.profile.tsx");
    expect(p).not.toMatch(/Save changes/);
    expect(p).toMatch(/Assigned shift/);
  });
});

/* ------------------------- #9 demo leads ----------------------- */

describe("#9 — demo / UAT leads are hidden from Agent & Closer lists", () => {
  it("the service passes the demo marker for agent / closer scope only", () => {
    const svc = code("server/leads/service.ts");
    expect(svc).toMatch(/DEMO_LEAD_MARKER/);
    expect(svc).toMatch(
      /scope\.kind === "agent" \|\| scope\.kind === "closer"\s*\?\s*DEMO_LEAD_MARKER/,
    );
    expect(code("server/leads/demo.ts")).toMatch(/DEMO_LEAD_MARKER = "UAT-SEED"/);
  });
  it("the repo excludes rows whose lead_file matches the marker", () => {
    expect(code("server/db/repos/leads.ts")).toMatch(
      /leads\.leadFile\} is null or \$\{leads\.leadFile\} <> \$\{query\.hideLeadFile/,
    );
  });
});

/* ------------ #10 self-export — superseded by Admin UAT §12 ------------- *
 * The prior Agent-UAT rule ("an Agent can export their own leads") is
 * REVERSED by the Admin Owner UAT §12: Agents may NOT export leads or
 * follow-ups. Closer (own) + Admin/HR (all) keep self-export.               */

describe("#12 — self-export is Closer / Admin only; Agents + HR cannot export", () => {
  it("exportMyLeadsFn authenticates; the service rejects agents server-side", () => {
    const fns = read("lib/officeverse/export-fns.ts");
    expect(fns).toMatch(/exportMyLeadsFn = createServerFn\(\{ method: "POST" \}\)/);
    expect(fns).toMatch(/const user = await requireUser\(\)/);
    const svc = code("server/export/service.ts");
    const body = svc.slice(svc.indexOf("export async function runMyExport"));
    expect(body).toMatch(/assertCanSelfExport\(user\.role\)/);
    expect(body).toMatch(/user\.role === "closer"/);
    expect(body).not.toMatch(/user\.role === "agent"/); // agents are rejected by assertCanSelfExport, not scoped
    expect(body).toMatch(/buildXlsx/);
    expect(body).toMatch(/"export\.self"/);
  });
  it("the Data Export centre (preview/download) is ADMIN ONLY (HR role separation)", () => {
    const fns = read("lib/officeverse/export-fns.ts");
    expect(fns).toMatch(/exportPreviewFn[\s\S]{0,200}requireRole\("admin"\)/);
    expect(fns).toMatch(/exportDownloadFn[\s\S]{0,200}requireRole\("admin"\)/);
    expect(fns).not.toMatch(/requireRole\("admin", "hr"\)/);
  });
  it("the Leads / Follow-ups pages hide the Export button from Agents", () => {
    for (const p of ["routes/_shell.leads.index.tsx", "routes/_shell.followups.index.tsx"]) {
      const page = read(p);
      expect(page).toMatch(/!isAgent \? \(/);
      expect(page).toMatch(/exportMine\.mutate\(/);
    }
  });
});

/* --------------------------- #11 search ------------------------ */

describe("#11 — ⌘K search is a bounded typeahead, never the whole list", () => {
  const sc = code("components/officeverse/search-command.tsx");
  it("fetches nothing until >= 2 characters, then only the top 8 server matches", () => {
    expect(sc).toMatch(/const active = q\.length >= 2/);
    expect(sc).toMatch(
      /useServerLeads\(\s*\{ q, pageSize: 8, sort: "newest" \}\s*,\s*\{ enabled: active \}/,
    );
  });
  it("selecting a result opens that specific lead", () => {
    expect(sc).toMatch(/to: "\/leads\/\$leadId", params: \{ leadId \}/);
  });
  it("useServerLeads honours an `enabled` option", () => {
    expect(code("lib/officeverse/use-lead-lifecycle.ts")).toMatch(
      /enabled: opts\.enabled \?\? true/,
    );
  });
});

/* ---------------------- #12 / #13 recognition ------------------ */

describe("#12 / #13 — recognition is server-event only and its effect is visible", () => {
  it("there is no client-callable 'award' / 'trigger recognition' endpoint", () => {
    const g = code("lib/officeverse/gamification-fns.ts");
    expect(g).not.toMatch(/awardFn|triggerRecognitionFn|celebrateFn|givePointsFn/);
  });
  it("the effect ring is OUTSET so it is visible over the photo (was hidden by ring-inset)", () => {
    const fx = read("components/officeverse/photo/PhotoEffect.tsx");
    expect(fx).not.toMatch(/ring-inset/);
    expect(fx).toMatch(/ov-photo-fx-live/);
  });
  it("styles.css draws a bright per-effect ring on top of the photo", () => {
    const css = read("styles.css");
    expect(css).toMatch(/\.ov-photo-fx::after/);
    expect(css).toMatch(/--fx-color/);
    expect(css).toMatch(/\.ov-photo-fx\[data-effect="MONEY"\]/);
  });
});

/* ----------------------- #15 / #16 cron ---------------------- */

describe("#15 / #16 — daily follow-up-count email + birthday email", () => {
  const jobs = read("server/notifications/daily-jobs.ts");
  it("the daily summary is one plain email stating only today's count", () => {
    const tpl = read("server/email/templates.ts");
    expect(tpl).toMatch(/FOLLOW_UP_DAILY_SUMMARY/);
    expect(tpl).toMatch(/You have \$\{count\} \$\{noun\} for today\./);
    expect(jobs).toMatch(/template: "FOLLOW_UP_DAILY_SUMMARY"/);
    expect(jobs).toMatch(/u\.role !== "agent"/); // agent-side scope
    expect(jobs).toMatch(/dedupeKey: `daily-followup:\$\{u\.id\}:\$\{today\}:email`/);
  });
  it("the birthday email fires on the employee's month + day", () => {
    const tpl = read("server/email/templates.ts");
    expect(tpl).toMatch(/BIRTHDAY_GREETING/);
    expect(jobs).toMatch(/date_format\(\$\{agents\.dob\}, '%m-%d'\) = \$\{want\}/);
    expect(jobs).toMatch(/dedupeKey: `birthday:\$\{u\.id\}:\$\{year\}:email`/);
  });
  it("/internal/tick runs both jobs, cron-secret gated, dry-run by default", () => {
    const routes = code("server/internal-routes.ts");
    expect(routes).toMatch(/path === "\/internal\/tick"/);
    expect(routes).toMatch(/runDailyTick\(\{ dryRun \}\)/);
    expect(routes).toMatch(/url\.searchParams\.get\("run"\) !== "1"/);
    expect(routes).toMatch(
      /if \(!cronAuthorized\(request\)\) return json\(\{ error: "unauthorized" \}, 401\)/,
    );
  });
});

/* ------------- New-Customer phone/email inline validation UX --------------- */

describe("New-Customer phone/email inline validation UX", () => {
  it("the client-safe phone/email helpers live outside src/server", () => {
    // importable from a client file (no server-only imports in the module)
    const lib = read("lib/officeverse/phone.ts");
    expect(lib).toMatch(/export function usPhoneDigits/);
    expect(lib).toMatch(/export function isValidEmail/);
    expect(lib).not.toMatch(/from "\.\.\/\.\.\/server|@\/server/);
    // the server schema re-exports them (single source of truth)
    expect(code("server/validation/phone.ts")).toMatch(/from "@\/lib\/officeverse\/phone"/);
  });

  it("checkLeadDuplicateFn is a GET, authenticates, and returns a read-scoped result", () => {
    const fns = read("lib/officeverse/lead-fns.ts");
    expect(fns).toMatch(/checkLeadDuplicateFn = createServerFn\(\{ method: "GET" \}\)/);
    expect(fns).toMatch(/const user = await requireUser\(\)/);
    const svc = read("server/leads/service.ts");
    const region = svc.slice(
      svc.indexOf("async function describeDuplicate"),
      svc.indexOf("/* ------------------------------ internals"),
    );
    expect(region).toMatch(/assertCanReadLead\(actor, row\)/); // read-scoping
    expect(region).toMatch(/visible \? row\.leadCode : null/);
    expect(region).not.toMatch(/recordAudit|insertLead\(/); // no side effects
  });

  it("the check is DB-backed (no localStorage) and phone matches on last-10 digits", () => {
    const svc = code("server/leads/service.ts");
    const body = svc.slice(svc.indexOf("export async function checkLeadDuplicate"));
    expect(body).not.toMatch(/localStorage/);
    expect(body).toMatch(/repo\.findPossibleDuplicates\(\{ phoneLast10: usPhoneDigits/);
    expect(body).toMatch(/repo\.findPossibleDuplicates\(\{ emailNormalized:/);
  });

  it("the form validates inline (debounced), phone required + email optional, and blocks submit", () => {
    const f = code("routes/_shell.leads.new.tsx");
    expect(f).toMatch(/useLeadDuplicateCheck/);
    expect(f).toMatch(/setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*setDupKeys/); // debounce
    expect(f).toMatch(/onBlur=\{\(\) => setPhoneBlur\(true\)\}/); // validate on blur
    expect(f).toMatch(/onBlur=\{\(\) => setEmailBlur\(true\)\}/);
    expect(f).toMatch(/Phone number \(US\) <span className="text-destructive">\*/); // mandatory
    expect(f).toMatch(/Email <span[^>]*>\(optional\)/); // optional
    // submit is gated on a valid, non-duplicate phone; an invalid email also blocks;
    // an email DUPLICATE is a warning (tone="warning"), not a blocker
    expect(f).toMatch(/phoneDigits !== null && !phone_\.dup && !email_\.formatBad/);
    expect(f).toMatch(/tone="warning"\s+label="email"/);
    expect(f).toMatch(/if \(phone_\.dup\) \{[\s\S]*duplicate leads are not allowed/);
  });

  it("all four inline states are represented", () => {
    const f = read("routes/_shell.leads.new.tsx");
    expect(f).toMatch(/kind === "checking"/); // Checking
    expect(f).toMatch(/kind === "valid"/); // Valid
    expect(f).toMatch(/kind === "invalid"/); // Invalid
    expect(f).toMatch(/\/\/ duplicate\n/); // Duplicate branch in FieldStatus
  });
});
