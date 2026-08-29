import { PROCESSES } from "@/lib/officeverse/data";
import type { ProcessCode } from "@/lib/officeverse/types";
import { cn } from "@/lib/utils";

/**
 * Shift / country identity. Reads the existing PROCESSES table only.
 * The `data-shift` attribute re-scopes the `--shift-tint` token to this code.
 */

export function ShiftBadge({
  code,
  showHours = false,
  className,
}: {
  code: ProcessCode;
  showHours?: boolean;
  className?: string;
}) {
  const p = PROCESSES[code];
  return (
    <span
      data-shift={code}
      style={{ background: "var(--shift-tint)" }}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-current/20 px-3 py-1.5 text-xs font-semibold",
        className,
      )}
    >
      <span aria-hidden className="text-sm leading-none">
        {p.flags}
      </span>
      <span className="tracking-wide">{p.shift}</span>
      {showHours ? (
        <span className="border-l border-current/20 pl-2 font-normal opacity-70">{p.hours}</span>
      ) : null}
    </span>
  );
}

export function ShiftIdentityTag({ code, className }: { code: ProcessCode; className?: string }) {
  const p = PROCESSES[code];
  return (
    <div
      data-shift={code}
      style={{ background: "var(--shift-tint)" }}
      className={cn(
        "inline-flex min-w-[132px] flex-col items-center rounded-2xl border border-border/70 px-4 py-2.5 text-center",
        className,
      )}
    >
      <span className="text-lg leading-none" aria-hidden>
        {p.flags}
      </span>
      <span className="mt-1 font-display text-sm font-black tracking-wide">{p.shift}</span>
      <span className="text-[11px] text-muted-foreground">{p.hours}</span>
    </div>
  );
}
