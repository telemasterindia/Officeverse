import { useEmployeePhoto } from "@/lib/officeverse/identity";
import { useSession } from "@/lib/officeverse/session";
import { photoDataUrl, useProfilePhoto } from "@/lib/officeverse/use-photo";
import type { ProcessCode } from "@/lib/officeverse/types";
import { PhotoDisplay } from "./photo/PhotoDisplay";

/**
 * SERVER-AWARE identity chip for a known employee (Phase 19 photo system).
 *
 * Unlike <PeerAvatar> / <EmployeeIdentity>, which only ever read the per-device
 * localStorage photo, this resolves the AUTHORITATIVE photo held in
 * `staff_photos` (the same private store the profile page and header use).
 *
 * Resolution order:
 *   1. the real server photo for `userId`  (fetched only when `hasPhoto` and the
 *      viewer is authorised — Admin/HR, or their own row; the endpoint enforces
 *      the same rule again server-side, so this only avoids a guaranteed 403)
 *   2. the per-device localStorage photo for `name`  (legacy fallback)
 *   3. a professional initials chip  (PhotoDisplay handles a null src)
 *
 * No new storage system, no public URL — bytes come back base64 through the
 * authenticated `profilePhotoFn`.
 */
const SIZE = {
  tiny: "xs",
  small: "sm",
  medium: "md",
  /** 64px circular — roster / "on the floor" thumbnails */
  roster: "roster",
  large: "lg",
  xlarge: "xl",
} as const;

export function StaffAvatar({
  userId,
  name,
  hasPhoto = true,
  canView,
  size = "medium",
  process,
  presence,
  rank,
  badge,
  className,
}: {
  userId: number | null | undefined;
  name: string;
  /** the directory DTO's `photo_available` — skip the fetch when false */
  hasPhoto?: boolean | undefined;
  /** explicit override; by default the viewer's own role decides (Admin/HR or
   *  their own row). Never widens access — the server re-checks regardless. */
  canView?: boolean;
  size?: keyof typeof SIZE;
  process?: ProcessCode | undefined;
  presence?: "online" | "away" | "offline" | undefined;
  rank?: number | undefined;
  badge?: string | undefined;
  className?: string | undefined;
}) {
  const { user } = useSession();
  const viewerMayFetch =
    canView ??
    (user?.role === "admin" ||
      user?.role === "hr" ||
      (userId != null && user != null && String(userId) === user.id));
  const enabled = Boolean(userId) && hasPhoto !== false && viewerMayFetch;
  const serverQ = useProfilePhoto(userId ?? undefined, { enabled });
  const serverSrc = enabled ? photoDataUrl(serverQ.data) : null;
  const localSrc = useEmployeePhoto(name);
  const src = serverSrc ?? localSrc ?? null;

  return (
    <PhotoDisplay
      name={name}
      src={src}
      size={SIZE[size]}
      {...(process ? { process } : {})}
      {...(presence ? { presence } : {})}
      {...(typeof rank === "number" ? { rank } : {})}
      {...(badge ? { badge } : {})}
      {...(className ? { className } : {})}
    />
  );
}
