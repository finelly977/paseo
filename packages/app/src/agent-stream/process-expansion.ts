import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MOTION_DURATION } from "@/styles/motion";
import { isWeb } from "@/constants/platform";
import { useReducedMotionPreference } from "@/hooks/use-reduced-motion";
import type { StreamItem } from "@/types/stream";
import { findLiveProcessExit, type CompletedTurnProcessModel } from "./completed-turn-process";

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
          (expanded.has(turnId) ? MOTION_DURATION.instant : 16),
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

/** 退场先保留现有过程行，再一次性提交最终折叠投影。 */
export function useLiveProcessExit({
  agentId,
  activeTurnId,
  isRunning,
  isActive,
  model,
  tail,
  head,
}: {
  agentId: string;
  activeTurnId: string | null;
  isRunning: boolean;
  isActive: boolean;
  model: CompletedTurnProcessModel;
  tail: readonly StreamItem[];
  head: readonly StreamItem[];
}) {
  const reducedMotion = useReducedMotionPreference();
  const watchedTurn = useRef<{ agentId: string; turnId: string } | null>(null);
  const [finishedTurn, setFinishedTurn] = useState<string | null>(null);
  const canAnimate = isWeb && isActive && !reducedMotion;
  useLayoutEffect(() => {
    if (!canAnimate) watchedTurn.current = null;
    else if (isRunning && activeTurnId) watchedTurn.current = { agentId, turnId: activeTurnId };
  }, [activeTurnId, agentId, canAnimate, isRunning]);

  const watched = watchedTurn.current;
  const providerTurnId =
    canAnimate && !isRunning && watched?.agentId === agentId && watched.turnId !== finishedTurn
      ? watched.turnId
      : null;
  return useMemo(() => {
    if (!providerTurnId) return { model, exit: null };
    const exit = findLiveProcessExit(providerTurnId, model, [head, tail]);
    if (!exit) return { model, exit: null };
    return {
      model: {
        turnIdByProcessItemId: new Map(
          [...model.turnIdByProcessItemId].filter(([, turnId]) => turnId !== exit.turnId),
        ),
        toggleByItemId: new Map(
          [...model.toggleByItemId].filter(([, toggle]) => toggle.turnId !== exit.turnId),
        ),
      },
      exit: {
        turnId: providerTurnId,
        rowIds: exit.rowIds,
        onFinish: () => setFinishedTurn(providerTurnId),
      },
    };
  }, [head, model, providerTurnId, tail]);
}
