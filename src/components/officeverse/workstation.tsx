import type { ReactNode } from "react";
import { DEFAULT_AVATAR } from "@/lib/officeverse/avatar";
import { useSession } from "@/lib/officeverse/session";
import type { AvatarConfig, CharacterPose, Expression, ProcessCode } from "@/lib/officeverse/types";
import type { RoomKey } from "@/lib/officeverse/visual";
import { cn } from "@/lib/utils";
import { Avatar25D } from "./office-character/avatar-25d";
import { DeskFront, RoomScene } from "./room-scene";

/**
 * The hero composition for a transformed screen: the employee, seated at a
 * workstation, inside an illustrated room.
 *
 *   illustrated back wall (RoomScene)  →  2.5D employee avatar  →  desk
 *
 * The India → USA atmosphere (ProcessRibbon + room-bg) is the story behind the
 * product; the avatar is the strongest character element. The desk occludes the
 * lower body for the seated read.
 */
export function Workstation({
  name,
  config,
  process,
  pose = "working",
  expression,
  room = "workspace",
  className,
  overlay,
  bare = false,
  scene = true,
}: {
  name: string;
  config?: AvatarConfig | undefined;
  process?: ProcessCode | undefined;
  pose?: CharacterPose;
  expression?: Expression | undefined;
  room?: RoomKey;
  className?: string | undefined;
  /** Optional floating chips/badges rendered above the scene. */
  overlay?: ReactNode;
  /** Drop the panel chrome so the scene melts into a parent environment. */
  bare?: boolean;
  /** Render the illustrated back wall. Off when a parent supplies the room. */
  scene?: boolean;
}) {
  const { avatar } = useSession();
  const cfg = config ?? avatar ?? DEFAULT_AVATAR;

  return (
    <div
      data-room={room}
      className={cn(
        "ov-workstation relative isolate w-full overflow-hidden",
        !bare && "rounded-[1.75rem] border border-border/50",
        className,
      )}
      style={{
        aspectRatio: "5 / 4",
        background: bare
          ? undefined
          : "radial-gradient(90% 80% at 50% 8%, var(--shift-tint), transparent 70%), var(--room-wash)",
      }}
    >
      {/* illustrated back wall — window / shelf / board / plant, room-aware */}
      {scene ? (
        <RoomScene room={room} className="absolute inset-x-0 top-0 h-[60%] w-full opacity-75" />
      ) : null}

      {/* seated employee — polished 2.5D avatar */}
      <Avatar25D
        config={cfg}
        pose={pose}
        expression={expression}
        className="absolute bottom-[-4%] left-1/2 z-[1] h-[112%] w-[92%] -translate-x-1/2"
      />

      {/* foreground desk — occludes the lower body so the figure reads as seated */}
      <DeskFront
        room={room}
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[32%] w-full"
      />

      {overlay ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap gap-2 p-4">
          {overlay}
        </div>
      ) : null}
    </div>
  );
}
