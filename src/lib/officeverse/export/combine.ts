/**
 * Officeverse — combined Lead + Follow-up row shaping (Phase 8). PURE.
 *
 * APPROACH A: one row per Lead↔Follow-up relationship.
 *   - a Lead with N follow-ups → N rows (no history lost)
 *   - a Lead with no follow-up  → 1 row (follow-up columns blank)
 *   - a follow-up whose lead_id does not resolve → DROPPED (never a
 *     follow-up row without a valid Lead)
 * Ownership columns come from the Lead part and are repeated on every pair row.
 */

export interface LeadPart {
  leadNumId: number;
  cells: Record<string, unknown>;
}
export interface FollowUpPart {
  leadNumId: number | null;
  cells: Record<string, unknown>;
}

export function pairLeadsAndFollowUps(
  leads: LeadPart[],
  followUps: FollowUpPart[],
): Array<Record<string, unknown>> {
  const fusByLead = new Map<number, Array<Record<string, unknown>>>();
  for (const fu of followUps) {
    if (fu.leadNumId == null) continue; // orphan → dropped
    const list = fusByLead.get(fu.leadNumId);
    if (list) list.push(fu.cells);
    else fusByLead.set(fu.leadNumId, [fu.cells]);
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const lead of leads) {
    const fus = fusByLead.get(lead.leadNumId);
    if (!fus || fus.length === 0) {
      rows.push({ ...lead.cells });
      continue;
    }
    for (const fuCells of fus) rows.push({ ...lead.cells, ...fuCells });
  }
  return rows;
}
