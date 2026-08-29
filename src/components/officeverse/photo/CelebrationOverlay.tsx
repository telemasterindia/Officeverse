import { useEffect } from "react";
import { createPortal } from "react-dom";
import { effectForEvent, resolveEffect } from "@/lib/officeverse/photo-effects";
import { PhotoDisplay } from "./PhotoDisplay";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * A short, self-dismissing recognition moment over the whole screen (Phase 19).
 * The reusable engine only — the RULES for when this fires (points, streaks,
 * achievements) are a later gamification phase. Follow-up activity never
 * triggers this. No autoplay sound (a future engine may add an opt-in
 * `sound` — accepted here, never played).
 */
export function CelebrationOverlay({
  open,
  onClose,
  name,
  src,
  event,
  effect,
  message,
  sound = false, // architecture only — never played in Phase 19
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  src?: string | null;
  /** a CelebrationEvent id — mapped to an effect; unknown → the calm default */
  event?: string;
  /** or force a specific effect id */
  effect?: string;
  message?: string;
  sound?: boolean;
}) {
  const reduced = useReducedMotion();
  const cfg = effect ? resolveEffect(effect) : event ? effectForEvent(event) : resolveEffect(null);
  const durationMs = reduced ? Math.min(1200, cfg.durationMs) : cfg.durationMs;

  useEffect(() => {
    if (!open) return;
    void sound; // intentionally unused — see the doc comment
    const t = setTimeout(onClose, durationMs + 400);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, durationMs, onClose, sound]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="ov-celebration-overlay" role="status" aria-live="polite" onClick={onClose}>
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-card/90 p-8 text-center shadow-xl ring-1 ring-border">
        <PhotoDisplay
          name={name}
          src={src ?? null}
          size="2xl"
          effect={cfg.id}
          effectBurstMs={durationMs}
        />
        <p className="font-display text-lg font-black">{message ?? cfg.label}</p>
        <p className="text-xs text-muted-foreground">{name}</p>
      </div>
    </div>,
    document.body,
  );
}
