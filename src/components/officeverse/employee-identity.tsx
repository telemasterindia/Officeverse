import { useEffect, useReducer } from "react";
import type { ProcessCode } from "@/lib/officeverse/types";
import {
  getEmployeePhoto,
  subscribeEmployeePhotos,
  type IdentityMode,
} from "@/lib/officeverse/identity";
import { cn } from "@/lib/utils";
import { PeerAvatar } from "./peer-avatar";

/**
 * One identity, two faces. Renders the employee's real photo when
 * `mode === "photo"` AND a photo exists; otherwise the OfficeCharacter (via
 * PeerAvatar). Same footprint either way, so it drops into any card or row.
 */
const PX = { tiny: 26, small: 34, medium: 44, large: 60 } as const;

export function EmployeeIdentity({
  name,
  mode = "character",
  size = "small",
  presence,
  process,
  className,
}: {
  name: string;
  mode?: IdentityMode;
  size?: keyof typeof PX;
  presence?: "online" | "away" | "offline";
  process?: ProcessCode;
  className?: string;
}) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeEmployeePhotos(force), []);

  const photo = getEmployeePhoto(name);
  if (mode !== "photo" || !photo) {
    return (
      <PeerAvatar
        name={name}
        size={size}
        presence={presence}
        process={process}
        className={className}
      />
    );
  }

  const px = PX[size];
  const tiny = size === "tiny";
  return (
    <span
      className={cn("relative inline-flex shrink-0", className)}
      style={{ width: px, height: px }}
    >
      <span className="h-full w-full overflow-hidden rounded-full ring-1 ring-border">
        <img src={photo} alt={name} loading="lazy" className="h-full w-full object-cover" />
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
    </span>
  );
}
