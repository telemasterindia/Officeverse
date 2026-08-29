import { cn } from "@/lib/utils";
import {
  MISSION_STATE_META,
  STATUS_META,
  type MissionStateKey,
  type OfficeverseStatusKey,
} from "@/lib/officeverse/visual";

/**
 * The reusable Officeverse visual status language.
 * Separate from primitives.tsx <StatusBadge> (which encodes Lead / FollowUp record
 * status) — these encode presence and mission state for people and tasks.
 */

export function PresenceDot({
  status,
  className,
}: {
  status: OfficeverseStatusKey;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      aria-label={meta.label}
      style={{ backgroundColor: meta.color }}
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
        meta.pulse && "animate-attention",
        className,
      )}
    />
  );
}

export function OfficeverseStatusBadge({
  status,
  className,
}: {
  status: OfficeverseStatusKey;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3 py-1 text-xs font-semibold",
        className,
      )}
    >
      <PresenceDot status={status} />
      {meta.label}
    </span>
  );
}

export function MissionStateBadge({
  state,
  className,
}: {
  state: MissionStateKey;
  className?: string;
}) {
  const meta = MISSION_STATE_META[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
        meta.className,
        className,
      )}
    >
      <span aria-hidden>{meta.emoji}</span>
      {meta.label}
    </span>
  );
}
