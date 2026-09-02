import { urgencyOf, type FollowUpRecord, type FollowUpUrgency } from "@/lib/officeverse/followups";
import { cn } from "@/lib/utils";

const URGENCY_STYLE: Record<FollowUpUrgency, string> = {
  SCHEDULED: "bg-info/12 text-info border-info/25",
  DUE: "bg-warning/15 text-warning border-warning/30",
  OVERDUE: "bg-destructive/12 text-destructive border-destructive/30",
  COMPLETED: "bg-success/12 text-success border-success/25",
  CANCELLED: "bg-muted text-muted-foreground border-border",
  CONVERTED: "bg-accent/12 text-accent border-accent/25",
};

/** Small status pill used across the follow-up list, calendar and record pages. */
export function FollowUpStatusBadge({
  fu,
  className,
}: {
  fu: Pick<FollowUpRecord, "status" | "scheduled_at">;
  className?: string;
}) {
  const u = urgencyOf(fu);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider",
        URGENCY_STYLE[u],
        className,
      )}
    >
      {u}
    </span>
  );
}
