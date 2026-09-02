import { useState } from "react";
import type { ProcessCode } from "@/lib/officeverse/types";
import { cn } from "@/lib/utils";
import { PhotoEffect } from "./PhotoEffect";
import { initialsOf } from "./use-reduced-motion";

const SIZE: Record<string, string> = {
  xs: "h-8 w-8 text-[10px]",
  sm: "h-10 w-10 text-xs",
  md: "h-14 w-14 text-sm",
  /** 64px — roster / "on the floor" thumbnails */
  roster: "h-16 w-16 text-sm",
  lg: "h-20 w-20 text-lg",
  xl: "h-28 w-28 text-2xl",
  "2xl": "h-40 w-40 text-4xl",
};

/**
 * The ONE reusable real-photo identity component (Phase 19).
 *
 *   REAL PHOTO (`src`) → shown as-is (object-fit: cover, circular).
 *   NO PHOTO           → a professional initials chip, e.g. [RC]. Never a
 *                        cartoon / illustrated character.
 *
 * Reused by CRM profiles, the future leaderboard (`rank`, `badge`), celebration
 * overlays and Office TV. The `effect` prop layers a visual treatment AROUND
 * the photo without touching it. On the normal profile page pass no `effect`.
 */
export function PhotoDisplay({
  name,
  process,
  src,
  size = "md",
  rank,
  badge,
  effect,
  effectBurstMs,
  presence,
  className,
}: {
  name: string;
  process?: ProcessCode;
  /** authenticated data URL / object URL of the real photo, or null */
  src?: string | null;
  size?: keyof typeof SIZE;
  rank?: number;
  badge?: string;
  effect?: string | null;
  /** >0 = play the effect as a finite burst */
  effectBurstMs?: number;
  presence?: "online" | "away" | "offline";
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const showPhoto = Boolean(src) && !broken;

  const inner = (
    <span
      className={cn(
        "grid place-items-center overflow-hidden rounded-full bg-secondary/60 font-display font-bold text-foreground ring-1 ring-border",
        SIZE[size],
      )}
    >
      {showPhoto ? (
        <img
          src={src ?? undefined}
          alt={name}
          className="h-full w-full object-cover"
          loading="lazy"
          draggable={false}
          onError={() => setBroken(true)}
        />
      ) : (
        <span aria-label={name}>{initialsOf(name)}</span>
      )}
    </span>
  );

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {effect ? (
        <PhotoEffect effect={effect} burstMs={effectBurstMs}>
          {inner}
        </PhotoEffect>
      ) : (
        inner
      )}

      {typeof rank === "number" ? (
        <span className="absolute -left-1 -top-1 z-10 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-black text-primary-foreground ring-2 ring-background">
          {rank}
        </span>
      ) : null}
      {badge ? (
        <span className="absolute -right-1 -top-1 z-10 grid h-5 min-w-5 place-items-center rounded-full bg-warning px-1 text-[10px] font-black text-warning-foreground ring-2 ring-background">
          {badge}
        </span>
      ) : null}
      {presence ? (
        <span
          className={cn(
            "absolute bottom-0 right-0 z-10 h-3 w-3 rounded-full ring-2 ring-background",
            presence === "online" && "bg-success",
            presence === "away" && "bg-warning",
            presence === "offline" && "bg-muted-foreground",
          )}
          aria-label={presence}
        />
      ) : null}
      {process ? <span className="sr-only">{process} process</span> : null}
    </span>
  );
}
