import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MOTION_DURATION } from "@/styles/motion";

function initialExpansion(owner: string) {
  return {
    owner,
    expanded: new Set<string>(),
    retained: new Set<string>(),
    transitioning: new Set<string>(),
  };
}

/** 收起动画结束后才释放过程行；不把整轮历史挂到同一个限高容器。 */
export function useProcessExpansion(owner: string) {
  const [state, setState] = useState(() => initialExpansion(owner));
  const current = useMemo(
    () => (state.owner === owner ? state : initialExpansion(owner)),
    [owner, state],
  );
  const stateRef = useRef(current);
  stateRef.current = current;
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, [owner]);
  const toggle = useCallback((turnId: string) => {
    const previous = stateRef.current;
    const expanded = new Set(previous.expanded);
    if (expanded.has(turnId)) expanded.delete(turnId);
    else expanded.add(turnId);
    const next = {
      ...previous,
      expanded,
      retained: new Set(previous.retained).add(turnId),
      transitioning: new Set(previous.transitioning).add(turnId),
    };
    const oldTimer = timers.current.get(turnId);
    if (oldTimer !== undefined) clearTimeout(oldTimer);
    stateRef.current = next;
    setState(next);
    timers.current.set(
      turnId,
      setTimeout(
        () => {
          timers.current.delete(turnId);
          const latest = stateRef.current;
          if (latest.owner !== previous.owner) return;
          const retained = new Set(latest.retained);
          if (!latest.expanded.has(turnId)) retained.delete(turnId);
          const transitioning = new Set(latest.transitioning);
          transitioning.delete(turnId);
          const settled = { ...latest, retained, transitioning };
          stateRef.current = settled;
          setState(settled);
        },
        (expanded.has(turnId) ? MOTION_DURATION.base : MOTION_DURATION.fast) +
          MOTION_DURATION.instant,
      ),
    );
  }, []);
  return {
    expandedTurnIds: current.expanded,
    retainedTurnIds: current.retained,
    transitioningTurnIds: current.transitioning,
    toggle,
  };
}
