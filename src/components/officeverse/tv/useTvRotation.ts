/**
 * Officeverse — the ONE Office TV rotation hook (Phase 10 Stage 3).
 *
 * Owns exactly ONE interval. Every timing decision is delegated to the PURE
 * `rotationTick` reducer in `tv-rotation.ts` — no scattered setTimeout, no
 * per-screen timers. Cleans up on unmount / deps change; a re-render never
 * creates a second interval.
 */
import { useEffect, useRef, useState } from "react";
import {
  INITIAL_ROTATION,
  clampIndex,
  reconcileRotation,
  rotationTick,
  screenSignature,
  type RotationState,
  type TvScreen,
} from "./tv-rotation";

const TICK_MS = 1000;

export interface UseTvRotation {
  screen: TvScreen | null;
  index: number;
  screenCount: number;
}

export function useTvRotation(opts: {
  screens: TvScreen[];
  rotationMs: number;
  /** an interrupt is on screen — hold the current rotation screen */
  paused: boolean;
}): UseTvRotation {
  const { screens, rotationMs, paused } = opts;
  const signature = screenSignature(screens);

  const [state, setState] = useState<RotationState>(INITIAL_ROTATION);
  // live copies for the interval closure — avoids re-creating the interval
  const prevSigRef = useRef(signature);
  const pausedRef = useRef(paused);
  const rotationMsRef = useRef(rotationMs);
  const lenRef = useRef(screens.length);
  pausedRef.current = paused;
  rotationMsRef.current = rotationMs;
  lenRef.current = screens.length;

  // reconcile when the screen SET changes (a screen appeared / disappeared)
  useEffect(() => {
    if (prevSigRef.current === signature) {
      setState((s) => reconcileRotation(s, prevSigRef.current, signature, lenRef.current));
      return;
    }
    prevSigRef.current = signature;
    setState((s) => reconcileRotation(s, "", signature, lenRef.current));
  }, [signature]);

  // exactly one interval for the lifetime of the mount
  useEffect(() => {
    const iv = setInterval(() => {
      setState((s) =>
        rotationTick(s, {
          dtMs: TICK_MS,
          rotationMs: rotationMsRef.current,
          paused: pausedRef.current,
          len: lenRef.current,
        }),
      );
    }, TICK_MS);
    return () => clearInterval(iv);
  }, []);

  const len = screens.length;
  const index = clampIndex(state.index, len);
  return {
    screen: len > 0 ? (screens[index] ?? null) : null,
    index,
    screenCount: len,
  };
}
