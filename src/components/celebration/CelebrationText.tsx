/**
 * Officeverse — celebration text stack (Phase 6, reworked for TV scale).
 *
 * Visual hierarchy on the TV:
 *   EMPLOYEE NAME   — hero, biggest element
 *   ACHIEVEMENT     — prominent, gradient
 *   +N POINTS       — strong supporting chip (only when points > 0; the number
 *                     comes straight from the payload, never computed here)
 *
 * Each line reveals on its own timeline flag from the scene. PRESENTATION ONLY.
 */
import type { CSSProperties } from "react";

interface Props {
  name: string | null;
  headline: string | null;
  subheadline: string | null;
  points: number;
  accent: readonly [string, string];
  nameScale: number;
  headlineScale: number;
  pointsScale: number;
  reveal: { name: boolean; headline: boolean; points: boolean };
  reduced: boolean;
}

function line(revealed: boolean, reduced: boolean, extra: CSSProperties = {}): CSSProperties {
  return {
    opacity: revealed ? 1 : 0,
    transform: revealed ? "translateY(0)" : "translateY(2.4vh)",
    transition: reduced
      ? "opacity 240ms ease"
      : "transform 520ms cubic-bezier(.16,.9,.3,1), opacity 420ms ease",
    willChange: "transform, opacity",
    margin: 0,
    ...extra,
  };
}

export function CelebrationText({
  name,
  headline,
  subheadline,
  points,
  accent,
  nameScale,
  headlineScale,
  pointsScale,
  reveal,
  reduced,
}: Props) {
  const gradient = `linear-gradient(92deg, ${accent[0]}, ${accent[1]})`;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2vh" }}>
      {name ? (
        <div
          className="cs-name"
          style={line(reveal.name, reduced, {
            fontSize: `clamp(2.4rem, min(${13 * nameScale}vw, ${17 * nameScale}vh), 22rem)`,
          })}
        >
          {name}
        </div>
      ) : null}
      {headline ? (
        <div
          className="cs-headline"
          style={line(reveal.headline, reduced, {
            fontSize: `clamp(1.6rem, min(${6.6 * headlineScale}vw, ${8.4 * headlineScale}vh), 12rem)`,
            backgroundImage: gradient,
          })}
        >
          {headline}
        </div>
      ) : null}
      {subheadline ? (
        <div
          className="cs-sub"
          style={line(reveal.headline, reduced, { fontSize: "clamp(.9rem, min(2.8vw,3vh), 3rem)" })}
        >
          {subheadline}
        </div>
      ) : null}
      {points > 0 ? (
        <div
          className="cs-points"
          style={line(reveal.points, reduced, {
            fontSize: `clamp(1.4rem, min(${5.4 * pointsScale}vw, ${6.6 * pointsScale}vh), 9rem)`,
            transform: reveal.points ? "scale(1)" : "scale(.8)",
          })}
        >
          +{points.toLocaleString()} <span className="cs-points-unit">POINTS</span>
        </div>
      ) : null}
    </div>
  );
}
