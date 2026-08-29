import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import type { AvatarConfig, CharacterPose, Expression } from "@/lib/officeverse/types";
import { cn } from "@/lib/utils";

/**
 * The hero avatar. Renders the real-time 3D pipeline (React Three Fiber) —
 * a code-built stylised 3D figure by default, or the rigged .glb from
 * avatar-3d-config.ts once one is supplied. Client-only; on SSR, while the
 * WebGL chunk loads, or on any WebGL failure it shows `fallback` (the SVG
 * character). Small avatar chips keep the SVG renderer by design.
 */

// Code-split: the three.js / R3F chunk loads only on pages that mount a hero
// avatar, and never on the server.
const Scene = lazy(() => import("./avatar-3d-impl"));

class GlErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(err: unknown) {
    if (typeof console !== "undefined") {
      console.info("[TeleMaster India] 3D avatar unavailable, using SVG fallback.", err);
    }
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function Avatar3D({
  config,
  pose = "idle",
  expression,
  fallback,
  className,
}: {
  config: AvatarConfig;
  pose?: CharacterPose;
  expression?: Expression | undefined;
  /** The SVG character to show when 3D isn't available. Always provide it. */
  fallback: ReactNode;
  className?: string | undefined;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <>{fallback}</>;

  return (
    <div className={cn("relative h-full w-full", className)}>
      <GlErrorBoundary fallback={fallback}>
        <Suspense fallback={fallback}>
          <Scene config={config} pose={pose} expression={expression} />
        </Suspense>
      </GlErrorBoundary>
    </div>
  );
}
