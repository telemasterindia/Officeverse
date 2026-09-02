/**
 * Officeverse — LOCAL-ONLY Phase 24 UAT seed.
 *
 *   node --env-file=.env scripts/seed-uat.mjs
 *
 * Creates a small, clearly-marked UAT dataset (all emails end in
 * `.uat@officeverse.local`, all networks/records are labelled "UAT ...").
 *
 * SAFETY — this script REFUSES to run unless ALL of these hold:
 *   - NODE_ENV !== "production"
 *   - the connected database name matches /dryrun/i
 *   - the database name is NOT exactly "TMI_officeverse" (production)
 *   - the DB host is loopback (127.0.0.1 / ::1 / localhost)
 *   - the host string contains no "godaddy" / "secureserver"
 *
 * It is IDEMPOTENT: every entity is get-or-created by its natural business key,
 * so re-running tops up without duplicating. It writes ONLY through plain
 * parameterised INSERT/SELECT against the local schema — it never touches
 * application business logic, .env.example, or any production config.
 *
 * It contains NO production credentials and NO real customer data.
 */
import { createHash, randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { hash as argon2Hash } from "@node-rs/argon2";

/* ----------------------------- config + guards ---------------------------- */

const ARGON2_OPTS = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

const UAT_PASSWORD = "Officeverse#UAT1";

function connOptions() {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    return {
      uri: url,
      host: new URL(url).hostname,
      name: new URL(url).pathname.replace(/^\//, ""),
    };
  }
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;
  if (!DB_HOST || !DB_NAME || !DB_USER) {
    console.error("ABORT — no local DB credentials (DATABASE_URL or DB_HOST/DB_NAME/DB_USER).");
    process.exit(2);
  }
  return {
    opts: {
      host: DB_HOST,
      port: Number(DB_PORT ?? 3306),
      database: DB_NAME,
      user: DB_USER,
      password: DB_PASSWORD ?? "",
    },
    host: DB_HOST,
    name: DB_NAME,
  };
}

function assertLocalDryRun({ host, name }) {
  const fail = (m) => {
    console.error(`ABORT — ${m}`);
    process.exit(3);
  };
  if ((process.env.NODE_ENV ?? "development") === "production") fail("NODE_ENV=production");
  if (!/dryrun/i.test(name)) fail(`database name "${name}" does not look like a dryrun DB`);
  if (name === "TMI_officeverse")
    fail('refusing to touch the production database "TMI_officeverse"');
  const h = (host ?? "").toLowerCase();
  if (!["127.0.0.1", "::1", "localhost", ""].includes(h)) fail(`DB host "${host}" is not loopback`);
  if (/godaddy|secureserver/.test(h)) fail("DB host looks like GoDaddy");
}

/* -------------------------------- helpers -------------------------------- */

function istWall(offsetMs = 0) {
  const d = new Date(Date.now() + offsetMs);
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value ?? "00";
  const hh = g("hour") === "24" ? "00" : g("hour");
  return `${g("year")}-${g("month")}-${g("day")} ${hh}:${g("minute")}:${g("second")}`;
}
const istDate = (offDays = 0) => istWall(offDays * 86_400_000).slice(0, 10);

const NOW = istWall();
const OP_DATE = istDate(-1); // "yesterday" — a stable recent operational shift date
let conn;
const summary = {};
const bump = (k, n = 1) => (summary[k] = (summary[k] ?? 0) + n);

async function one(sql, args = []) {
  const [rows] = await conn.query(sql, args);
  return rows[0];
}
async function run(sql, args = []) {
  const [res] = await conn.query(sql, args);
  return res;
}

/* -------------------------- get-or-create builders ---------------------- */

async function ensureUser(email, { fullName, role, process }) {
  const existing = await one("SELECT id FROM users WHERE email = ?", [email]);
  if (existing) return existing.id;
  const res = await run(
    `INSERT INTO users (email, password_hash, full_name, role, process, status, must_change_password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?)`,
    [email, PW_HASH, fullName, role, process, NOW, NOW],
  );
  bump("users");
  return res.insertId;
}

async function ensureAgent(userId, code) {
  const existing = await one("SELECT id FROM agents WHERE user_id = ?", [userId]);
  if (existing) return existing.id;
  const res = await run(
    `INSERT INTO agents (user_id, agent_code, registered_on, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, code, OP_DATE, NOW, NOW],
  );
  bump("agents");
  return res.insertId;
}

async function ensureCloser(userId, code) {
  const existing = await one("SELECT id FROM closers WHERE user_id = ?", [userId]);
  if (existing) return existing.id;
  const res = await run(
    `INSERT INTO closers (user_id, closer_code, registered_on, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, code, OP_DATE, NOW, NOW],
  );
  bump("closers");
  return res.insertId;
}

// Every seeded lead is tagged in `lead_file` so agent-facing views can hide the
// demo customers (Agent-side UAT #9 — matches DEMO_LEAD_MARKER in
// src/server/leads/demo.ts). Admin / HR still see them for review / purge.
const DEMO_LEAD_MARKER = "UAT-SEED";

/** last 10 digits — the same duplicate-key the server compares with RIGHT(...,10). */
const norm10 = (v) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d ? d.slice(-10) : null;
};

async function ensureLead(code, r) {
  const pn = norm10(r.phone);
  const en = r.email ? String(r.email).trim().toLowerCase() : null;
  const existing = await one("SELECT id FROM leads WHERE lead_code = ?", [code]);
  if (existing) {
    await run(
      `UPDATE leads SET lead_file = ?, phone_normalized = COALESCE(phone_normalized, ?),
         email_normalized = COALESCE(email_normalized, ?)
       WHERE id = ?`,
      [DEMO_LEAD_MARKER, pn, en, existing.id],
    );
    return existing.id;
  }
  const res = await run(
    `INSERT INTO leads
       (lead_code, shift_date, customer_name, phone, phone_normalized, email, email_normalized,
        agent_id, assigned_closer_id, status, source, lead_file,
        converted_from_follow_up_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      code,
      r.shiftDate ?? OP_DATE,
      r.customerName,
      r.phone,
      pn,
      r.email ?? null,
      en,
      r.agentId ?? null,
      r.closerId ?? null,
      r.status ?? "NEW",
      r.source ?? "app",
      DEMO_LEAD_MARKER,
      r.convertedFromFollowUpId ?? null,
      NOW,
      NOW,
    ],
  );
  bump("leads");
  return res.insertId;
}

async function ensureFollowUp(code, r) {
  const existing = await one("SELECT id FROM follow_ups WHERE follow_up_code = ?", [code]);
  if (existing) return existing.id;
  const res = await run(
    `INSERT INTO follow_ups
       (follow_up_code, owner_user_id, owner_role, customer_name, phone, capture_date,
        scheduled_at, status, lead_id, converted_lead_code, converted_at,
        created_by_user_id, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'app', ?, ?)`,
    [
      code,
      r.ownerUserId,
      r.ownerRole,
      r.customerName,
      r.phone,
      r.captureDate ?? OP_DATE,
      r.scheduledAt ?? istWall(2 * 86_400_000),
      r.status ?? "SCHEDULED",
      r.leadId ?? null,
      r.convertedLeadCode ?? null,
      r.convertedAt ?? null,
      r.createdByUserId,
      NOW,
      NOW,
    ],
  );
  bump("follow_ups");
  return res.insertId;
}

async function ensureAssignmentHistory(leadId, toCloserId, byUserId) {
  const existing = await one(
    "SELECT id FROM lead_assignments WHERE lead_id = ? AND action = 'assign' LIMIT 1",
    [leadId],
  );
  if (existing) return;
  await run(
    `INSERT INTO lead_assignments (lead_id, from_closer_id, to_closer_id, action, by_user_id, note, created_at)
     VALUES (?, NULL, ?, 'assign', ?, 'UAT seed', ?)`,
    [leadId, toCloserId, byUserId, NOW],
  );
  bump("lead_assignments");
}

async function ensureAttendance(userId, role, process, r) {
  const existing = await one(
    "SELECT id FROM attendance WHERE user_id = ? AND operational_date = ?",
    [userId, OP_DATE],
  );
  if (existing) return;
  await run(
    `INSERT INTO attendance
       (user_id, role, process, shift_name, operational_date, reporting_at, shift_start_at, shift_end_at,
        first_check_in_at, last_check_out_at, total_minutes, late_minutes, early_departure_minutes,
        check_in_status, check_out_status, status, short_attendance, session_count, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1, 'derived', ?, ?)`,
    [
      userId,
      role,
      process,
      process === "US" ? "US SHIFT" : "INDIA SHIFT",
      OP_DATE,
      r.reportingAt,
      r.shiftStartAt,
      r.shiftEndAt,
      r.firstCheckInAt,
      r.lastCheckOutAt,
      r.totalMinutes ?? 480,
      r.lateMinutes ?? 0,
      r.checkInStatus,
      "ON_TIME",
      r.status,
      r.shortAttendance ? 1 : 0,
      NOW,
      NOW,
    ],
  );
  bump("attendance");
}

async function ensureNetwork(name, cidr, process) {
  const existing = await one("SELECT id FROM office_networks WHERE name = ?", [name]);
  if (existing) return;
  await run(
    `INSERT INTO office_networks (name, cidr, process, enabled, note, created_at, updated_at)
     VALUES (?, ?, ?, 1, 'UAT seed', ?, ?)`,
    [name, cidr, process, NOW, NOW],
  );
  bump("office_networks");
}

async function ensurePointRule(event, points) {
  await run(
    `INSERT INTO gamification_point_rules (event, points, enabled, note, created_at, updated_at)
     VALUES (?, ?, 1, 'UAT seed (editable in Admin)', ?, ?)
     ON DUPLICATE KEY UPDATE points = VALUES(points), updated_at = VALUES(updated_at)`,
    [event, points, NOW, NOW],
  );
  bump("gamification_point_rules");
}

async function ensurePointTxn(userId, role, process, event, points, refCode) {
  const dedupe = `${event}:lead:${refCode}`;
  const existing = await one(
    "SELECT id FROM gamification_point_transactions WHERE dedupe_key = ?",
    [dedupe],
  );
  if (existing) return;
  await run(
    `INSERT INTO gamification_point_transactions
       (user_id, role, process, event, points, operational_date, reference_type, reference_id,
        dedupe_key, status, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'lead', ?, ?, 'ACTIVE', 'system', ?)`,
    [userId, role, process, event, points, OP_DATE, refCode, dedupe, NOW],
  );
  bump("gamification_point_transactions");
}

async function ensureCelebrationEffect(category, effect) {
  const existing = await one(
    "SELECT id FROM celebration_assets WHERE category = ? AND kind = 'effect'",
    [category],
  );
  if (existing) return;
  await run(
    `INSERT INTO celebration_assets (category, kind, label, effect, enabled, builtin, created_at)
     VALUES (?, 'effect', ?, ?, 1, 1, ?)`,
    [category, `${category} (built-in effect)`, effect, NOW],
  );
  bump("celebration_assets");
}

async function ensureTvEvent(kind, subjectUserId, tier, effect, category, message, refCode) {
  const dedupe = `${kind}:lead:${refCode}`;
  const existing = await one("SELECT id FROM office_tv_events WHERE dedupe_key = ?", [dedupe]);
  if (existing) return;
  await run(
    `INSERT INTO office_tv_events
       (kind, subject_user_id, tier, effect, asset_category, message, reference_type, reference_id,
        dedupe_key, operational_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'lead', ?, ?, ?, ?)`,
    [kind, subjectUserId, tier, effect, category, message, refCode, dedupe, OP_DATE, NOW],
  );
  bump("office_tv_events");
}

/* --------------------------------- main --------------------------------- */

const cfg = connOptions();
assertLocalDryRun(cfg);

let PW_HASH;

async function main() {
  conn = await mysql.createConnection(
    cfg.uri
      ? { uri: cfg.uri, dateStrings: true, timezone: "+05:30" }
      : { ...cfg.opts, dateStrings: true, timezone: "+05:30" },
  );

  const db = (await one("SELECT DATABASE() AS db")).db;
  if (!/dryrun/i.test(db)) {
    console.error(`ABORT — connected database "${db}" is not a dryrun DB.`);
    process.exit(3);
  }
  console.log(`✓ Connected to LOCAL dryrun database: ${db}`);

  PW_HASH = await argon2Hash(UAT_PASSWORD, ARGON2_OPTS);

  /* ---- users + staff ---- */
  const admin = await ensureUser("admin.uat@officeverse.local", {
    fullName: "UAT Admin",
    role: "admin",
    process: "US",
  });
  await ensureUser("hr.uat@officeverse.local", { fullName: "UAT HR", role: "hr", process: "IN" });

  const usA1 = await ensureUser("us.agent1.uat@officeverse.local", {
    fullName: "Rahul Sharma (US)",
    role: "agent",
    process: "US",
  });
  const usA2 = await ensureUser("us.agent2.uat@officeverse.local", {
    fullName: "Priya Patel (US)",
    role: "agent",
    process: "US",
  });
  const usC1 = await ensureUser("us.closer1.uat@officeverse.local", {
    fullName: "Gurpreet Singh (US)",
    role: "closer",
    process: "US",
  });
  const usC2 = await ensureUser("us.closer2.uat@officeverse.local", {
    fullName: "Neha Gupta (US)",
    role: "closer",
    process: "US",
  });
  const inA1 = await ensureUser("in.agent1.uat@officeverse.local", {
    fullName: "Ayush Verma (IN)",
    role: "agent",
    process: "IN",
  });
  const inA2 = await ensureUser("in.agent2.uat@officeverse.local", {
    fullName: "Kavya Nair (IN)",
    role: "agent",
    process: "IN",
  });
  const inC1 = await ensureUser("in.closer1.uat@officeverse.local", {
    fullName: "Rohit Mehra (IN)",
    role: "closer",
    process: "IN",
  });

  const agUsA1 = await ensureAgent(usA1, "AG-90001");
  const agUsA2 = await ensureAgent(usA2, "AG-90002");
  const agInA1 = await ensureAgent(inA1, "AG-90003");
  const agInA2 = await ensureAgent(inA2, "AG-90004");
  const clUsC1 = await ensureCloser(usC1, "CL-90001");
  const clUsC2 = await ensureCloser(usC2, "CL-90002");
  const clInC1 = await ensureCloser(inC1, "CL-90003");

  /* ---- office networks (IP UAT) ---- */
  await ensureNetwork("UAT Localhost (all) v4", "127.0.0.1/32", null);
  await ensureNetwork("UAT Localhost (all) v6", "::1/128", null);
  await ensureNetwork("UAT US Office (example)", "203.0.113.0/24", "US");
  await ensureNetwork("UAT India Office (example)", "198.51.100.0/24", "IN");

  /* ---- leads (US + India, several statuses) ---- */
  const L1 = await ensureLead("TMI_00012007", {
    customerName: "Walter White",
    phone: "+13105550107",
    agentId: agUsA1,
    status: "NEW",
  });
  const L2 = await ensureLead("TMI_00012014", {
    customerName: "Jesse Pinkman",
    phone: "+13105550114",
    agentId: agUsA1,
    closerId: clUsC1,
    status: "ASSIGNED",
  });
  const L3 = await ensureLead("TMI_00012021", {
    customerName: "Skyler White",
    phone: "+13105550121",
    agentId: agUsA2,
    closerId: clUsC1,
    status: "ACCEPTED",
  });
  const L4 = await ensureLead("TMI_00012028", {
    customerName: "Hank Schrader",
    phone: "+13105550128",
    agentId: agUsA2,
    closerId: clUsC2,
    status: "ACCEPTED",
  });
  const L5 = await ensureLead("TMI_00012035", {
    customerName: "Rohan Kapoor",
    phone: "+919810050035",
    agentId: agInA1,
    closerId: clInC1,
    status: "ASSIGNED",
  });
  await ensureLead("TMI_00012042", {
    customerName: "Meera Iyer",
    phone: "+919810050042",
    agentId: agInA2,
    closerId: clInC1,
    status: "FOLLOW-UP",
  });
  const L7 = await ensureLead("TMI_00012049", {
    customerName: "Gustavo Fring",
    phone: "+13105550149",
    agentId: agUsA1,
    closerId: clUsC1,
    status: "COMPLETED",
  });

  await ensureAssignmentHistory(L2, clUsC1, admin);
  await ensureAssignmentHistory(L3, clUsC1, admin);
  await ensureAssignmentHistory(L5, clInC1, admin);

  /* ---- follow-ups: Ayush has volume for the employee-exit / bulk-distribute UAT ---- */
  const ayushFu = [];
  for (let i = 0; i < 5; i++) {
    ayushFu.push(
      await ensureFollowUp(`FU_00094${400 + i * 3}`, {
        ownerUserId: inA1,
        ownerRole: "agent",
        customerName: `IN Callback ${i + 1}`,
        phone: `+91981005${5000 + i}`,
        leadId: i === 0 ? L5 : null,
        createdByUserId: inA1,
        scheduledAt: istWall((i + 1) * 86_400_000),
      }),
    );
  }
  await ensureFollowUp("FU_00094415", {
    ownerUserId: usA1,
    ownerRole: "agent",
    customerName: "US Callback A",
    phone: "+13105559415",
    leadId: L2,
    createdByUserId: usA1,
  });
  await ensureFollowUp("FU_00094418", {
    ownerUserId: usA1,
    ownerRole: "agent",
    customerName: "US Callback B",
    phone: "+13105559418",
    createdByUserId: usA1,
  });
  // Closer-owned follow-ups (Closer Follow-ups reassignment UAT)
  await ensureFollowUp("FU_00094421", {
    ownerUserId: usC1,
    ownerRole: "closer",
    customerName: "US Closer Callback 1",
    phone: "+13105559421",
    leadId: L3,
    createdByUserId: usC1,
  });
  await ensureFollowUp("FU_00094424", {
    ownerUserId: usC1,
    ownerRole: "closer",
    customerName: "US Closer Callback 2",
    phone: "+13105559424",
    leadId: L4,
    createdByUserId: usC1,
  });

  /* ---- one CONVERTED follow-up + its resulting Lead (lineage UAT) ---- */
  const convLeadCode = "TMI_00012056";
  const convFuCode = "FU_00094430";
  let convFuId = (await one("SELECT id FROM follow_ups WHERE follow_up_code = ?", [convFuCode]))
    ?.id;
  if (!convFuId) {
    convFuId = await ensureFollowUp(convFuCode, {
      ownerUserId: inA1,
      ownerRole: "agent",
      customerName: "Converted Prospect (Nikhil Rao)",
      phone: "+919810050056",
      status: "CONVERTED",
      convertedLeadCode: convLeadCode,
      convertedAt: NOW,
      createdByUserId: inA1,
    });
  }
  const convLeadId = await ensureLead(convLeadCode, {
    customerName: "Converted Prospect (Nikhil Rao)",
    phone: "+919810050056",
    agentId: agInA1,
    closerId: clInC1,
    status: "ASSIGNED",
    source: "conversion",
    convertedFromFollowUpId: convFuId,
  });
  // back-link the follow-up to the resulting lead id if not set
  await run("UPDATE follow_ups SET lead_id = ? WHERE follow_up_code = ? AND lead_id IS NULL", [
    convLeadId,
    convFuCode,
  ]);

  /* ---- attendance (HR view + Closer managed view + override UAT) ---- */
  const usAnchors = {
    reportingAt: `${OP_DATE} 20:50:00`,
    shiftStartAt: `${OP_DATE} 21:00:00`,
    shiftEndAt: `${istDate(0)} 06:00:00`,
  };
  const inAnchors = {
    reportingAt: `${OP_DATE} 09:30:00`,
    shiftStartAt: `${OP_DATE} 09:30:00`,
    shiftEndAt: `${OP_DATE} 18:30:00`,
  };
  await ensureAttendance(usA1, "agent", "US", {
    ...usAnchors,
    firstCheckInAt: `${OP_DATE} 20:45:00`,
    lastCheckOutAt: `${istDate(0)} 06:05:00`,
    checkInStatus: "ON_TIME",
    status: "ON_TIME",
  });
  await ensureAttendance(usA2, "agent", "US", {
    ...usAnchors,
    firstCheckInAt: `${OP_DATE} 21:05:00`,
    lastCheckOutAt: `${istDate(0)} 06:00:00`,
    checkInStatus: "SHORT",
    status: "SHORT_ATTENDANCE",
    shortAttendance: true,
    lateMinutes: 15,
  });
  await ensureAttendance(inA1, "agent", "IN", {
    ...inAnchors,
    firstCheckInAt: `${OP_DATE} 10:05:00`,
    lastCheckOutAt: `${OP_DATE} 18:35:00`,
    checkInStatus: "LATE",
    status: "LATE",
    lateMinutes: 35,
  });
  await ensureAttendance(usC1, "closer", "US", {
    ...usAnchors,
    firstCheckInAt: `${OP_DATE} 20:55:00`,
    lastCheckOutAt: `${istDate(0)} 06:00:00`,
    checkInStatus: "ON_TIME",
    status: "ON_TIME",
  });

  /* ---- gamification: rules + a few point events (leaderboard content) ---- */
  await ensurePointRule("LEAD_SUBMITTED", 1);
  await ensurePointRule("LEAD_ACCEPTED", 5);
  await ensurePointRule("SALE", 20);
  await ensurePointRule("TEAM_MILESTONE", 10);
  await ensurePointRule("ACHIEVEMENT_UNLOCKED", 3);

  await ensurePointTxn(usA1, "agent", "US", "LEAD_SUBMITTED", 1, "TMI_00012007");
  await ensurePointTxn(usA1, "agent", "US", "LEAD_SUBMITTED", 1, "TMI_00012014");
  await ensurePointTxn(usA1, "agent", "US", "LEAD_ACCEPTED", 5, "TMI_00012014");
  await ensurePointTxn(usA1, "agent", "US", "SALE", 20, "TMI_00012049");
  await ensurePointTxn(usA2, "agent", "US", "LEAD_SUBMITTED", 1, "TMI_00012021");
  await ensurePointTxn(usA2, "agent", "US", "LEAD_ACCEPTED", 5, "TMI_00012021");
  await ensurePointTxn(inA1, "agent", "IN", "LEAD_SUBMITTED", 1, "TMI_00012035");
  await ensurePointTxn(inA1, "agent", "IN", "LEAD_SUBMITTED", 1, "TMI_00012042");
  await ensurePointTxn(inA1, "agent", "IN", "LEAD_ACCEPTED", 5, "TMI_00012035");

  /* ---- Office TV: built-in effect registry + settings + display + announcement + events ---- */
  const effects = [
    ["VICTORY", "VICTORY"],
    ["FIREWORKS", "CELEBRATION"],
    ["CONFETTI", "CELEBRATION"],
    ["GOLD", "CHAMPION"],
    ["MONEY", "MONEY"],
    ["ENERGY", "ENERGETIC"],
    ["CHAMPION", "CHAMPION"],
    ["PARTY", "FESTIVAL"],
    ["FESTIVAL", "FESTIVAL"],
  ];
  for (const [category, effect] of effects) await ensureCelebrationEffect(category, effect);

  await run(
    `INSERT INTO office_tv_settings (id, updated_by_user_id, updated_at)
     VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`,
    [admin, NOW],
  );
  bump("office_tv_settings");

  // Display token — created if absent, otherwise ROTATED so the run always
  // yields a usable token. The raw value is shown ONCE, here.
  const rawToken = "ovtv_" + randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const tokenPrefix = rawToken.slice(0, 12);
  const disp = await one("SELECT id FROM office_tv_displays WHERE name = ?", [
    "UAT Sales Floor TV",
  ]);
  if (disp) {
    await run(
      `UPDATE office_tv_displays SET token_hash = ?, token_prefix = ?, enabled = 1, revoked_at = NULL, rotated_at = ? WHERE id = ?`,
      [tokenHash, tokenPrefix, NOW, disp.id],
    );
    bump("office_tv_displays_rotated");
  } else {
    await run(
      `INSERT INTO office_tv_displays (name, token_hash, token_prefix, scope, enabled, created_by_user_id, created_at)
       VALUES ('UAT Sales Floor TV', ?, ?, 'tv_read', 1, ?, ?)`,
      [tokenHash, tokenPrefix, admin, NOW],
    );
    bump("office_tv_displays");
  }
  summary.__tvToken = rawToken;

  const ann = await one("SELECT id FROM office_tv_announcements WHERE title = ?", [
    "SPECIAL POWER HOUR",
  ]);
  if (!ann) {
    await run(
      `INSERT INTO office_tv_announcements
         (title, subtitle, message, audience, effect, duration_ms, priority, status, published_at, enabled, created_by_user_id, created_at, updated_at)
       VALUES ('SPECIAL POWER HOUR', '10 PM – 11 PM', 'Let''s go team! Double the energy this hour.',
               'all', 'FESTIVAL', 14000, 'IMPORTANT', 'published', ?, 1, ?, ?, ?)`,
      [NOW, admin, NOW, NOW],
    );
    bump("office_tv_announcements");
  }

  await ensureTvEvent(
    "LEAD_SUBMITTED",
    usA1,
    1,
    "ENERGETIC",
    "ENERGY",
    "LEAD SUBMITTED",
    "TMI_00012014",
  );
  await ensureTvEvent(
    "LEAD_ACCEPTED",
    usA2,
    2,
    "CELEBRATION",
    "CONFETTI",
    "LEAD ACCEPTED!",
    "TMI_00012021",
  );
  await ensureTvEvent("SALE", usA1, 4, "CHAMPION", "GOLD", "SALE!", "TMI_00012049");

  /* ---- audit marker ---- */
  await run(
    `INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_code, metadata, created_at)
     VALUES (?, 'admin', 'uat.seed', 'system', 'UAT-SEED', ?, ?)`,
    [admin, JSON.stringify({ op_date: OP_DATE, at: NOW }), NOW],
  );
  bump("audit_logs");
}

main()
  .then(async () => {
    await conn?.end();
    const token = summary.__tvToken;
    delete summary.__tvToken;
    console.log("\n=== UAT SEED SUMMARY (idempotent — created-or-existing) ===");
    for (const [k, v] of Object.entries(summary).sort()) console.log(`  ${k.padEnd(34)} +${v}`);
    console.log("\nUAT login password (all seeded users):  " + UAT_PASSWORD);
    console.log("Office TV display token (shown once):    " + token);
    console.log("Open the TV at:  http://<LOCAL-IP>:8080/office-tv?token=" + token);
    console.log("\n✓ LOCAL dryrun seed complete. GoDaddy / production NOT touched.");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("\nSEED FAILED:", err?.message ?? err);
    await conn?.end().catch(() => {});
    process.exit(1);
  });
