import { useMemo } from "react";
import { avatarFromSeed } from "@/lib/officeverse/avatar";
import { useEmployeePhoto } from "@/lib/officeverse/identity";
import type { ProcessCode } from "@/lib/officeverse/types";
import { useSession } from "@/lib/officeverse/session";
import { AvatarDisplay } from "./avatar-display";

/**
 * The character chip for *any* employee shown in the app.
 *
 * - the logged-in user → their saved Avatar Studio config
 * - everyone else → a deterministic `avatarFromSeed(name)` — the same person
 *   always gets the same character, and it is never persisted or randomised.
 *
 * This is a visual fallback only. No fake avatar state is created for peers.
 */
const SIZE = { tiny: "xs", small: "sm", medium: "md", large: "lg" } as const;

export function PeerAvatar({
  name,
  presence,
  process,
  size = "small",
  className,
}: {
  name: string;
  presence?: "online" | "away" | "offline" | undefined;
  process?: ProcessCode | undefined;
  size?: keyof typeof SIZE;
  className?: string | undefined;
}) {
  const { user, avatar } = useSession();
  const photo = useEmployeePhoto(name);
  const config = useMemo(
    () => (user && user.name === name && avatar ? avatar : avatarFromSeed(name)),
    [user, avatar, name],
  );
  return (
    <AvatarDisplay
      config={config}
      photo={photo}
      name={name}
      presence={presence}
      process={process}
      size={SIZE[size]}
      className={className}
    />
  );
}
