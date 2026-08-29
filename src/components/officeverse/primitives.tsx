import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PROCESSES } from "@/lib/officeverse/data";
import type { FollowUpStatus, LeadStatus, ProcessCode } from "@/lib/officeverse/types";

export function UserAvatar({
  name,
  size = "md",
  presence,
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg" | "xl";
  presence?: "online" | "away" | "offline";
  className?: string;
}) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const sizes = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-14 w-14 text-base",
    xl: "h-20 w-20 text-2xl",
  } as const;
  const hue = (name.charCodeAt(0) * 37) % 360;
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-2xl font-display font-bold text-primary-foreground ring-1 ring-border",
          sizes[size],
        )}
        style={{
          backgroundImage: `linear-gradient(140deg, oklch(0.62 0.18 ${hue}), oklch(0.55 0.16 ${(hue + 60) % 360}))`,
        }}
        aria-hidden
      >
        {initials}
      </span>
      {presence ? (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-background",
            presence === "online" && "bg-success",
            presence === "away" && "bg-warning",
            presence === "offline" && "bg-muted-foreground",
          )}
          aria-label={presence}
        />
      ) : null}
    </span>
  );
}

export function ProcessBadge({ code, compact }: { code: ProcessCode; compact?: boolean }) {
  const p = PROCESSES[code];
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs font-semibold tracking-wide">
      <span aria-hidden className="text-sm leading-none">
        {p.flags}
      </span>
      <span className="text-secondary-foreground">{compact ? p.code : p.shift}</span>
    </span>
  );
}

const LEAD_STATUS_STYLE: Record<LeadStatus | FollowUpStatus, string> = {
  NEW: "bg-info/15 text-info border-info/30",
  ASSIGNED: "bg-primary/15 text-primary border-primary/30",
  ACCEPTED: "bg-success/15 text-success border-success/30",
  REJECTED: "bg-destructive/15 text-destructive border-destructive/30",
  "FOLLOW-UP": "bg-warning/15 text-warning border-warning/30",
  COMPLETED: "bg-success/12 text-success border-success/25",
  TODAY: "bg-accent/15 text-accent border-accent/30",
  UPCOMING: "bg-info/15 text-info border-info/30",
  OVERDUE: "bg-warning/18 text-warning border-warning/35",
};

export function StatusBadge({ status }: { status: LeadStatus | FollowUpStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider",
        LEAD_STATUS_STYLE[status],
      )}
    >
      {status}
    </span>
  );
}

export function LeadIdChip({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(id);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="inline-flex items-center gap-1.5 rounded-lg bg-secondary/70 px-2 py-1 font-mono text-xs font-semibold text-secondary-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Copy lead id ${id}`}
    >
      {id}
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success" />
      ) : (
        <Copy className="h-3.5 w-3.5 opacity-60" />
      )}
    </button>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: "default" | "success" | "warning" | "danger" | "accent";
}) {
  const tones = {
    default: "text-primary bg-primary/12",
    success: "text-success bg-success/12",
    warning: "text-warning bg-warning/12",
    danger: "text-destructive bg-destructive/12",
    accent: "text-accent bg-accent/12",
  } as const;
  return (
    <Card className="surface-panel relative overflow-hidden rounded-xl border-border p-5 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 font-display text-3xl font-bold leading-none">{value}</p>
          {hint ? <p className="mt-2 truncate text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {Icon ? (
          <span
            className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tones[tone])}
          >
            <Icon className="h-5 w-5" />
          </span>
        ) : null}
      </div>
    </Card>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-2 flex flex-wrap items-center gap-2">{eyebrow}</div> : null}
        <h1 className="font-display text-3xl font-bold leading-tight sm:text-4xl">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function ChartCard({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="surface-panel rounded-xl border-border p-5">
      <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold">{title}</h3>
          {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function EmptyState({
  title,
  message,
  action,
  emoji = "✨",
}: {
  title: string;
  message: string;
  action?: ReactNode;
  emoji?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-card/40 px-6 py-14 text-center">
      <div
        className="animate-float-soft grid h-16 w-16 place-items-center rounded-2xl bg-primary/12 text-3xl"
        aria-hidden
      >
        {emoji}
      </div>
      <h3 className="mt-4 font-display text-lg font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="surface-panel rounded-xl border-border">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/70 px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold">{title}</h2>
          {description ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

export function ActivityTimeline({
  items,
}: {
  items: { actor: string; action: string; target: string; time: string }[];
}) {
  return (
    <ol className="relative space-y-5 border-l border-border/70 pl-5">
      {items.map((item, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-primary/15" />
          <p className="text-sm">
            <span className="font-semibold">{item.actor}</span>{" "}
            <span className="text-muted-foreground">{item.action}</span>{" "}
            <span className="font-mono text-xs text-accent">{item.target}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{item.time}</p>
        </li>
      ))}
    </ol>
  );
}

export function FileUploader({ label = "Add supporting files (optional)" }: { label?: string }) {
  const [files, setFiles] = useState<string[]>([]);
  return (
    <div>
      <label
        className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-secondary/30 px-6 py-8 text-center transition-colors hover:bg-secondary/50"
        htmlFor="attachments"
      >
        <span className="text-2xl" aria-hidden>
          📎
        </span>
        <span className="mt-2 text-sm font-semibold">Drag &amp; drop files here</span>
        <span className="mt-1 text-xs text-muted-foreground">{label}</span>
        <input
          id="attachments"
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []).map((f) => f.name))}
        />
      </label>
      {files.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {files.map((f) => (
            <li
              key={f}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-border/70 bg-card px-3 py-2"
            >
              <span className="truncate text-sm">📄 {f}</span>
              <span className="flex shrink-0 gap-1">
                <Button type="button" size="sm" variant="ghost">
                  Preview
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                >
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
