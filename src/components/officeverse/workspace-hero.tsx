import { Link } from "@tanstack/react-router";
import { ArrowRight, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PROCESSES } from "@/lib/officeverse/data";
import type { CharacterPose, ProcessCode } from "@/lib/officeverse/types";
import { ProcessRibbon } from "./process-ribbon";
import { ShiftBadge } from "./shift-badge";
import { Workstation } from "./workstation";

/**
 * TeleMaster India — Global Sales Floor.
 *
 * The Workspace hero is a *scene*, not a banner: on the left, the greeting and
 * the shift's India→USA operational identity sit directly on the environment;
 * on the right, the employee is seated at a workstation with the India→USA
 * signal and its landmarks (Taj Mahal → Statue of Liberty) flowing behind.
 *
 *   BACKGROUND  India / USA atmosphere (room-bg, on the shell)
 *   MIDGROUND   India → USA flowing signal + landmarks (ProcessRibbon)
 *   FOREGROUND  employee + workstation (Workstation)
 *   UI          greeting, shift identity, primary actions
 */
export function WorkspaceHero({
  greeting,
  name,
  process,
  pose,
  message,
}: {
  greeting: string;
  name: string;
  process: ProcessCode;
  pose: CharacterPose;
  message: string;
}) {
  const proc = PROCESSES[process];

  return (
    <section
      data-room="workspace"
      className="animate-rise-in relative -mx-4 overflow-hidden rounded-b-[2rem] border-b border-[var(--panel-rim)] lg:-mx-8"
      style={{ background: "var(--hero-bg)" }}
    >
      {/* India → USA identity strip */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 z-20 h-1"
        style={{ backgroundImage: "var(--proc-strip, none)" }}
      />

      <div className="relative mx-auto grid max-w-[1440px] items-center gap-6 px-4 py-9 sm:px-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-10 lg:px-8 lg:py-12">
        {/* LEFT — greeting on the environment, no card */}
        <div className="relative order-2 min-w-0 lg:order-1">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-x-8 -inset-y-10 -z-[1]"
            style={{
              background:
                "radial-gradient(62% 60% at 32% 42%, color-mix(in srgb, var(--background) 72%, transparent), transparent 76%)",
            }}
          />
          <p className="font-display text-[11px] font-bold uppercase tracking-[0.22em] text-primary/90">
            TeleMaster India · Global Sales Floor
          </p>
          <h1 className="mt-3 font-display text-[2.1rem] font-black leading-[1.04] sm:text-[2.9rem]">
            {greeting},<br className="hidden sm:block" /> {name}
          </h1>
          <p className="mt-3 max-w-md text-sm font-medium leading-relaxed text-foreground/70">
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

        {/* RIGHT — the scene: signal + landmarks behind, employee at the desk */}
        <div className="relative order-1 w-full lg:order-2">
          <div className="relative mx-auto aspect-[5/4] w-full max-w-[620px]">
            <ProcessRibbon
              process={process}
              className="absolute inset-x-0 top-0 -z-[1] h-[72%] opacity-90"
            />
            <Workstation
              bare
              name={name}
              process={process}
              room="workspace"
              pose={pose}
              expression="happy"
              className="absolute inset-0"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
