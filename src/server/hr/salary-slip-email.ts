/**
 * Officeverse — salary-slip email body (Phase 14). PURE. No sending, no I/O.
 *
 * Concise and provider-agnostic. Salary figures live in the attached PDF, not
 * the body. No Closer-reward mention, no tax / legal language.
 */
import { monthLabel } from "./salary-slip-pdf";

export interface SalarySlipEmailInput {
  employeeName: string;
  periodMonth: string; // "YYYY-MM"
  isPreview: boolean;
  fileName: string;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildSalarySlipEmail(input: SalarySlipEmailInput): BuiltEmail {
  const label = monthLabel(input.periodMonth);
  const tag = input.isPreview ? " (Preview)" : "";
  const subject = `Officeverse Salary Slip - ${label}${tag}`;
  const lines = [
    `Hi ${input.employeeName},`,
    "",
    `Your Officeverse salary slip for ${label} is attached (${input.fileName}).`,
    "",
    input.isPreview
      ? "Note: this is a preview and not the final salary slip."
      : "This salary slip reflects the recorded payroll snapshot for the month.",
    "",
    "Regards,",
    "Officeverse HR",
  ];
  const text = lines.join("\n");
  const html = `<div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">${lines
    .map((l) => `<p style="margin:0 0 8px">${escapeHtml(l) || "&nbsp;"}</p>`)
    .join("")}</div>`;
  return { subject, text, html };
}
