import { useCallback, useEffect, useRef, useState } from "react";
import { EVENT_REACTION, type CharacterEvent } from "@/lib/officeverse/avatar";
import type { CharacterPose, Expression } from "@/lib/officeverse/types";

/**
 * Reusable visual-reaction infrastructure for OfficeCharacter.
 * `react(event)` briefly switches pose/expression, then reverts to the base state.
 * No business events are wired here — call sites decide when (and if) to trigger.
 */
export function useCharacterReaction(base: { pose?: CharacterPose; expression?: Expression } = {}) {
  const basePose = base.pose ?? "idle";
  const baseExpression = base.expression ?? "neutral";

  const [state, setState] = useState<{ pose: CharacterPose; expression: Expression }>({
    pose: basePose,
    expression: baseExpression,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const react = useCallback(
    (event: CharacterEvent, holdMs = 2600) => {
      const next = EVENT_REACTION[event];
      setState(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(
        () => setState({ pose: basePose, expression: baseExpression }),
        holdMs,
      );
    },
    [basePose, baseExpression],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { pose: state.pose, expression: state.expression, react };
}
