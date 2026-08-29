import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Four live US timezone watches for the agent working the US process.
 *
 * Informational only — NOT controls, and separate from the operational
 * US-shift indicator. Times are timezone-aware (Intl + IANA zones), so US
 * daylight saving transitions are handled automatically — no fixed offsets.
 */
const ZONES = [
  { tz: "America/New_York", name: "Eastern", abbr: "ET" },
  { tz: "America/Chicago", name: "Central", abbr: "CT" },
  { tz: "America/Denver", name: "Mountain", abbr: "MT" },
  { tz: "America/Los_Angeles", name: "Pacific", abbr: "PT" },
] as const;

function timeIn(tz: string, now: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(now);
}

/** Real DST-aware short label ("EDT" in summer, "EST" in winter). */
function liveAbbr(tz: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "short",
  }).formatToParts(now);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
}

export function UsTimezoneWatches({ className }: { className?: string }) {
  // null until mounted → deterministic SSR, no hydration mismatch.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className={cn("grid grid-cols-2 gap-1.5", className)}
      role="group"
      aria-label="US timezone clocks"
    >
      {ZONES.map((z) => (
        <div
          key={z.tz}
          title={now ? `${z.name} Time · ${liveAbbr(z.tz, now)}` : `${z.name} Time`}
          className="flex flex-col rounded-lg border border-sidebar-border/70 bg-sidebar-accent/10 px-2 py-1 leading-tight"
        >
          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-sidebar-foreground/55">
            {z.name}
          </span>
          <span className="font-mono text-[11px] font-semibold tabular-nums text-sidebar-foreground">
            {now ? timeIn(z.tz, now) : "--:--"}{" "}
            <span className="text-sidebar-foreground/55">{z.abbr}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
