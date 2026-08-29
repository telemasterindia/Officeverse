/**
 * Employee identity — TWO representations of the same person:
 *   - "character" → the Officeverse OfficeCharacter (illustrated identity)
 *   - "photo"     → a real uploaded photograph
 *
 * The character system is unchanged and remains the fallback. When a real photo
 * exists for a person it takes priority wherever that person's avatar chip is
 * shown (top bar, rosters, profile…). Removing the photo falls back to the
 * character.
 *
 * PERSISTENCE: photos are stored in `localStorage` (key `officeverse.identityPhotos`)
 * as a `{ [name]: dataURL }` map, downscaled to <=512px before storing. This
 * survives reloads on the same browser. It is NOT a backend — see limitations
 * in the report (per-device only, ~5MB localStorage quota, no cross-device sync).
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type IdentityMode = "character" | "photo";

const MODE_KEY = "officeverse.identityMode";
const PHOTO_KEY = "officeverse.identityPhotos";

/* -------------------------- photo store (localStorage) -------------------- */

const listeners = new Set<() => void>();
let cache: Record<string, string> | null = null;

function load(): Record<string, string> {
  if (cache) return cache;
  if (typeof window === "undefined") {
    cache = {};
    return cache;
  }
  try {
    const raw = window.localStorage.getItem(PHOTO_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    cache = parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function persist() {
  if (typeof window === "undefined" || !cache) return;
  try {
    window.localStorage.setItem(PHOTO_KEY, JSON.stringify(cache));
  } catch {
    /* quota / disabled storage — ignore, keep in-memory copy */
  }
}

function emit() {
  persist();
  listeners.forEach((fn) => fn());
}

export function setEmployeePhoto(name: string, dataUrl: string | null): void {
  const next = { ...load() };
  if (dataUrl) next[name] = dataUrl;
  else delete next[name];
  cache = next; // new ref so useSyncExternalStore re-renders
  emit();
}

export function getEmployeePhoto(name: string): string | undefined {
  return load()[name];
}

export function subscribeEmployeePhotos(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Live photo (dataURL) for `name`, or undefined. Re-renders on change. */
export function useEmployeePhoto(name: string): string | undefined {
  const map = useSyncExternalStore(subscribeEmployeePhotos, load, load);
  return name ? map[name] : undefined;
}

/**
 * Read an image File, downscale it so the longest edge is <= `max` px, and
 * return a JPEG data URL. Keeps localStorage small and the avatar crisp.
 * Falls back to the raw data URL if canvas is unavailable.
 */
export function fileToDownscaledDataUrl(file: File, max = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the image file."));
    reader.onload = () => {
      const raw = typeof reader.result === "string" ? reader.result : "";
      if (!raw) {
        reject(new Error("Could not read the image file."));
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(raw);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        } catch {
          resolve(raw);
        }
      };
      img.onerror = () => reject(new Error("That file is not a readable image."));
      img.src = raw;
    };
    reader.readAsDataURL(file);
  });
}

/* -------- display-mode preference (persisted, like theme) -------- */

export function useIdentityMode(fallback: IdentityMode = "character") {
  const [mode, setModeState] = useState<IdentityMode>(fallback);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(MODE_KEY);
      if (stored === "character" || stored === "photo") setModeState(stored);
    } catch {
      /* ignore */
    }
  }, []);

  const setMode = useCallback((m: IdentityMode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  }, []);

  return [mode, setMode] as const;
}
