/**
 * Officeverse — bulk-import row normalisation (Phase 7). PURE. No DB.
 *
 * Maps one raw spreadsheet row (via the chosen column mapping) into typed
 * Lead / Follow-up drafts and collects field-level errors. Uses ONLY the
 * canonical helpers: `normalizePhone` / `normalizeEmail` for identity, and
 * `toScheduledWallClock` (from src/server/time.ts → src/lib/officeverse/shift.ts)
 * for the callback instant — no bespoke date/shift maths.
 */
import type { ColumnMapping } from "@/lib/officeverse/import/mapping";
import {
  CURRENT_DEBTS_VALUES,
  FOLLOWUP_OWNER_ROLES,
  LEAD_STATUS_VALUES,
  type ImportMode,
} from "@/lib/officeverse/import/fields";
import type { RowIssue } from "@/lib/officeverse/import/types";
import { normalizeEmail, normalizePhone } from "../normalize";
import { toScheduledWallClock } from "../time";

export interface NormalizedLead {
  customerName: string;
  phone: string;
  phoneNormalized: string;
  email: string | null;
  emailNormalized: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  debtAmount: string;
  creditStatus: string | null;
  currentDebts: "Current" | "Late";
  comments: string | null;
  status: (typeof LEAD_STATUS_VALUES)[number];
  agentCode: string | null;
  closerCode: string | null;
  importRef: string | null;
}

export interface NormalizedFollowUp {
  scheduledDate: string;
  scheduledTime: string;
  scheduledAt: string;
  comment: string | null;
  ownerRole: "agent" | "closer";
  closerCode: string | null;
  captureDate: string | null;
}

export interface NormalizedRow {
  rowNumber: number;
  raw: Record<string, string>;
  lead: NormalizedLead | null;
  followUp: NormalizedFollowUp | null;
  /** follow-ups mode: how this row references its existing Lead */
  linkLeadCode: string | null;
  linkPhoneNormalized: string | null;
  importRef: string | null;
  errors: RowIssue[];
  warnings: RowIssue[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const LEAD_CODE_RE = /^TMI_\d{8}$/;

function err(rowNumber: number, field: string | null, code: string, message: string): RowIssue {
  return { rowNumber, field, code, message, severity: "error" };
}
function warn(rowNumber: number, field: string | null, code: string, message: string): RowIssue {
  return { rowNumber, field, code, message, severity: "warning" };
}

function isRealDate(ymd: string): boolean {
  if (!DATE_RE.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
}

function isRealTime(hm: string): boolean {
  const mtch = TIME_RE.exec(hm);
  if (!mtch) return false;
  const h = Number(mtch[1]);
  const mi = Number(mtch[2]);
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
}

export function normalizeRow(
  raw: Record<string, string>,
  mapping: ColumnMapping,
  mode: ImportMode,
  rowNumber: number,
): NormalizedRow {
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const get = (key: string): string => {
    const header = mapping[key];
    if (!header) return "";
    return (raw[header] ?? "").trim();
  };

  const importRef = get("import_ref") || null;

  /* -------------------------------- lead --------------------------- */
  let lead: NormalizedLead | null = null;
  const wantsLead = mode === "leads" || mode === "leads_followups";
  if (wantsLead) {
    const customerName = get("customer_name");
    const phoneRaw = get("phone");
    const phoneNormalized = normalizePhone(phoneRaw);

    if (!customerName)
      errors.push(err(rowNumber, "customer_name", "required", "Customer name is required"));
    if (!phoneRaw) errors.push(err(rowNumber, "phone", "required", "Phone is required"));
    else if (!phoneNormalized)
      errors.push(
        err(rowNumber, "phone", "invalid_phone", `Phone "${phoneRaw}" has no usable digits`),
      );

    const emailRaw = get("email");
    let email: string | null = null;
    let emailNormalized: string | null = null;
    if (emailRaw) {
      if (EMAIL_RE.test(emailRaw)) {
        email = emailRaw;
        emailNormalized = normalizeEmail(emailRaw);
      } else {
        errors.push(err(rowNumber, "email", "invalid_email", `"${emailRaw}" is not a valid email`));
      }
    }

    let debtAmount = "0.00";
    const debtRaw = get("debt_amount");
    if (debtRaw) {
      const cleaned = debtRaw.replace(/[^0-9.-]/g, "");
      const n = Number(cleaned);
      if (cleaned === "" || !Number.isFinite(n) || n < 0) {
        errors.push(
          err(rowNumber, "debt_amount", "invalid_number", `"${debtRaw}" is not a valid amount`),
        );
      } else {
        debtAmount = n.toFixed(2);
      }
    }

    let currentDebts: "Current" | "Late" = "Current";
    const cd = get("current_debts");
    if (cd) {
      const match = CURRENT_DEBTS_VALUES.find((v) => v.toLowerCase() === cd.toLowerCase());
      if (!match)
        errors.push(
          err(rowNumber, "current_debts", "invalid_value", `"${cd}" must be Current or Late`),
        );
      else currentDebts = match;
    }

    let status: (typeof LEAD_STATUS_VALUES)[number] = "NEW";
    const st = get("status");
    if (st) {
      const match = LEAD_STATUS_VALUES.find((v) => v.toLowerCase() === st.toLowerCase());
      if (!match)
        errors.push(
          err(rowNumber, "status", "invalid_status", `"${st}" is not a valid Lead status`),
        );
      else status = match;
    }

    lead = {
      customerName,
      phone: phoneRaw,
      phoneNormalized: phoneNormalized ?? "",
      email,
      emailNormalized,
      address: get("address") || null,
      city: get("city") || null,
      state: get("state") || null,
      zip: get("zip") || null,
      debtAmount,
      creditStatus: get("credit_status") || null,
      currentDebts,
      comments: get("comments") || null,
      status,
      agentCode: (get("agent_code") || null)?.toUpperCase() ?? null,
      closerCode: (get("closer_code") || null)?.toUpperCase() ?? null,
      importRef,
    };
  }

  /* ------------------------------ follow-up ------------------------ */
  let followUp: NormalizedFollowUp | null = null;
  const dateRaw = get("followup_date");
  const timeRaw = get("followup_time");
  const anyFuFields =
    dateRaw ||
    timeRaw ||
    get("followup_comment") ||
    get("followup_owner_role") ||
    get("followup_closer_code");
  const wantsFollowUp =
    mode === "followups" || (mode === "leads_followups" && Boolean(anyFuFields));

  if (wantsFollowUp) {
    let ok = true;
    if (!dateRaw) {
      errors.push(err(rowNumber, "followup_date", "required", "Follow-up date is required"));
      ok = false;
    } else if (!isRealDate(dateRaw)) {
      errors.push(
        err(rowNumber, "followup_date", "invalid_date", `"${dateRaw}" is not YYYY-MM-DD`),
      );
      ok = false;
    }
    if (!timeRaw) {
      errors.push(err(rowNumber, "followup_time", "required", "Follow-up time is required"));
      ok = false;
    } else if (!isRealTime(timeRaw)) {
      errors.push(
        err(rowNumber, "followup_time", "invalid_time", `"${timeRaw}" is not a valid HH:MM`),
      );
      ok = false;
    }

    let ownerRole: "agent" | "closer" = "agent";
    const orRaw = get("followup_owner_role");
    if (orRaw) {
      const match = FOLLOWUP_OWNER_ROLES.find((v) => v === orRaw.toLowerCase());
      if (!match)
        errors.push(
          err(
            rowNumber,
            "followup_owner_role",
            "invalid_value",
            `"${orRaw}" must be agent or closer`,
          ),
        );
      else ownerRole = match;
    }

    const fuCloser = (get("followup_closer_code") || null)?.toUpperCase() ?? null;
    if (ownerRole === "closer" && !fuCloser) {
      errors.push(
        err(
          rowNumber,
          "followup_closer_code",
          "required",
          "A closer-owned follow-up needs a closer ID",
        ),
      );
    }

    const captureRaw = get("capture_date");
    if (captureRaw && !isRealDate(captureRaw)) {
      errors.push(
        err(rowNumber, "capture_date", "invalid_date", `"${captureRaw}" is not YYYY-MM-DD`),
      );
    }

    followUp = {
      scheduledDate: dateRaw,
      scheduledTime: timeRaw,
      scheduledAt: ok ? toScheduledWallClock(dateRaw, timeRaw) : "",
      comment: get("followup_comment") || null,
      ownerRole,
      closerCode: fuCloser,
      captureDate: captureRaw && isRealDate(captureRaw) ? captureRaw : null,
    };
  } else if (mode === "leads_followups" && !anyFuFields) {
    warnings.push(
      warn(rowNumber, null, "no_follow_up", "Row has no follow-up — importing the Lead only"),
    );
  }

  /* --------------------------- link reference --------------------- */
  const linkLeadCodeRaw = (get("lead_code") || "").toUpperCase();
  const linkLeadCode = linkLeadCodeRaw || null;
  if (linkLeadCode && !LEAD_CODE_RE.test(linkLeadCode)) {
    errors.push(
      err(
        rowNumber,
        "lead_code",
        "invalid_lead_code",
        `"${linkLeadCode}" is not a TMI_######## code`,
      ),
    );
  }
  const linkPhoneNormalized = mode === "followups" ? normalizePhone(get("phone")) : null;

  if (mode === "followups" && !linkLeadCode && !linkPhoneNormalized) {
    errors.push(
      err(
        rowNumber,
        "lead_code",
        "no_lead_reference",
        "A follow-up import row needs a Lead ID or a phone that matches an existing Lead",
      ),
    );
  }

  return {
    rowNumber,
    raw,
    lead,
    followUp,
    linkLeadCode: linkLeadCode && LEAD_CODE_RE.test(linkLeadCode) ? linkLeadCode : null,
    linkPhoneNormalized,
    importRef,
    errors,
    warnings,
  };
}
