import type { ReactNode } from "react";
import { useSession } from "@/lib/officeverse/session";
import { ROOM_META, type RoomKey } from "@/lib/officeverse/visual";
import { cn } from "@/lib/utils";
import { ShiftBadge } from "./shift-badge";

/**
 * "You have entered a room" wrapper — a consistent, professional arrival header
 * for the transformed screens: room label, title, shift identity, status and
 * actions. No illustrated character or scene.
 */
export function OfficeverseRoom({
  room,
  title,
  tagline,
  eyebrow,
  status,
  actions,
  className,
  children,
}: {
  room: RoomKey;
  title: string;
  tagline?: string;
  eyebrow?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const { user } = useSession();
  const meta = ROOM_META[room];

  return (
    <div className={cn("space-y-5 lg:space-y-7", className)}>
      <header
        data-room={room}
        className="animate-rise-in relative -mx-4 overflow-hidden border-b border-[var(--panel-rim)] lg:-mx-8"
        style={{ background: "var(--hero-bg)" }}
      >
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 z-20 h-1.5"
          style={{ backgroundImage: "var(--proc-strip, none)" }}
        />
        <div className="relative mx-auto max-w-[1440px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-3 py-1 font-display text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
            <span aria-hidden className="text-sm">
              {meta.emoji}
            </span>
            {meta.label}
          </p>
          {eyebrow ? <div className="mt-3 flex flex-wrap items-center gap-2">{eyebrow}</div> : null}
          <h1 className="mt-3 font-display text-[2rem] font-black leading-[1.05] sm:text-[2.6rem]">
            {title}
          </h1>
          {tagline ? (
            <p className="mt-2 max-w-2xl text-sm font-medium text-foreground/70">{tagline}</p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {user ? <ShiftBadge code={user.process} showHours /> : null}
            {status}
          </div>
          {actions ? <div className="mt-5 flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      </header>
      <div className="relative z-[1] space-y-5 lg:space-y-7">{children}</div>
    </div>
  );
}
