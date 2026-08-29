import { useEffect, useRef } from "react";
import { resolveEffect, type PhotoEffectId } from "@/lib/officeverse/photo-effects";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * The VISUAL LAYER for a real photo (Phase 19). Renders a frame / ring / glow
 * around `children` (the photo or initials fallback) plus an optional
 * lightweight <canvas> particle burst. It NEVER receives or mutates the image
 * bytes — it only decorates whatever is passed as `children`.
 *
 * `prefers-reduced-motion` → the static `reducedMotion` variant, no canvas.
 * All timers / animation frames are cleaned up on unmount.
 */
export function PhotoEffect({
  effect,
  active = true,
  /** 0 = show the static frame forever (normal profile); >0 = burst then settle */
  burstMs,
  className,
  children,
}: {
  effect: PhotoEffectId | string | null | undefined;
  active?: boolean;
  burstMs?: number | undefined;
  className?: string;
  children: React.ReactNode;
}) {
  const cfg = resolveEffect(effect ?? null);
  const reduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const stopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ring = reduced ? cfg.reducedMotion.ringClass : cfg.ringClass;
  const glow = reduced ? cfg.reducedMotion.glow : cfg.glow;
  const particle = reduced ? "none" : cfg.particle;
  const wantParticles = active && particle !== "none";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!wantParticles || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = (canvas.width = canvas.clientWidth * dpr);
    const h = (canvas.height = canvas.clientHeight * dpr);
    const COLORS =
      particle === "coins"
        ? ["#1a9c5b", "#37c47f", "#c9a227"]
        : particle === "colour-splash"
          ? ["#ff4da6", "#ffcf3f", "#3fd0ff", "#7cff6b", "#b57bff"]
          : particle === "fireworks"
            ? ["#ffd24d", "#ff7a59", "#7cc4ff", "#ffffff"]
            : ["#8ab4ff", "#ffd24d", "#ff7ac7", "#7cff9e"];
    const N = particle === "sparkle" ? 22 : 46;
    type P = { x: number; y: number; vx: number; vy: number; r: number; c: string; life: number };
    const parts: P[] = Array.from({ length: N }, () => ({
      x: w / 2,
      y: h / 2,
      vx: (Math.random() - 0.5) * (particle === "coins" ? 3 : 6) * dpr,
      vy: (Math.random() - (particle === "coins" ? 0.1 : 0.6)) * 6 * dpr,
      r: (particle === "sparkle" ? 1.5 : 2.5 + Math.random() * 2) * dpr,
      c: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      life: 1,
    }));

    const started = performance.now();
    const total = burstMs && burstMs > 0 ? burstMs : cfg.durationMs;
    const tick = (now: number) => {
      const t = now - started;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12 * dpr; // gravity
        p.life = Math.max(0, 1 - t / total);
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (t < total) rafRef.current = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      ctx.clearRect(0, 0, w, h);
    };
  }, [wantParticles, particle, burstMs, cfg.durationMs]);

  // if a finite burst is requested, stop treating it as "active" afterwards
  useEffect(() => {
    if (!active || !burstMs || burstMs <= 0) return;
    stopRef.current = setTimeout(() => {
      /* the canvas effect self-clears; nothing else to do */
    }, burstMs + 50);
    return () => {
      if (stopRef.current) clearTimeout(stopRef.current);
      stopRef.current = null;
    };
  }, [active, burstMs]);

  return (
    <span className={cn("ov-photo-fx", className)} data-effect={cfg.id}>
      <span
        className={cn("ov-photo-fx-glow", active && !reduced && cfg.animateClass)}
        style={{ background: glow }}
        aria-hidden
      />
      <span className={cn("ov-photo-fx-ring overflow-hidden ring-inset", ring)}>{children}</span>
      {wantParticles ? <canvas ref={canvasRef} className="ov-photo-fx-canvas" aria-hidden /> : null}
      {cfg.badge ? (
        <span className="ov-photo-fx-badge" aria-hidden>
          {cfg.badge}
        </span>
      ) : null}
    </span>
  );
}
