import type { ReactNode } from "react";
import { DEFAULT_AVATAR } from "@/lib/officeverse/avatar";
import type { AvatarConfig, CharacterPose, Expression, ProcessCode } from "@/lib/officeverse/types";
import { useSession } from "@/lib/officeverse/session";
import { cn } from "@/lib/utils";
import { OfficeCharacter } from "./office-character/office-character";
import { ShiftBadge } from "./shift-badge";

/**
 * The character "on stage" inside the Officeverse — a small platform, a soft
 * ground shadow, a presence-tinted ambient glow, and the shift badge.
 * Config comes from the live session by default; pass `config` to preview
 * another one, or `children` to override the renderer entirely.
 */
const PRESENCE_GLOW: Record<"online" | "away" | "offline", string> = {
  online: "var(--success)",
  away: "var(--warning)",
  offline: "var(--muted-foreground)",
};

export function CharacterStage({
  name,
  process,
  presence = "online",
  pose = "idle",
  expression,
  config,
  showShiftBadge = true,
  className,
  children,
}: {
  name: string;
  process?: ProcessCode;
  presence?: "online" | "away" | "offline";
  pose?: CharacterPose;
  expression?: Expression;
  config?: AvatarConfig;
  showShiftBadge?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const session = useSession();
  const avatar = config ?? session.avatar ?? DEFAULT_AVATAR;

  return (
    <div className={cn("animate-rise-in flex flex-col items-center", className)}>
      <div className="relative grid h-56 w-44 place-items-end sm:h-64 sm:w-52">
        {/* ambient glow */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-2 bottom-8 -z-10 rounded-[40%] opacity-55 blur-2xl"
          style={{
            background: `radial-gradient(circle at 50% 50%, ${PRESENCE_GLOW[presence]}, transparent 72%)`,
          }}
        />
        {/* platform */}
        <div
          aria-hidden
          className="absolute inset-x-3 bottom-3 h-6 rounded-[50%] border border-border/60 bg-secondary/50"
        />
        <div
          aria-hidden
          className="absolute inset-x-6 bottom-1 h-3 rounded-[50%] bg-foreground/15 blur-[3px]"
        />
        {children ?? (
          <OfficeCharacter
            config={avatar}
            process={process}
            pose={pose}
            expression={expression}
            title={`${name}'s TeleMaster India character`}
            className="relative h-[94%] w-full drop-shadow-[0_16px_20px_rgba(0,0,0,0.3)]"
          />
        )}
      </div>
      {process && showShiftBadge ? <ShiftBadge code={process} className="mt-3" /> : null}
    </div>
  );
}
