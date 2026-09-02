/**
 * Officeverse — celebration HERO photo (Phase 6, reworked for TV scale).
 *
 * The employee is the HERO of the scene, so the portrait is sized in viewport
 * units — `min(40vh, 40vw)` — NOT a fixed avatar chip. It is a large circular
 * frame with an animated accent ring and glow.
 *
 *   src present  → the real official photo (the authenticated data URL that
 *                  tv-service resolves from `employeePhotoRef`), shown as-is,
 *                  `object-fit: cover`, never cropped/distorted/AI-touched.
 *   src missing  → the existing initials fallback (`initialsOf`), same big frame.
 *
 * The reveal (scale-up + rise + opacity + ring spin) is a CSS transition toggled
 * by the `revealed` flag from the scene timeline — no JS animation loop here.
 */
import type { CSSProperties } from "react";
import { initialsOf } from "@/components/officeverse/photo/use-reduced-motion";

interface Props {
  name: string;
  src: string | null;
  /** hero diameter as a viewport expression, e.g. "min(40vh, 40vw)" */
  sizeExpr: string;
  scaleFrom: number;
  scaleTo: number;
  glow: boolean;
  accent: readonly [string, string];
  revealed: boolean;
  reduced: boolean;
}

export function CelebrationPhoto({
  name,
  src,
  sizeExpr,
  scaleFrom,
  scaleTo,
  glow,
  accent,
  revealed,
  reduced,
}: Props) {
  const wrap: CSSProperties = {
    position: "relative",
    display: "inline-grid",
    placeItems: "center",
    width: sizeExpr,
    height: sizeExpr,
    transform: `scale(${revealed ? scaleTo : scaleFrom}) translateY(${revealed ? 0 : "5vh"})`,
    opacity: revealed ? 1 : 0,
    transition: reduced
      ? "opacity 260ms ease"
      : "transform 760ms cubic-bezier(.16,.86,.26,1), opacity 520ms ease",
    filter:
      glow && !reduced
        ? `drop-shadow(0 1vh 6vh color-mix(in srgb, ${accent[0]} 60%, transparent))`
        : undefined,
    willChange: "transform, opacity",
  };

  // spinning conic accent ring
  const ring: CSSProperties = {
    position: "absolute",
    inset: "-6%",
    borderRadius: "50%",
    padding: "1.1vh",
    background: `conic-gradient(from 0deg, ${accent[0]}, ${accent[1]}, ${accent[0]}, ${accent[1]}, ${accent[0]})`,
    WebkitMask:
      "radial-gradient(farthest-side, transparent calc(100% - 1.1vh), #000 calc(100% - 1.1vh))",
    mask: "radial-gradient(farthest-side, transparent calc(100% - 1.1vh), #000 calc(100% - 1.1vh))",
    animation: reduced ? "none" : "cs-ring-spin 5.5s linear infinite",
    opacity: revealed ? 0.95 : 0,
    transition: "opacity 620ms ease",
  };

  const halo: CSSProperties = {
    position: "absolute",
    inset: "-26%",
    borderRadius: "50%",
    pointerEvents: "none",
    background: `radial-gradient(circle, color-mix(in srgb, ${accent[0]} 55%, transparent) 0%, transparent 68%)`,
    opacity: revealed ? (reduced ? 0.5 : 1) : 0,
    transition: "opacity 700ms ease",
    filter: "blur(2vh)",
  };

  const frame: CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    overflow: "hidden",
    background: "#0c1326",
    boxShadow: "inset 0 0 0 0.5vh rgba(255,255,255,.14), 0 2vh 8vh rgba(0,0,0,.55)",
  };

  return (
    <span style={wrap}>
      {glow ? <span aria-hidden style={halo} /> : null}
      <span aria-hidden style={ring} />
      <span style={frame}>
        {src ? (
          <img
            src={src}
            alt={name}
            draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <span
            aria-label={name}
            style={{
              display: "grid",
              placeItems: "center",
              width: "100%",
              height: "100%",
              fontWeight: 900,
              fontSize: "calc(0.42 * min(40vh, 40vw))",
              letterSpacing: ".02em",
              color: "#dfe8ff",
              background: `linear-gradient(160deg, color-mix(in srgb, ${accent[0]} 30%, #0c1326), #0c1326)`,
            }}
          >
            {initialsOf(name)}
          </span>
        )}
      </span>
    </span>
  );
}
