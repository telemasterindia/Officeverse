/**
 * Officeverse — celebration ENERGY / light burst (Phase 6, reworked).
 *
 * PURE CSS, finite (`forwards`, no infinite loop that outlives the scene). Three
 * stacked layers give a sports-broadcast "ignition" rather than one faint glow:
 *
 *   1. core flash   — a quick bright white-hot centre pop (0 → ~0.5s)
 *   2. colour burst — an expanding radial accent wash (0 → ~55% of the scene)
 *   3. light rays   — a slow conic sweep of streaks behind the hero
 *
 * All three unmount with the scene. Nothing here touches business data.
 */
import type { CSSProperties } from "react";

interface Props {
  /** 0..1 brightness / reach */
  intensity: number;
  accent: readonly [string, string];
  /** total scene ms — the burst animations are fractions of this */
  durationMs: number;
  reduced: boolean;
}

export function CelebrationLightBurst({ intensity, accent, durationMs, reduced }: Props) {
  if (intensity <= 0) return null;
  const o = Math.min(1, intensity);
  const burstMs = Math.max(1100, Math.round(durationMs * 0.55));
  const flashMs = Math.max(360, Math.round(durationMs * 0.12));
  const raysMs = Math.max(2000, Math.round(durationMs * 0.9));

  const common: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };

  const colourBurst: CSSProperties = {
    ...common,
    "--cs-burst-o": String(o),
    animation: reduced ? "none" : `cs-burst ${burstMs}ms cubic-bezier(.16,.84,.3,1) forwards`,
    opacity: reduced ? Math.min(0.6, o * 0.7) : undefined,
    background:
      `radial-gradient(circle at 50% 48%, ` +
      `color-mix(in srgb, ${accent[0]} ${Math.round(72 * o)}%, transparent) 0%, ` +
      `color-mix(in srgb, ${accent[1]} ${Math.round(34 * o)}%, transparent) 30%, ` +
      `transparent 62%)`,
    willChange: "transform, opacity",
  } as CSSProperties;

  const coreFlash: CSSProperties = {
    ...common,
    animation: reduced ? "none" : `cs-flash ${flashMs}ms ease-out forwards`,
    opacity: reduced ? 0 : undefined,
    background:
      "radial-gradient(circle at 50% 48%, rgba(255,255,255,.95) 0%, rgba(255,255,255,.35) 12%, transparent 34%)",
    mixBlendMode: "screen",
  };

  const rays: CSSProperties = {
    ...common,
    animation: reduced ? "none" : `cs-rays ${raysMs}ms linear forwards`,
    opacity: reduced ? 0 : 0.0,
    background:
      `repeating-conic-gradient(from 0deg at 50% 48%, ` +
      `color-mix(in srgb, ${accent[1]} ${Math.round(22 * o)}%, transparent) 0deg 4deg, ` +
      `transparent 4deg 16deg)`,
    WebkitMask: "radial-gradient(circle at 50% 48%, #000 0%, transparent 60%)",
    mask: "radial-gradient(circle at 50% 48%, #000 0%, transparent 60%)",
    willChange: "transform, opacity",
  };

  return (
    <>
      <div aria-hidden style={rays} />
      <div aria-hidden style={colourBurst} />
      <div aria-hidden style={coreFlash} />
    </>
  );
}
