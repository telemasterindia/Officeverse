import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { MissionStateKey } from "@/lib/officeverse/visual";
import { MissionStateBadge } from "./officeverse-status";
import { ProgressRing } from "./progress-ring";

/**
 * A unit of work shown as a mission rather than a table row.
 * Counts are passed in by the caller from real data — this component invents nothing.
 * Omit `done` to show a plain count instead of a progress ring.
 */

export function MissionCard({
  emoji,
  title,
  hint,
  done,
  total,
  state,
  tone = "primary",
  action,
  className,
}: {
  emoji: string;
  title: string;
  hint?: ReactNode;
  done?: number;
  total: number;
  state?: MissionStateKey;
  tone?: "primary" | "success" | "warning" | "accent" | "info";
  action?: ReactNode;
  className?: string;
}) {
  const pct = done === undefined || total <= 0 ? 0 : Math.round((done / total) * 100);

  return (
    <article
      className={cn(
        "floating-panel animate-rise-in flex items-center gap-4 rounded-2xl p-4",
        className,
      )}
    >
      {done === undefined ? (
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full border-2 border-primary/25 font-display text-lg font-black">
          {total}
        </span>
      ) : (
        <ProgressRing
          value={pct}
          size={64}
          thickness={6}
          tone={tone}
          label={
            <span className="font-display text-sm font-black">
              {done}
              <span className="text-muted-foreground">/{total}</span>
            </span>
          }
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-base" aria-hidden>
            {emoji}
          </span>
          <h3 className="truncate font-display text-sm font-bold">{title}</h3>
        </div>
        {hint ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
        {state ? (
          <div className="mt-2">
            <MissionStateBadge state={state} />
          </div>
        ) : null}
      </div>
      {action}
    </article>
  );
}
