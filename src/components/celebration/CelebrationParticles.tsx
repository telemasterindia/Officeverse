/**
 * Officeverse — celebration particle layer (Phase 6, reworked for TV scale).
 *
 * ONE <canvas>, ONE requestAnimationFrame loop. FINITE: every particle has a
 * limited life; the loop STOPS itself once all particles are dead (or on
 * unmount, or when `run` goes false). No infinite animation, no accumulating
 * canvases, one resize listener that is removed on cleanup.
 *
 * Reworked so the effect is actually VISIBLE on a large screen:
 *   - full-spectrum colour (not a single accent hue)
 *   - larger pieces (confetti 14–34px) and higher counts
 *   - an ignition SPRAY from the centre + a sustained confetti fall from the top
 *   - continuous emission across ~75% of the scene
 *
 * PRESENTATION ONLY — no prop influences any business value.
 */
import { useEffect, useRef } from "react";
import type { ParticleKind } from "./celebration-visuals";

interface Props {
  kind: ParticleKind;
  count: number;
  /** gradient accent stops — mixed into the palette */
  accent: readonly [string, string];
  /** false → stop spawning and let existing particles die out */
  run: boolean;
  /** total scene time (ms) — particles never outlive it */
  durationMs: number;
}

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  drag: number;
  rot: number;
  vrot: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
  shape: "rect" | "circle" | "ribbon" | "glyph";
  glyph?: string;
}

// a broad, non-childish broadcast palette
const CONFETTI = [
  "#4C8DFF",
  "#22D3EE",
  "#7C5CFF",
  "#34F5C5",
  "#FFC64B",
  "#FF7A59",
  "#FF5DA2",
  "#FFFFFF",
];
const FIREWORKS = ["#FFC64B", "#FF7A59", "#7C5CFF", "#4C8DFF", "#34F5C5", "#FFFFFF"];
const HERO = ["#FFC64B", "#FF7A59", "#FFFFFF", "#34F5C5", "#FF5DA2"];
const DOLLARS = ["#7CF5C4", "#3ddc97", "#d6ffe9"];

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function CelebrationParticles({ kind, count, accent, run, durationMs }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!run || kind === "none" || count <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let stopped = false;
    let spawning = true;
    const startedAt = performance.now();
    const particles: P[] = [];
    const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);

    const W = () => canvas.clientWidth || window.innerWidth;
    const H = () => canvas.clientHeight || window.innerHeight;

    const resize = () => {
      const w = W();
      const h = H();
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const palette =
      kind === "fireworks"
        ? FIREWORKS
        : kind === "hero"
          ? HERO
          : kind === "dollars"
            ? DOLLARS
            : [...CONFETTI, accent[0], accent[1]];

    /** confetti falling from the top edge */
    function spawnFall(n: number) {
      const w = W();
      for (let i = 0; i < n; i++) {
        particles.push({
          x: rand(0, w),
          y: rand(-60, -8),
          vx: rand(-90, 90),
          vy: rand(90, 260),
          g: 120,
          drag: 0.992,
          rot: rand(0, Math.PI * 2),
          vrot: rand(-9, 9),
          size: rand(14, 34),
          life: 0,
          maxLife: rand(2.6, 4.6),
          color: pick(palette),
          shape: Math.random() < 0.42 ? "rect" : Math.random() < 0.7 ? "ribbon" : "circle",
        });
      }
    }

    /** radial spray from a point (centre by default) */
    function spawnSpray(n: number, cx: number, cy: number, spd: [number, number], big: boolean) {
      const jit = W() * 0.06;
      for (let i = 0; i < n; i++) {
        const ang = rand(0, Math.PI * 2);
        const s = rand(spd[0], spd[1]);
        particles.push({
          x: cx + rand(-jit, jit),
          y: cy + rand(-jit, jit),
          vx: Math.cos(ang) * s,
          vy: Math.sin(ang) * s - rand(20, 120),
          g: big ? 220 : 320,
          drag: 0.985,
          rot: ang,
          vrot: rand(-12, 12),
          size: big ? rand(6, 14) : rand(4, 9),
          life: 0,
          maxLife: rand(1.1, 2.4),
          color: pick(palette),
          shape: Math.random() < 0.3 ? "ribbon" : "circle",
        });
      }
    }

    function spawnDollars(n: number) {
      const w = W();
      const h = H();
      for (let i = 0; i < n; i++) {
        particles.push({
          x: rand(0, w),
          y: rand(-h * 0.4, -10),
          vx: rand(-24, 24),
          vy: rand(110, 240),
          g: 60,
          drag: 0.995,
          rot: rand(0, Math.PI * 2),
          vrot: rand(-2.4, 2.4),
          size: rand(24, 46),
          life: 0,
          maxLife: rand(2.6, 4.4),
          color: pick(palette),
          shape: "glyph",
          glyph: "$",
        });
      }
    }

    // ---- ignition ----
    if (kind === "dollars") {
      spawnDollars(Math.round(count * 0.6));
    } else if (kind === "fireworks" || kind === "hero") {
      const cx = W() / 2;
      const cy = H() * (kind === "hero" ? 0.46 : 0.42);
      spawnSpray(count, cx, cy, kind === "hero" ? [260, 720] : [200, 560], true);
    } else {
      // confetti: a centre spray to "pop" + a first wave of top-edge fall
      spawnSpray(Math.round(count * 0.4), W() / 2, H() * 0.5, [220, 620], false);
      spawnFall(Math.round(count * 0.5));
    }

    let lastSpawn = startedAt;
    let prev = startedAt;

    const frame = (now: number) => {
      if (stopped) return;
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const elapsed = now - startedAt;

      // sustained emission for the slow-falling types across ~75% of the scene
      if (
        spawning &&
        (kind === "confetti" || kind === "dollars") &&
        elapsed < durationMs * 0.75 &&
        now - lastSpawn > 90
      ) {
        if (kind === "dollars") spawnDollars(Math.max(4, Math.round(count * 0.04)));
        else spawnFall(Math.max(6, Math.round(count * 0.06)));
        lastSpawn = now;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const h = H();
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        p.life += dt;
        if (p.life >= p.maxLife || p.y > h + 80 || elapsed > durationMs + 500) {
          particles.splice(i, 1);
          continue;
        }
        p.vy += p.g * dt;
        p.vx *= p.drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;

        const k = 1 - p.life / p.maxLife;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, k * 1.6));
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.shape === "glyph") {
          ctx.font = `800 ${p.size}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(p.glyph ?? "$", 0, 0);
        } else if (p.shape === "rect") {
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size / 1.5);
        } else if (p.shape === "ribbon") {
          const wob = Math.sin(p.life * 9) * p.size * 0.5;
          ctx.fillRect(-p.size * 1.6, -p.size / 4 + wob, p.size * 3.2, p.size / 2);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (particles.length === 0 && !spawning) {
        stopped = true;
        return; // loop ends — nothing left to draw
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      stopped = true;
      spawning = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      particles.length = 0;
      try {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } catch {
        /* noop */
      }
    };
  }, [kind, count, accent, run, durationMs]);

  if (!run || kind === "none" || count <= 0) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    />
  );
}
