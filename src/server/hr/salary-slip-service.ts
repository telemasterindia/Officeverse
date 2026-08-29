/**
 * Officeverse — Salary Slip service (Phase 14).
 *
 * A salary slip is a DOCUMENT + SEND layer over a Phase-13 payroll_run. It
 * never recalculates salary, never touches attendance / leave / Off / bonus
 * engines — every figure is a snapshot of the APPROVED / LOCKED payroll_run
 * captured at generation time and frozen on the salary_slips row.
 *
 * DOCUMENT GENERATION and EMAIL SEND are separate: generation is idempotent per
 * payroll snapshot (a reopened + recalculated payroll yields a NEW version, the
 * old row/document is untouched); sending appends a controlled send-event and
 * is only marked SENT after the provider confirms.
 *
 * No Closer-reward field, amount or logic exists anywhere here.
 */
import { getDb, isDbConfigured } from "@/lib/db";
import { recordAudit, type AuditActorRole } from "../audit";
import { HttpError } from "../http-error";
import { config } from "../env";
import { assertCanManagePayroll, canManagePayroll, type HrRole } from "../authz/hr";
import { nowIST } from "../time";
import { getUserById } from "../db/repos/users";
import { getEmailProvider } from "../email/provider";
import {
  buildSlipSnapshot,
  salarySlipEligibility,
  sanitizeSlipFilename,
  slipSnapshotEquals,
  type SlipSnapshot,
} from "./salary-slip";
import { renderSalarySlipPdf, sha256Hex } from "./salary-slip-pdf";
import { buildSalarySlipEmail } from "./salary-slip-email";
import { getSalarySlipStore, salarySlipStorageKey } from "./salary-slip-storage";
import * as payrollRepo from "../db/repos/payroll";
import * as repo from "../db/repos/salary-slip";
import type { NewSalarySlip, PayrollRun, SalarySlip, User } from "@/lib/db/schema";

type Meta = { ip?: string | null; userAgent?: string | null };

/** Who is acting — a real Admin/HR user, or the "system" (cron) principal. */
export interface SlipActorCtx {
  actorUserId: number | null;
  actorRole: AuditActorRole;
}
function ctxOf(actor: Pick<User, "id" | "role">): SlipActorCtx {
  return { actorUserId: actor.id, actorRole: actor.role as AuditActorRole };
}

/* ------------------------------- DTO -------------------------- */

export interface SalarySlipDTO {
  id: number;
  payrollRunId: number;
  userId: number;
  employeeName: string;
  process: string;
  month: string;
  version: number;
  status: string;
  isPreview: boolean;
  baseSalary: string;
  regularityBonus: number;
  calculatedSalary: string;
  leaveCount: number;
  offCount: number;
  payrollStatusAtGeneration: string;
  calculationVersion: string;
  fileName: string;
  byteSize: number;
  sendCount: number;
  lastSentAt: string | null;
  lastError: string | null;
  generatedAt: string;
}

function slipDTO(s: SalarySlip): SalarySlipDTO {
  return {
    id: s.id,
    payrollRunId: s.payrollRunId,
    userId: s.userId,
    employeeName: s.employeeName,
    process: s.process,
    month: s.periodMonth,
    version: s.version,
    status: s.status,
    isPreview: s.isPreview,
    baseSalary: s.baseSalary,
    regularityBonus: s.regularityBonus,
    calculatedSalary: s.calculatedSalary,
    leaveCount: s.leaveCount,
    offCount: s.offCount,
    payrollStatusAtGeneration: s.payrollStatusAtGeneration,
    calculationVersion: s.calculationVersion,
    fileName: s.fileName,
    byteSize: s.byteSize,
    sendCount: s.sendCount,
    lastSentAt: s.lastSentAt ?? null,
    lastError: s.lastError ?? null,
    generatedAt: s.generatedAt,
  };
}

/* --------------------------- rendering ----------------------- */

function renderBytesFor(slip: {
  employeeName: string;
  userId: number;
  process: string;
  periodMonth: string;
  baseSalary: string;
  regularityBonus: number;
  calculatedSalary: string;
  leaveCount: number;
  offCount: number;
  payrollStatusAtGeneration: string;
  calculationVersion: string;
  version: number;
  isPreview: boolean;
  generatedAt: string;
}): Uint8Array {
  return renderSalarySlipPdf({
    employeeName: slip.employeeName,
    userId: slip.userId,
    process: slip.process,
    periodMonth: slip.periodMonth,
    baseSalary: slip.baseSalary,
    regularityBonus: slip.regularityBonus,
    calculatedSalary: slip.calculatedSalary,
    leaveCount: slip.leaveCount,
    offCount: slip.offCount,
    payrollStatus: slip.payrollStatusAtGeneration,
    calculationVersion: slip.calculationVersion,
    slipVersion: slip.version,
    isPreview: slip.isPreview,
    generatedAt: slip.generatedAt,
  });
}

/* --------------------------- generate ----------------------- */

export interface GenerateInput {
  payrollRunId: number;
  allowPreview?: boolean | undefined;
}

export async function generateSalarySlip(
  actor: Pick<User, "id" | "role">,
  input: GenerateInput,
  meta: Meta = {},
): Promise<{ ok: true; slip: SalarySlipDTO; reused: boolean }> {
  assertCanManagePayroll(actor.role as HrRole);
  return generateSlipForRun(ctxOf(actor), input, meta);
}

/**
 * Generate (or reuse) a salary slip for a payroll run — authorization-free core
 * shared by the Admin/HR endpoint and the monthly batch. Callers MUST gate
 * access before calling this.
 */
export async function generateSlipForRun(
  ctx: SlipActorCtx,
  input: GenerateInput,
  meta: Meta = {},
): Promise<{ ok: true; slip: SalarySlipDTO; reused: boolean }> {
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();

  const run = await payrollRepo.getPayrollRunById(input.payrollRunId, db);
  if (!run) throw new HttpError(404, "Payroll run not found", "not_found");

  const elig = salarySlipEligibility(run.status as PayrollRun["status"], {
    allowPreview: input.allowPreview ?? false,
  });
  if (!elig.ok) throw new HttpError(409, elig.reason, "payroll_not_final");

  const emp = await getUserById(run.userId);
  if (!emp) throw new HttpError(404, "Employee not found", "not_found");

  const snapshot: SlipSnapshot = buildSlipSnapshot(run);
  const latest = await repo.latestSalarySlipForRun(run.id, db);

  // idempotent: identical figures + same preview flag → return the existing doc
  if (
    latest &&
    latest.isPreview === elig.isPreview &&
    slipSnapshotEquals(
      buildSlipSnapshot({ ...latest, status: latest.payrollStatusAtGeneration }),
      snapshot,
    )
  ) {
    return { ok: true, slip: slipDTO(latest), reused: true };
  }

  const version = (latest?.version ?? 0) + 1;
  const now = nowIST();
  const fileName = sanitizeSlipFilename(run.periodMonth, emp.fullName, emp.id, elig.isPreview);
  const storageKey = salarySlipStorageKey(emp.id, run.periodMonth, version);

  const bytes = renderBytesFor({
    employeeName: emp.fullName,
    userId: emp.id,
    process: run.process,
    periodMonth: run.periodMonth,
    baseSalary: snapshot.baseSalary,
    regularityBonus: snapshot.regularityBonus,
    calculatedSalary: snapshot.calculatedSalary,
    leaveCount: snapshot.leaveCount,
    offCount: snapshot.offCount,
    payrollStatusAtGeneration: snapshot.payrollStatusAtGeneration,
    calculationVersion: snapshot.calculationVersion,
    version,
    isPreview: elig.isPreview,
    generatedAt: now,
  });
  await getSalarySlipStore().put(storageKey, bytes);

  const v: NewSalarySlip = {
    payrollRunId: run.id,
    userId: emp.id,
    periodMonth: run.periodMonth,
    version,
    status: "GENERATED",
    isPreview: elig.isPreview,
    employeeName: emp.fullName,
    employeeEmail: emp.email,
    process: run.process,
    baseSalary: snapshot.baseSalary,
    regularityBonus: snapshot.regularityBonus,
    calculatedSalary: snapshot.calculatedSalary,
    leaveCount: snapshot.leaveCount,
    offCount: snapshot.offCount,
    payrollStatusAtGeneration: snapshot.payrollStatusAtGeneration,
    calculationVersion: snapshot.calculationVersion,
    fileName,
    storageKey,
    contentSha256: sha256Hex(bytes),
    byteSize: bytes.length,
    sendCount: 0,
    generatedByUserId: ctx.actorUserId,
    generatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const id = await repo.insertSalarySlip(v, db);

  await recordAudit({
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: "salary_slip.generate",
    entityType: "salary_slip",
    entityId: id,
    metadata: {
      payrollRunId: run.id,
      employee: emp.id,
      period: run.periodMonth,
      version,
      isPreview: elig.isPreview,
      payrollStatus: run.status,
      calculatedSalary: snapshot.calculatedSalary,
      contentSha256: v.contentSha256,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  const saved = await repo.getSalarySlipById(id, db);
  return { ok: true, slip: slipDTO(saved!), reused: false };
}

/* ----------------------------- send ------------------------- */

function regenerateSlipBytes(slip: SalarySlip): Uint8Array {
  return renderBytesFor({
    employeeName: slip.employeeName,
    userId: slip.userId,
    process: slip.process,
    periodMonth: slip.periodMonth,
    baseSalary: slip.baseSalary,
    regularityBonus: slip.regularityBonus,
    calculatedSalary: slip.calculatedSalary,
    leaveCount: slip.leaveCount,
    offCount: slip.offCount,
    payrollStatusAtGeneration: slip.payrollStatusAtGeneration,
    calculationVersion: slip.calculationVersion,
    version: slip.version,
    isPreview: slip.isPreview,
    generatedAt: slip.generatedAt,
  });
}

/**
 * Load the exact PDF bytes for a slip:
 *   1. read from durable storage
 *   2. verify SHA-256 against the immutable `content_sha256`
 *   3. if missing or corrupt, regenerate deterministically from the snapshot,
 *      verify the regenerated SHA, restore the durable file, audit it
 *   4. never trust a client value — `storageKey` + snapshot come from the row
 */
async function bytesForSlip(
  slip: SalarySlip,
  actor?: SlipActorCtx,
  meta: Meta = {},
): Promise<Uint8Array> {
  const store = getSalarySlipStore();
  let reason: "missing" | "corrupt" | null = null;

  const existing = await store.get(slip.storageKey).catch(() => null);
  if (existing) {
    if (sha256Hex(existing) === slip.contentSha256) return existing;
    reason = "corrupt";
  } else {
    reason = "missing";
  }

  const regenerated = regenerateSlipBytes(slip);
  if (sha256Hex(regenerated) !== slip.contentSha256) {
    throw new HttpError(
      500,
      "Salary-slip document integrity check failed",
      "slip_integrity_failed",
    );
  }
  await store.put(slip.storageKey, regenerated).catch(() => undefined);

  if (actor) {
    await recordAudit({
      actorUserId: actor.actorUserId,
      actorRole: actor.actorRole,
      action: "salary_slip.storage_regenerated",
      entityType: "salary_slip",
      entityId: slip.id,
      metadata: {
        period: slip.periodMonth,
        version: slip.version,
        reason,
        storageProvider: store.kind,
      },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
  }
  return regenerated;
}

export async function sendSalarySlip(
  actor: Pick<User, "id" | "role">,
  input: { salarySlipId: number },
  meta: Meta = {},
): Promise<{ ok: true; slip: SalarySlipDTO }> {
  assertCanManagePayroll(actor.role as HrRole);
  const res = await sendSlipById(ctxOf(actor), { salarySlipId: input.salarySlipId }, meta);
  if (res.status === "NO_PROVIDER") {
    throw new HttpError(503, "No email provider is configured", "no_provider");
  }
  if (res.status === "NO_RECIPIENT") {
    throw new HttpError(422, "Employee has no valid email address on record", "no_recipient");
  }
  if (res.status === "FAILED") {
    throw new HttpError(502, "Email delivery failed — you can retry", "send_failed");
  }
  return { ok: true, slip: res.slip! };
}

export type SlipSendStatus = "SENT" | "FAILED" | "NO_PROVIDER" | "NO_RECIPIENT";
export interface SlipSendResult {
  status: SlipSendStatus;
  slip?: SalarySlipDTO;
  error?: string;
  attemptNo?: number;
  providerName?: string;
}

/**
 * Send one salary slip. Authorization-free core — callers gate first. Never
 * throws for a provider / recipient problem (returns a status the batch can act
 * on); only 404 / DB errors throw. A send is recorded SENT only after the
 * provider confirms; a failure records FAILED and leaves the document intact.
 */
export async function sendSlipById(
  ctx: SlipActorCtx,
  input: { salarySlipId: number; auto?: boolean },
  meta: Meta = {},
): Promise<SlipSendResult> {
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const db = getDb();
  const auto = input.auto === true;
  const sentAction = auto ? "salary_slip.auto_send" : "salary_slip.send";
  const failedAction = auto ? "salary_slip.auto_send_failed" : "salary_slip.send_failed";

  const slip = await repo.getSalarySlipById(input.salarySlipId, db);
  if (!slip) throw new HttpError(404, "Salary slip not found", "not_found");

  // recipient is ALWAYS the authoritative user record — never client-supplied
  const emp = await getUserById(slip.userId);
  const recipient = emp?.email?.trim().toLowerCase() ?? "";
  if (!emp || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return { status: "NO_RECIPIENT" };
  }

  const provider = getEmailProvider();
  if (!provider) {
    return { status: "NO_PROVIDER" };
  }

  const bytes = await bytesForSlip(slip, ctx, meta);
  const email = buildSalarySlipEmail({
    employeeName: emp.fullName,
    periodMonth: slip.periodMonth,
    isPreview: slip.isPreview,
    fileName: slip.fileName,
  });
  const priorSends = await repo.listSalarySlipSends(slip.id, db);
  const attemptNo = priorSends.length + 1;
  const now = nowIST();

  try {
    const result = await provider.send({
      to: recipient,
      toName: emp.fullName,
      from: config.emailFrom(),
      subject: email.subject,
      text: email.text,
      html: email.html,
      attachments: [
        {
          filename: slip.fileName,
          contentBase64: Buffer.from(bytes).toString("base64"),
          contentType: "application/pdf",
        },
      ],
    });

    await repo.insertSalarySlipSend(
      {
        salarySlipId: slip.id,
        attemptNo,
        status: "SENT",
        recipientEmail: recipient,
        provider: provider.name,
        providerMessageId: result.providerMessageId ?? null,
        sentByUserId: ctx.actorUserId,
        createdAt: now,
      },
      db,
    );
    await repo.updateSalarySlip(
      slip.id,
      {
        status: "SENT",
        sendCount: slip.sendCount + 1,
        lastSentAt: now,
        lastError: null,
        updatedAt: now,
      },
      db,
    );
    await recordAudit({
      actorUserId: ctx.actorUserId,
      actorRole: ctx.actorRole,
      action: sentAction,
      entityType: "salary_slip",
      entityId: slip.id,
      metadata: {
        payrollRunId: slip.payrollRunId,
        employee: slip.userId,
        period: slip.periodMonth,
        attemptNo,
        result: "SENT",
        provider: provider.name,
      },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 490) : "unknown send error";
    await repo.insertSalarySlipSend(
      {
        salarySlipId: slip.id,
        attemptNo,
        status: "FAILED",
        recipientEmail: recipient,
        provider: provider.name,
        errorMessage: message,
        sentByUserId: ctx.actorUserId,
        createdAt: now,
      },
      db,
    );
    await repo.updateSalarySlip(
      slip.id,
      { status: "FAILED", lastError: message, updatedAt: now },
      db,
    );
    await recordAudit({
      actorUserId: ctx.actorUserId,
      actorRole: ctx.actorRole,
      action: failedAction,
      entityType: "salary_slip",
      entityId: slip.id,
      metadata: {
        payrollRunId: slip.payrollRunId,
        employee: slip.userId,
        period: slip.periodMonth,
        attemptNo,
        result: "FAILED",
      },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    return { status: "FAILED", error: message, attemptNo, providerName: provider.name };
  }

  const saved = await repo.getSalarySlipById(slip.id, db);
  return { status: "SENT", slip: slipDTO(saved!), attemptNo, providerName: provider.name };
}

/* ----------------------------- reads ----------------------- */

export async function listSalarySlips(
  actor: Pick<User, "role">,
  f: repo.SalarySlipFilter,
): Promise<{ dbUnavailable?: boolean; rows: SalarySlipDTO[] }> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = await repo.listSalarySlips(f);
  return { rows: rows.map(slipDTO) };
}

export interface SendHistoryRow {
  attemptNo: number;
  status: string;
  recipientEmail: string;
  provider: string | null;
  providerMessageId: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export async function salarySlipHistory(
  actor: Pick<User, "role">,
  salarySlipId: number,
): Promise<{ dbUnavailable?: boolean; slip: SalarySlipDTO | null; sends: SendHistoryRow[] }> {
  assertCanManagePayroll(actor.role as HrRole);
  if (!isDbConfigured()) return { dbUnavailable: true, slip: null, sends: [] };
  const slip = await repo.getSalarySlipById(salarySlipId);
  if (!slip) throw new HttpError(404, "Salary slip not found", "not_found");
  const sends = await repo.listSalarySlipSends(salarySlipId);
  return {
    slip: slipDTO(slip),
    sends: sends.map((s) => ({
      attemptNo: s.attemptNo,
      status: s.status,
      recipientEmail: s.recipientEmail,
      provider: s.provider ?? null,
      providerMessageId: s.providerMessageId ?? null,
      errorMessage: s.errorMessage ?? null,
      createdAt: s.createdAt,
    })),
  };
}

export async function mySalarySlips(
  user: Pick<User, "id">,
  month: string | undefined,
): Promise<{ dbUnavailable?: boolean; rows: SalarySlipDTO[] }> {
  if (!isDbConfigured()) return { dbUnavailable: true, rows: [] };
  const rows = month
    ? await repo.listSalarySlipsForUser(user.id, month, month)
    : await repo.listSalarySlipsForUser(user.id);
  return { rows: rows.map(slipDTO) };
}

/** Download the PDF. Own slip, or any slip for Admin/HR. */
export async function downloadSalarySlip(
  actor: Pick<User, "id" | "role">,
  salarySlipId: number,
  meta: Meta = {},
): Promise<{ fileName: string; contentType: string; contentBase64: string }> {
  if (!isDbConfigured()) throw new HttpError(503, "Database not configured", "db_unavailable");
  const slip = await repo.getSalarySlipById(salarySlipId);
  if (!slip) throw new HttpError(404, "Salary slip not found", "not_found");

  const isOwner = slip.userId === actor.id;
  if (!isOwner && !canManagePayroll(actor.role as HrRole)) {
    throw new HttpError(403, "You can only access your own salary slip", "forbidden");
  }

  const bytes = await bytesForSlip(slip, ctxOf(actor), meta);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "salary_slip.download",
    entityType: "salary_slip",
    entityId: slip.id,
    metadata: { period: slip.periodMonth, self: isOwner },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return {
    fileName: slip.fileName,
    contentType: "application/pdf",
    contentBase64: Buffer.from(bytes).toString("base64"),
  };
}
