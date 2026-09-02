/**
 * HR POLICY — VIEW + ADMIN/HR EDIT & DELETE (PURE / structural).
 *
 *   - a `View` action exists for EVERY role and opens the full-content dialog
 *   - Edit / Delete render ONLY when canManage (HR/Admin); Agent/Closer never
 *     see them
 *   - Delete is server-authorized (admin/hr only) and is not just a hidden
 *     button
 *   - editing / deleting a PUBLISHED policy is not blocked by its status
 *   - existing publish/unpublish + audit trail behavior is untouched
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertCanManageHrPolicy, canManageHrPolicy } from "../authz/hr-policy";
import { HttpError } from "../http-error";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const throws403 = (fn: () => void): boolean => {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof HttpError && e.status === 403;
  }
};

const route = read("routes/_shell.policies.tsx");
const fns = read("lib/officeverse/hr-policy-fns.ts");
const svc = stripComments(read("server/hr-policy/service.ts"));

describe("View — available to every role, read-only", () => {
  it("PolicyCard always renders a View button, independent of canManage", () => {
    const card = route.slice(route.indexOf("function PolicyCard"));
    // the View button sits OUTSIDE the `canManage ? (...) : null` block
    const viewMatch = />\s*View\s*</.exec(card);
    const manageBlockStart = card.indexOf("{canManage ? (");
    expect(viewMatch).toBeTruthy();
    expect(manageBlockStart).toBeGreaterThan(-1);
    expect(viewMatch!.index).toBeLessThan(manageBlockStart);
    expect(card).toMatch(/onClick=\{onView\}/);
  });

  it("the view dialog shows title, full content, effective/published date, last updated, published by", () => {
    const dialog = route.slice(route.indexOf("function PolicyViewDialog"));
    expect(dialog).toMatch(/\{policy\.title\}/);
    expect(dialog).toMatch(/\{policy\.content\}/); // full content, no slice/truncate
    expect(dialog).toMatch(/Effective date/);
    expect(dialog).toMatch(/Published date/);
    expect(dialog).toMatch(/Last updated/);
    expect(dialog).toMatch(/Published by/);
    // never renders Edit / Delete
    expect(dialog.slice(0, dialog.indexOf("</Dialog>"))).not.toMatch(/>Edit</);
    expect(dialog.slice(0, dialog.indexOf("</Dialog>"))).not.toMatch(/>Delete</);
  });

  it("Agent/Closer never see Edit or Delete controls (canManage-gated in the same component)", () => {
    const card = route.slice(
      route.indexOf("function PolicyCard"),
      route.indexOf("function PolicyCard") +
        route.slice(route.indexOf("function PolicyCard")).indexOf("\n}\n"),
    );
    const manageBlock = card.slice(card.indexOf("{canManage ? ("));
    expect(manageBlock).toMatch(/>\s*Edit\s*</);
    expect(manageBlock).toMatch(/>\s*Delete\s*</);
    expect(manageBlock).toMatch(/Unpublish|Publish/);
  });
});

describe("Delete — Admin/HR only, server-enforced", () => {
  it("deletePolicy asserts assertCanManageHrPolicy and hard-deletes the row", () => {
    const fn = svc.slice(svc.indexOf("export async function deletePolicy"));
    expect(fn).toMatch(/assertCanManageHrPolicy\(actor\.role\)/);
    expect(fn).toMatch(/\.delete\(hrPolicies\)\.where\(eq\(hrPolicies\.id, id\)\)/);
    expect(fn).toMatch(/"hr_policy\.deleted"/);
  });

  it("deletePolicyFn requires admin/hr — not just a hidden button", () => {
    expect(fns).toMatch(/deletePolicyFn[\s\S]{0,200}requireRole\("admin", "hr"\)/);
  });

  it("Agent/Closer cannot manage (delete/edit/publish share the same gate)", () => {
    expect(throws403(() => assertCanManageHrPolicy("agent"))).toBe(true);
    expect(throws403(() => assertCanManageHrPolicy("closer"))).toBe(true);
    expect(canManageHrPolicy("hr")).toBe(true);
    expect(canManageHrPolicy("admin")).toBe(true);
  });
});

describe("Edit — a PUBLISHED policy is not protected from edit/delete by its status", () => {
  it("savePolicy has no PUBLISHED-status guard blocking the update path", () => {
    const fn = svc.slice(
      svc.indexOf("export async function savePolicy"),
      svc.indexOf("export async function setPolicyStatus"),
    );
    expect(fn).not.toMatch(/status === "PUBLISHED"[\s\S]{0,80}throw/);
    expect(fn).not.toMatch(/cannot edit a published/i);
    // updates the SAME row (no insert on the edit path)
    expect(fn).toMatch(/if \(input\.id\) \{/);
    expect(fn).toMatch(/\.update\(hrPolicies\)/);
  });

  it("deletePolicy has no PUBLISHED-status guard either", () => {
    const fn = svc.slice(svc.indexOf("export async function deletePolicy"));
    expect(fn).not.toMatch(/status === "PUBLISHED"[\s\S]{0,80}throw/);
  });
});

describe("existing publish/unpublish + audit behavior is untouched", () => {
  it("setPolicyStatus still flips status and audits published/unpublished", () => {
    const fn = svc.slice(
      svc.indexOf("export async function setPolicyStatus"),
      svc.indexOf("export async function deletePolicy"),
    );
    expect(fn).toMatch(/"PUBLISHED"/);
    expect(fn).toMatch(/"hr_policy\.published"/);
    expect(fn).toMatch(/"hr_policy\.unpublished"/);
  });

  it("the route still exposes a Publish/Unpublish toggle for managers", () => {
    expect(route).toMatch(/useSetPolicyStatus\(\)/);
    expect(route).toMatch(/Unpublish/);
  });
});
