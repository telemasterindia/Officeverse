import { PROCESSES } from "@/lib/officeverse/data";
import type { AvatarConfig, ProcessCode } from "@/lib/officeverse/types";
import { partnerFlag } from "@/lib/officeverse/visual";
import { cn } from "@/lib/utils";
import { OfficeCharacter } from "./office-character/office-character";

/**
 * Framed bust of an OfficeCharacter with an optional presence dot and a subtle
 * process cue. The single low-level "avatar chip" — used for the current user
 * (top bar / dropdown) and, via <PeerAvatar>, for every other employee.
 */
const PX = { xs: 26, sm: 34, md: 44, lg: 60, xl: 96 } as const;

const PRESENCE_RING: Record<"online" | "away" | "offline", string> = {
  online: "0 0 0 2px color-mix(in srgb, var(--success) 55%, transparent)",
  away: "0 0 0 2px color-mix(in srgb, var(--warning) 45%, transparent)",
  offline: "none",
};

export function AvatarDisplay({
  config,
  photo,
  name,
  presence,
  process,
  size = "md",
  ring = true,
  className,
}: {
  config: AvatarConfig;
  /** Real profile photo (data URL). When set it replaces the character bust. */
  photo?: string | null | undefined;
  name?: string | undefined;
  presence?: "online" | "away" | "offline" | undefined;
  process?: ProcessCode | undefined;
  size?: keyof typeof PX;
  ring?: boolean;
  className?: string | undefined;
}) {
  const px = PX[size];
  const big = size === "lg" || size === "xl";
  const tiny = size === "xs";
  return (
    <span
      className={cn("relative inline-flex shrink-0", className)}
      style={{ width: px, height: px }}
    >
      <span
        className={cn(
          "grid h-full w-full place-items-center overflow-hidden rounded-full bg-secondary/40",
          ring && "ring-1 ring-border",
        )}
        style={presence && !tiny ? { boxShadow: PRESENCE_RING[presence] } : undefined}
      >
        {photo ? (
          <img
            src={photo}
            alt={name ?? "Profile photo"}
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          <OfficeCharacter
            config={config}
            frame="bust"
            animated={big}
            title={name}
            className={tiny ? "h-full w-full" : "h-[108%] w-[108%]"}
          />
        )}
      </span>
      {presence ? (
        <span
          aria-label={presence}
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-background",
            tiny ? "h-2 w-2" : "h-2.5 w-2.5",
            presence === "online" && "bg-success",
            presence === "away" && "bg-warning",
            presence === "offline" && "bg-muted-foreground",
          )}
        />
      ) : null}
      {process && !tiny ? (
        <span
          aria-label={PROCESSES[process].label}
          className="absolute -bottom-1 -left-1 grid h-4 w-4 place-items-center rounded-full border border-border bg-card text-[9px] leading-none"
        >
          <span aria-hidden>{partnerFlag(PROCESSES[process].flags)}</span>
        </span>
      ) : null}
    </span>
  );
}
