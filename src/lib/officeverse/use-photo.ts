/**
 * Officeverse — real profile-photo hooks (Phase 19).
 *
 * The real photo is the person's identity. Upload flow: the browser crops /
 * resizes / compresses to a small JPEG, then sends the base64 to the server
 * which RE-VALIDATES the decoded bytes (magic-byte sniff, size, dimensions)
 * before storing them privately.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  myPhotoMetaFn,
  profilePhotoFn,
  removeProfilePhotoFn,
  setProfilePhotoFn,
} from "./photo-fns";

export function useMyPhotoMeta() {
  return useQuery({
    queryKey: ["photo", "me", "meta"],
    queryFn: () => myPhotoMetaFn({ data: {} }),
    staleTime: 30_000,
  });
}

/** The caller's own photo bytes (or an authorised employee's, for Admin/HR). */
export function useProfilePhoto(userId?: number) {
  return useQuery({
    queryKey: ["photo", "bytes", userId ?? "me"],
    queryFn: () => profilePhotoFn({ data: userId ? { userId } : {} }),
    staleTime: 60_000,
  });
}

export function useSetProfilePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { dataBase64: string; targetUserId?: number }) =>
      setProfilePhotoFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photo"] }),
  });
}

export function useRemoveProfilePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { targetUserId?: number } = {}) => removeProfilePhotoFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photo"] }),
  });
}

/**
 * Crop-to-square, resize and compress an image File in the browser.
 * Returns raw base64 (no `data:` prefix) of a JPEG. `max` caps the longest
 * edge; the server still enforces the hard limits.
 */
export function fileToSquareJpegBase64(file: File, max = 512, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const out = Math.min(max, side);
        const canvas = document.createElement("canvas");
        canvas.width = out;
        canvas.height = out;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas is unavailable in this browser."));
          return;
        }
        ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
      } catch {
        reject(new Error("That image could not be processed."));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file is not a readable image."));
    };
    img.src = url;
  });
}

/** Build a displayable data URL from the server's `{ mime, dataBase64 }`. */
export function photoDataUrl(res: { mime: string | null; dataBase64: string | null } | undefined) {
  if (!res || !res.dataBase64) return null;
  return `data:${res.mime ?? "image/jpeg"};base64,${res.dataBase64}`;
}
