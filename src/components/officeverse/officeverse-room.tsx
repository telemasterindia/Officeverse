import type { ReactNode } from "react";
import { useSession } from "@/lib/officeverse/session";
import type { CharacterPose } from "@/lib/officeverse/types";
import { ROOM_META, type RoomKey } from "@/lib/officeverse/visual";
import { cn } from "@/lib/utils";
import { ShiftBadge } from "./shift-badge";
import { Workstation } from "./workstation";

/**
 * Reusable "you have entered a room" wrapper. Gives every transformed screen a
 * consistent arrival header — room label, title, shift identity, status, the
 * employee character on stage — without touching the screen's own content.
 */
export function OfficeverseRoom({
  room,
  title,
  tagline,
  eyebrow,
  status,
  actions,
  character,
  pose = "idle",
  className,
  children,
}: {
  room: RoomKey;
  title: string;
  tagline?: string;
  eyebrow?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  character?: ReactNode;
  pose?: CharacterPose;
  className?: string;
  children: ReactNode;
}) {
  const { user } = useSession();
  const meta = ROOM_META[room];

  return (
    <div className={cn("space-y-5 lg:space-y-7", className)}>
      {/* Arrival — a full-bleed illustrated room. The copy floats inside it. */}
      <header
        data-room={room}
        className="animate-rise-in relative -mx-4 overflow-hidden lg:-mx-8"
        style={{ background: "var(--hero-bg)" }}
      >
        {/* process identity ribbon (India / India→USA) */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 z-20 h-1.5"
          style={{ backgroundImage: "var(--proc-strip, none)" }}
        />
        {/* soft floor for depth + a gentle fade into the page below */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5"
          style={{
            background:
              "linear-gradient(180deg, transparent, color-mix(in srgb, var(--room-accent) 10%, transparent))",
          }}
        />

        <div className="relative mx-auto grid max-w-[1440px] gap-4 px-4 py-7 sm:px-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-center lg:gap-6 lg:px-8 lg:py-10">
          {/* Greeting — sits directly on the environment, no card. */}
          <div className="relative order-2 min-w-0 lg:order-1">
            {/* soft light bloom for legibility over the illustrated room */}
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-x-6 -inset-y-8 -z-[1]"
              style={{
                background:
                  "radial-gradient(60% 60% at 30% 40%, color-mix(in srgb, var(--card) 78%, transparent), transparent 75%)",
              }}
            />
            <p className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-3 py-1 font-display text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
              <span aria-hidden className="text-sm">
                {meta.emoji}
              </span>
              {meta.label}
            </p>
            {eyebrow ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">{eyebrow}</div>
            ) : null}
            <h1 className="mt-3 font-display text-[2rem] font-black leading-[1.03] [text-shadow:0_1px_12px_var(--card)] sm:text-[2.8rem]">
              {title}
            </h1>
            {tagline ? (
              <p className="mt-2 max-w-md text-sm font-medium text-foreground/70">{tagline}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {user ? <ShiftBadge code={user.process} showHours /> : null}
              {status}
            </div>
            {actions ? <div className="mt-5 flex flex-wrap gap-2">{actions}</div> : null}
          </div>

          {/* The employee, seated and working — the dominant object on the page. */}
          <div className="order-1 w-full lg:order-2 lg:justify-self-center">
            {character ??
              (user ? (
                <Workstation
                  bare
                  name={user.name}
                  process={user.process}
                  room={room}
                  pose={pose === "idle" ? "working" : pose}
                  className="mx-auto w-full max-w-[680px]"
                />
              ) : null)}
          </div>
        </div>
      </header>
      {/* Work surfaces sit on the office floor, tucked under the workstation. */}
      <div className="relative z-[1] -mt-6 space-y-5 lg:-mt-16 lg:space-y-7">{children}</div>
    </div>
  );
}
