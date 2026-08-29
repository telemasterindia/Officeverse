import type { Employee } from "@/lib/officeverse/types";
import { PROCESSES } from "@/lib/officeverse/data";
import { cn } from "@/lib/utils";
import { EmployeeIdentity } from "./employee-identity";
import type { IdentityMode } from "@/lib/officeverse/identity";

/**
 * Colourful "team pods" — the people-first hero for the Command Center.
 * Each employee is a character on a soft-coloured platform. Reuses
 * EmployeeIdentity (character / photo), presence and process cues.
 */
const DEPT_TONE: Record<string, string> = {
  Sales: "linear-gradient(180deg, oklch(0.93 0.06 255), oklch(0.9 0.05 290))",
  Closing: "linear-gradient(180deg, oklch(0.94 0.07 45), oklch(0.92 0.06 25))",
  People: "linear-gradient(180deg, oklch(0.93 0.08 160), oklch(0.94 0.08 128))",
  Operations: "linear-gradient(180deg, oklch(0.92 0.06 300), oklch(0.92 0.05 265))",
};

function Pod({ e, mode }: { e: Employee; mode: IdentityMode }) {
  return (
    <div
      className="relative flex flex-col items-center rounded-3xl border border-border/40 p-3 pb-3.5 text-center"
      style={{ background: DEPT_TONE[e.department] ?? DEPT_TONE["Operations"] }}
    >
      <EmployeeIdentity name={e.name} mode={mode} size="large" presence={e.presence} />
      <p className="mt-2 line-clamp-1 text-[13px] font-bold text-foreground">
        {e.name.split(" ")[0]} {e.name.split(" ")[1]?.[0] ?? ""}
      </p>
      <p className="line-clamp-1 text-[10px] text-foreground/60">{e.designation}</p>
      <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-foreground/80">
        <span aria-hidden>{PROCESSES[e.process].flags}</span>
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            e.presence === "online" && "bg-success",
            e.presence === "away" && "bg-warning",
            e.presence === "offline" && "bg-muted-foreground",
          )}
        />
      </span>
    </div>
  );
}

export function TeamPods({
  employees,
  mode = "character",
  className,
}: {
  employees: Employee[];
  mode?: IdentityMode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6",
        className,
      )}
    >
      {employees.map((e) => (
        <Pod key={e.id} e={e} mode={mode} />
      ))}
    </div>
  );
}
