/**
 * Officeverse — bulk-import service (Phase 7).
 *
 * Orchestrates: normalise (pure) → build lookup context (repos) → plan (pure)
 * → PREVIEW (read-only) or COMMIT (per-group transactions). Reuses the existing
 * Lead / Follow-up repositories — it never calls the Lead/Follow-up *services*,
 * so the Phase-5 per-event notification/email integration is NOT triggered per
 * row. One "import completed" notification is sent to the importer at the end.
 *
 * TRANSACTION MODEL: each Lead + its Follow-up(s) commit in ONE transaction.
 * The file as a whole is NOT atomic — valid groups commit, invalid rows are
 * rejected and reported.
 */
import { recordAudit } from "../audit";
import { assertCanBulkImport } from "../authz/import";
import { createNotification } from "../notifications/service";
import { currentShiftDate, nowIST } from "../time";
import { normalizeRow, type NormalizedRow } from "./normalize-row";
import { planImport, type PlanContext, type ImportPlan } from "./plan";
import * as importRepo from "../db/repos/import";
import * as leadsRepo from "../db/repos/leads";
import * as followupsRepo from "../db/repos/followups";
import {
  getAgentByUserId,
  loadAgentsByCodes,
  loadAgentUserIds,
  loadClosersByCodes,
} from "../db/repos/staff";
import { getDb } from "@/lib/db";
import type { NewFollowUp, NewImportRow, NewImportError, NewLead, User } from "@/lib/db/schema";
import type { CommitResult, PreviewResult, RowIssue } from "@/lib/officeverse/import/types";
import type { PreviewImportInput } from "../validation/import";

type Meta = { ip?: string | null; userAgent?: string | null };

const PREVIEW_ROW_CAP = 500;
const ISSUE_CAP = 2000;

function importType(mode: PreviewImportInput["mode"]): "leads" | "follow_ups" | "workbook" {
  if (mode === "leads") return "leads";
  if (mode === "followups") return "follow_ups";
  return "workbook";
}

/* ---------------------- normalise + context + plan ------------------- */

function normalizeAll(input: PreviewImportInput): NormalizedRow[] {
  return input.rows.map((raw, i) =>
    // spreadsheet row number: header is row 1, data starts at row 2
    normalizeRow(raw, input.mapping, input.mode, i + 2),
  );
}

async function buildContext(
  user: User,
  rows: NormalizedRow[],
  mode: PreviewImportInput["mode"],
): Promise<PlanContext> {
  const role = user.role;
  let agentId: number | null = null;
  let agentCode: string | null = null;
  if (role === "agent") {
    const a = await getAgentByUserId(user.id);
    agentId = a?.id ?? null;
    agentCode = a?.agentCode ?? null;
  }

  const phones = new Set<string>();
  const leadCodes = new Set<string>();
  const agentCodes = new Set<string>();
  const closerCodes = new Set<string>();
  for (const r of rows) {
    if (r.lead?.phoneNormalized) phones.add(r.lead.phoneNormalized);
    if (r.linkPhoneNormalized) phones.add(r.linkPhoneNormalized);
    if (r.linkLeadCode) leadCodes.add(r.linkLeadCode);
    if (r.lead?.agentCode) agentCodes.add(r.lead.agentCode);
    if (r.lead?.closerCode) closerCodes.add(r.lead.closerCode);
    if (r.followUp?.closerCode) closerCodes.add(r.followUp.closerCode);
  }

  const [byPhone, byCode, agentByCode, closerByCode] = await Promise.all([
    importRepo.findLeadsByPhones([...phones]),
    importRepo.findLeadsByCodes([...leadCodes]),
    loadAgentsByCodes([...agentCodes]),
    loadClosersByCodes([...closerCodes]),
  ]);

  const allAgentIds = [...byPhone, ...byCode]
    .map((l) => l.agentId)
    .filter((n): n is number => n != null);
  const agentUserIds = await loadAgentUserIds(allAgentIds);

  const existingLeadByPhone = new Map<
    string,
    { id: number; code: string; agentId: number | null; agentUserId: number | null }
  >();
  const existingLeadByCode = new Map<
    string,
    { id: number; code: string; agentId: number | null; agentUserId: number | null }
  >();
  for (const l of byPhone) {
    if (l.phoneNormalized) {
      existingLeadByPhone.set(l.phoneNormalized, {
        id: l.id,
        code: l.code,
        agentId: l.agentId,
        agentUserId: l.agentId != null ? (agentUserIds.get(l.agentId) ?? null) : null,
      });
    }
  }
  for (const l of byCode) {
    existingLeadByCode.set(l.code, {
      id: l.id,
      code: l.code,
      agentId: l.agentId,
      agentUserId: l.agentId != null ? (agentUserIds.get(l.agentId) ?? null) : null,
    });
  }

  return {
    actor: { role, userId: user.id, agentId, agentCode },
    mode,
    existingLeadByPhone,
    existingLeadByCode,
    agentByCode,
    closerByCode,
  };
}

/* --------------------------------- preview -------------------------- */

export async function previewImport(user: User, input: PreviewImportInput): Promise<PreviewResult> {
  assertCanBulkImport({ role: user.role });
  const rows = normalizeAll(input);
  const ctx = await buildContext(user, rows, input.mode);
  const plan = planImport(rows, ctx);

  const ordered = [...plan.rowSummaries].sort((a, b) => {
    const ax = a.decision === "error" ? 0 : 1;
    const bx = b.decision === "error" ? 0 : 1;
    return ax - bx || a.rowNumber - b.rowNumber;
  });

  return {
    fileName: input.fileName,
    mode: input.mode,
    counts: plan.counts,
    rows: ordered.slice(0, PREVIEW_ROW_CAP),
    issues: plan.issues.slice(0, ISSUE_CAP),
    truncated: ordered.length > PREVIEW_ROW_CAP || plan.issues.length > ISSUE_CAP,
    canCommit: plan.canCommit,
  };
}

/* --------------------------------- commit -------------------------- */

interface GroupBucket {
  key: string;
  leadPlan: ImportPlan["leads"][number] | null;
  followUps: ImportPlan["followUps"];
  rowNumbers: number[];
}

export async function commitImport(
  user: User,
  input: PreviewImportInput,
  meta: Meta = {},
): Promise<CommitResult> {
  assertCanBulkImport({ role: user.role });

  const rows = normalizeAll(input);
  const ctx = await buildContext(user, rows, input.mode);
  const plan = planImport(rows, ctx);

  // snapshots for follow-up-only imports
  const [byPhone, byCode] = await Promise.all([
    importRepo.findLeadsByPhones(
      rows.map((r) => r.linkPhoneNormalized).filter((p): p is string => Boolean(p)),
    ),
    importRepo.findLeadsByCodes(
      rows.map((r) => r.linkLeadCode).filter((c): c is string => Boolean(c)),
    ),
  ]);
  const leadSnapshotById = new Map<number, importRepo.ExistingLeadRow>();
  for (const l of [...byPhone, ...byCode]) leadSnapshotById.set(l.id, l);

  const now = nowIST();
  const batch = await importRepo.createImportBatch({
    filename: input.fileName.slice(0, 255),
    type: importType(input.mode),
    uploadedByUserId: user.id,
    status: "committing",
    columnMapping: input.mapping,
    totalRows: rows.length,
    validRows: plan.counts.validRows,
    invalidRows: plan.counts.invalidRows,
    createdAt: now,
    updatedAt: now,
  });

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "import.start",
    entityType: "import",
    entityId: batch.id,
    metadata: { mode: input.mode, file: input.fileName, total_rows: rows.length },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  // ---- bucket rows by group ----
  const buckets = new Map<string, GroupBucket>();
  const standaloneFu: ImportPlan["followUps"] = [];
  for (const lp of plan.leads) {
    const b = buckets.get(lp.groupKey) ?? {
      key: lp.groupKey,
      leadPlan: null,
      followUps: [],
      rowNumbers: [],
    };
    if (!b.leadPlan || lp.decision !== "duplicate") b.leadPlan = lp;
    b.rowNumbers.push(lp.sourceRowNumber);
    buckets.set(lp.groupKey, b);
  }
  for (const fp of plan.followUps) {
    if (fp.groupKey && buckets.has(fp.groupKey)) {
      buckets.get(fp.groupKey)!.followUps.push(fp);
    } else if (fp.groupKey) {
      const b = {
        key: fp.groupKey,
        leadPlan: null,
        followUps: [fp],
        rowNumbers: [fp.rowNumber],
      } as GroupBucket;
      buckets.set(fp.groupKey, b);
    } else {
      standaloneFu.push(fp);
    }
  }

  let leadsCreated = 0;
  let leadsSkippedExisting = 0;
  let leadsRejected = 0;
  let followUpsCreated = 0;
  let followUpsSkipped = 0;
  const importRowRecords: NewImportRow[] = [];
  const importErrorRecords: NewImportError[] = [];
  const errorReport: RowIssue[] = [];

  const pushErr = (rowNumber: number, issues: RowIssue[]) => {
    for (const i of issues) {
      if (i.severity !== "error") continue;
      errorReport.push(i);
      importErrorRecords.push({
        importId: batch.id,
        rowNumber,
        field: i.field ?? null,
        value: null,
        code: i.code.slice(0, 60),
        message: i.message.slice(0, 500),
        createdAt: nowIST(),
      });
    }
  };

  for (const bucket of buckets.values()) {
    try {
      await getDb().transaction(async (tx) => {
        let leadId: number | null = null;
        let leadCode: string | null = null;
        const lp = bucket.leadPlan;

        if (lp && lp.draft && lp.decision === "new") {
          const created = await insertLeadFromPlan(tx, user, lp, batch.id, importType(input.mode));
          leadId = created.id;
          leadCode = created.leadCode;
          leadsCreated++;
        } else if (lp && lp.decision === "existing") {
          leadId = lp.existingLeadId;
          leadCode = lp.existingLeadCode;
          leadsSkippedExisting++;
        } else if (lp && lp.decision === "duplicate") {
          // resolved against an already-handled group / existing lead
          const existing =
            plan.leads.find((x) => x.groupKey === bucket.key && x.decision !== "duplicate") ?? null;
          leadId = existing?.existingLeadId ?? null;
          leadCode = existing?.existingLeadCode ?? null;
        } else if (lp && lp.decision === "error") {
          leadsRejected++;
          pushErr(lp.sourceRowNumber, lp.issues);
        }

        for (const fp of bucket.followUps) {
          if (fp.decision === "error") {
            followUpsSkipped++;
            pushErr(fp.rowNumber, fp.issues);
            continue;
          }
          const targetLeadId = fp.linkExistingLeadId ?? leadId;
          if (targetLeadId == null || fp.resolvedOwnerUserId == null) {
            followUpsSkipped++;
            pushErr(fp.rowNumber, [
              {
                rowNumber: fp.rowNumber,
                field: null,
                code: "orphan_follow_up",
                message: "Could not resolve the Lead or owner for this follow-up",
                severity: "error",
              },
            ]);
            continue;
          }
          const snap = leadSnapshotById.get(targetLeadId) ?? null;
          const fuCode = await insertFollowUpFromPlan(
            tx,
            user,
            fp,
            targetLeadId,
            lp?.draft ?? null,
            snap,
            batch.id,
          );
          followUpsCreated++;
          importRowRecords.push({
            importId: batch.id,
            rowNumber: fp.rowNumber,
            raw: rows.find((r) => r.rowNumber === fp.rowNumber)?.raw ?? {},
            parsed: { scheduledAt: fp.draft?.scheduledAt ?? null, ownerRole: fp.ownerRole },
            decision: "new",
            targetEntityType: "follow_up",
            targetEntityCode: fuCode,
            committed: true,
          });
        }

        if (lp && leadCode && lp.decision !== "error") {
          importRowRecords.push({
            importId: batch.id,
            rowNumber: lp.sourceRowNumber,
            raw: rows.find((r) => r.rowNumber === lp.sourceRowNumber)?.raw ?? {},
            parsed: { phone: lp.draft?.phoneNormalized ?? null },
            decision:
              lp.decision === "new" ? "new" : lp.decision === "existing" ? "skip" : "duplicate",
            targetEntityType: "lead",
            targetEntityCode: leadCode,
            committed: lp.decision === "new",
          });
        }
      });
    } catch (e) {
      // whole group rolled back — mark its rows errored, keep going
      for (const rn of bucket.rowNumbers) {
        const issue: RowIssue = {
          rowNumber: rn,
          field: null,
          code: "commit_failed",
          message: e instanceof Error ? e.message.slice(0, 300) : "Row group failed to commit",
          severity: "error",
        };
        errorReport.push(issue);
        importErrorRecords.push({
          importId: batch.id,
          rowNumber: rn,
          field: null,
          value: null,
          code: "commit_failed",
          message: issue.message,
          createdAt: nowIST(),
        });
      }
      if (bucket.leadPlan?.decision === "new") leadsRejected++;
    }
  }

  for (const fp of standaloneFu) {
    followUpsSkipped++;
    pushErr(fp.rowNumber, [
      {
        rowNumber: fp.rowNumber,
        field: null,
        code: "orphan_follow_up",
        message: "Follow-up could not be linked to any Lead",
        severity: "error",
      },
    ]);
  }

  // record rejected-row errors that were never in a committed bucket
  for (const s of plan.rowSummaries) {
    if (s.decision === "error")
      pushErr(
        s.rowNumber,
        s.issues.filter((i) => i.severity === "error"),
      );
  }

  await importRepo.insertImportRows(importRowRecords);
  await importRepo.insertImportErrors(importErrorRecords);

  const errorCount = errorReport.length;
  const done = nowIST();
  await importRepo.updateImportBatch(batch.id, {
    status: "committed",
    newRows: leadsCreated,
    updateRows: 0,
    duplicateRows: plan.counts.duplicateRows,
    skippedRows: leadsSkippedExisting,
    errorRows: plan.counts.invalidRows,
    successCount: leadsCreated + followUpsCreated,
    errorCount,
    committedAt: done,
    updatedAt: done,
  });

  await recordAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "import.commit",
    entityType: "import",
    entityId: batch.id,
    metadata: {
      mode: input.mode,
      file: input.fileName,
      leads_created: leadsCreated,
      leads_existing: leadsSkippedExisting,
      leads_rejected: leadsRejected,
      followups_created: followUpsCreated,
      followups_skipped: followUpsSkipped,
      duplicates: plan.counts.duplicateRows,
      errors: errorCount,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  // ONE notification to the importer — never per row.
  await createNotification({
    recipientUserId: user.id,
    type: "import.completed",
    title: `Import finished — ${input.fileName}`,
    message: `${leadsCreated} lead(s) and ${followUpsCreated} follow-up(s) created${
      errorCount ? `, ${errorCount} error(s)` : ""
    }.`,
    relatedEntityType: "import",
    relatedEntityId: batch.id,
    dedupeKey: `import:${batch.id}:completed`,
    metadata: {
      leads_created: leadsCreated,
      followups_created: followUpsCreated,
      errors: errorCount,
    },
  });

  return {
    importId: batch.id,
    fileName: input.fileName,
    mode: input.mode,
    status: "committed",
    rowsProcessed: rows.length,
    leadsCreated,
    leadsSkippedExisting,
    leadsRejected,
    followUpsCreated,
    followUpsSkipped,
    duplicates: plan.counts.duplicateRows,
    errors: errorCount,
    warnings: plan.issues.filter((i) => i.severity === "warning").length,
    errorReport: errorReport.slice(0, ISSUE_CAP),
  };
}

/* ---------------------------- row inserters ------------------------- */

async function insertLeadFromPlan(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  user: User,
  lp: ImportPlan["leads"][number],
  importId: number,
  _type: "leads" | "follow_ups" | "workbook",
): Promise<{ id: number; leadCode: string }> {
  const d = lp.draft!;
  const now = nowIST();
  const base: Omit<NewLead, "leadCode"> = {
    shiftDate: currentShiftDate(user.process),
    customerName: d.customerName,
    phone: d.phone,
    phoneNormalized: d.phoneNormalized || null,
    email: d.email,
    emailNormalized: d.emailNormalized,
    address: d.address,
    city: d.city,
    state: d.state,
    zip: d.zip,
    debtAmount: d.debtAmount,
    creditStatus: d.creditStatus,
    currentDebts: d.currentDebts,
    leadFile: null,
    comments: d.comments,
    agentId: lp.resolvedAgentId,
    assignedCloserId: lp.resolvedCloserId,
    status: lp.resolvedCloserId != null && d.status === "NEW" ? "ASSIGNED" : d.status,
    source: "import",
    importId,
    createdAt: now,
    updatedAt: now,
  };
  let row: Awaited<ReturnType<typeof leadsRepo.insertLead>> | undefined;
  for (let a = 0; a < 3 && !row; a++) {
    const leadCode = await leadsRepo.nextLeadCode(tx);
    try {
      row = await leadsRepo.insertLead({ ...base, leadCode }, tx);
    } catch (err) {
      if (a === 2 || !/duplicate entry|leads_code_uq/i.test(String(err))) throw err;
    }
  }
  if (!row) throw new Error("Could not allocate a Lead ID");

  if (lp.resolvedCloserId != null) {
    await leadsRepo.insertAssignment(
      {
        leadId: row.id,
        fromCloserId: null,
        toCloserId: lp.resolvedCloserId,
        action: "assign",
        byUserId: user.id,
        note: "Bulk import",
        createdAt: now,
      },
      tx,
    );
  }
  return { id: row.id, leadCode: row.leadCode };
}

async function insertFollowUpFromPlan(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  user: User,
  fp: ImportPlan["followUps"][number],
  leadId: number,
  leadDraft: ImportPlan["leads"][number]["draft"],
  snapshot: importRepo.ExistingLeadRow | null,
  importId: number,
): Promise<string> {
  const d = fp.draft!;
  const now = nowIST();
  const name = leadDraft?.customerName ?? snapshot?.customerName ?? "Imported customer";
  const phone = leadDraft?.phone ?? snapshot?.phone ?? "";
  const base: Omit<NewFollowUp, "followUpCode"> = {
    ownerUserId: fp.resolvedOwnerUserId!,
    ownerRole: fp.ownerRole,
    customerName: name,
    phone,
    phoneNormalized: leadDraft?.phoneNormalized ?? snapshot?.phoneNormalized ?? null,
    email: leadDraft?.email ?? snapshot?.email ?? null,
    emailNormalized: leadDraft?.emailNormalized ?? snapshot?.emailNormalized ?? null,
    address: leadDraft?.address ?? snapshot?.address ?? null,
    city: leadDraft?.city ?? snapshot?.city ?? null,
    state: leadDraft?.state ?? snapshot?.state ?? null,
    zip: leadDraft?.zip ?? snapshot?.zip ?? null,
    debtAmount: leadDraft?.debtAmount ?? snapshot?.debtAmount ?? "0.00",
    creditStatus: leadDraft?.creditStatus ?? snapshot?.creditStatus ?? null,
    currentDebts: leadDraft?.currentDebts ?? snapshot?.currentDebts ?? null,
    captureDate: fp.captureDate ?? currentShiftDate(user.process),
    scheduledAt: d.scheduledAt,
    scheduledTz: "+05:30",
    comment: d.comment,
    status: "SCHEDULED",
    leadId,
    createdByUserId: user.id,
    source: "import",
    importId,
    createdAt: now,
    updatedAt: now,
  };
  let row: Awaited<ReturnType<typeof followupsRepo.insertFollowUp>> | undefined;
  for (let a = 0; a < 3 && !row; a++) {
    const followUpCode = await followupsRepo.nextFollowUpCode(tx);
    try {
      row = await followupsRepo.insertFollowUp({ ...base, followUpCode }, tx);
    } catch (err) {
      if (a === 2 || !/duplicate entry|follow_ups_code_uq/i.test(String(err))) throw err;
    }
  }
  if (!row) throw new Error("Could not allocate a Follow-up ID");

  await followupsRepo.insertAttempt(
    {
      followUpId: row.id,
      attemptNo: 1,
      scheduledAt: d.scheduledAt,
      outcome: "SCHEDULED",
      note: "Imported",
      recordedAt: now,
      recordedByUserId: user.id,
    },
    tx,
  );
  return row.followUpCode;
}
