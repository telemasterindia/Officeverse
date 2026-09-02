import { Link } from "@tanstack/react-router";
import { ArrowRight, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PROCESSES } from "@/lib/officeverse/data";
import type { ProcessCode } from "@/lib/officeverse/types";
import { ShiftBadge } from "./shift-badge";

/**
 * TeleMaster India — Global Sales Floor greeting.
 *
 * A clean, professional shift header: greeting, the India→USA operational
 * identity, and the primary actions. No illustrated character or scene.
 */
export function WorkspaceHero({
  greeting,
  name,
  process,
  message,
}: {
  greeting: string;
  name: string;
  process: ProcessCode;
  message: string;
}) {
  const proc = PROCESSES[process];

  return (
    <section
      data-room="workspace"
      className="animate-rise-in relative -mx-4 overflow-hidden rounded-b-[2rem] border-b border-[var(--panel-rim)] lg:-mx-8"
      style={{ background: "var(--hero-bg)" }}
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 z-20 h-1"
        style={{ backgroundImage: "var(--proc-strip, none)" }}
      />

      <div className="relative mx-auto max-w-[1440px] px-4 py-9 sm:px-6 lg:px-8 lg:py-12">
        <p className="font-display text-[11px] font-bold uppercase tracking-[0.22em] text-primary/90">
          TeleMaster India · Global Sales Floor
        </p>
        <h1 className="mt-3 font-display text-[2.1rem] font-black leading-[1.04] sm:text-[2.9rem]">
          {greeting}, {name}
        </h1>
        <p className="mt-3 max-w-2xl text-sm font-medium leading-relaxed text-foreground/70">
          {message}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <ShiftBadge code={process} showHours />
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--panel-rim)] bg-card/60 px-3 py-1.5 text-xs font-semibold backdrop-blur">
            <span aria-hidden>{proc.flags}</span>
            <span className="tracking-wide text-muted-foreground">India → USA desk</span>
          </span>
        </div>

        <div className="mt-6 flex flex-wrap gap-2.5">
          <Button asChild className="rounded-full">
            <Link to="/leads/new">
              <Target className="mr-2 h-4 w-4" /> Submit a lead
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="rounded-full border-[var(--panel-rim)] bg-card/40"
          >
            <Link to="/followups">
              Follow-up missions <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
