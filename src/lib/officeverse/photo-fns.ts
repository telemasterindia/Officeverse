/**
 * Officeverse — client-callable profile-photo server functions (Phase 19).
 *
 * Outside `src/server/**`. The image validator, storage adapter and the
 * `staff_photos` row all live server-side. Every handler derives the acting
 * user + role from the session; a client-supplied `targetUserId` is only
 * honoured for Admin / HR — for everyone else the target is forced to `self`.
 *
 *   POST  setProfilePhotoFn    → upload / replace (own, or any for Admin/HR)
 *   POST  removeProfilePhotoFn → remove
 *   GET   myPhotoMetaFn        → caller's own photo metadata
 *   GET   profilePhotoFn       → image bytes (base64) for an authorised viewer
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUser, requestInfo } from "@/server/context";
import * as svc from "@/server/hr/photo-service";

const userId = z.coerce.number().int().positive();
// generous cap on the encoded payload — the server re-validates the decoded bytes
const dataBase64 = z.string().min(16).max(8_000_000);

const setInput = z.object({
  targetUserId: userId.optional(),
  dataBase64,
});
const removeInput = z.object({ targetUserId: userId.optional() }).partial().default({});
const viewInput = z.object({ userId: userId.optional() }).partial().default({});

function decode(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export const setProfilePhotoFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => setInput.parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.setProfilePhoto(
      user,
      { targetUserId: data.targetUserId ?? null, bytes: decode(data.dataBase64) },
      requestInfo(),
    );
  });

export const removeProfilePhotoFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => removeInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.removeProfilePhoto(user, data.targetUserId ?? null, requestInfo());
  });

export const myPhotoMetaFn = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async () => {
    const user = await requireUser();
    return svc.photoMeta(user, null);
  });

export const profilePhotoFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => viewInput.parse(d ?? {}))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return svc.profilePhotoBytes(user, data.userId ?? null);
  });
