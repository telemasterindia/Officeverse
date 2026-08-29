import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Lightweight SVG progress ring. Animates via a single CSS transition (no JS loop). */

const TONE: Record<string, string> = {
  primary: "var(--primary)",
  success: "var(--success)",
  warning: "var(--warning)",
  accent: "var(--accent)",
  info: "var(--info)",
};

export function ProgressRing({
  value,
  size = 64,
  thickness = 6,
  tone = "primary",
  label,
  className,
}: {
  value: number;
  size?: number;
  thickness?: number;
  tone?: "primary" | "success" | "warning" | "accent" | "info";
  label?: ReactNode;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (circ * clamped) / 100;

  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--border)"
          strokeWidth={thickness}
        />
        <circle
          className="ov-ring-progress"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={TONE[tone]}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      {label ? (
        <div className="absolute inset-0 grid place-items-center text-center leading-none">
          {label}
        </div>
      ) : null}
    </div>
  );
}
