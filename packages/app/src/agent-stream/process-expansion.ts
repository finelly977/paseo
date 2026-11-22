import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MOTION_DURATION } from "@/styles/motion";
import { isWeb } from "@/constants/platform";
import { useReducedMotionPreference } from "@/hooks/use-reduced-motion";
import type { StreamItem } from "@/types/stream";
import { findLiveProcessExit, type CompletedTurnProcessModel } from "./completed-turn-process";

const MAX_EXPAND_TRANSITION_ITEMS = 32;
const CONSERVATIVE_PROCESS_ROW_HEIGHT_PX = 36;
const EXPAND_VIEWPORT_BUFFER_PX = 160;
const COLLAPSE_VIEWPORT_OVERSCAN_PX = 40;

function resolveScrollContainerFromAnchor(anchorNode: unknown): HTMLElement | null {
  if (typeof HTMLElement === "undefined" || !(anchorNode instanceof HTMLElement)) {
    return null;
  }
  return anchorNode.closest<HTMLElement>('[data-testid="agent-chat-scroll"]');
}

function resolveViewportHeight(scroll: HTMLElement | null): number {
  if (scroll && scroll.clientHeight > 0) return scroll.clientHeight;
  if (typeof window !== "undefined" && window.innerHeight > 0) return window.innerHeight;
  return 900;
}

function selectLeadingExpandProcessItemIds(input: {
  orderedItems: readonly StreamItem[];
  anchorItemId: string;
  scroll: HTMLElement | null;
  estimateHeight: (item: StreamItem) => number;
}): ReadonlySet<string> | undefined {
  const budget = Math.max(resolveViewportHeight(input.scroll), 600) + EXPAND_VIEWPORT_BUFFER_PX;
  const selected = new Set<string>([input.anchorItemId]);
  let coveredHeight = 0;
  let selectedCount = 0;
  for (const item of input.orderedItems) {
    selected.add(item.id);
    selectedCount += 1;
    coveredHeight += Math.min(input.estimateHeight(item), CONSERVATIVE_PROCESS_ROW_HEIGHT_PX);
    if (coveredHeight >= budget || selectedCount >= MAX_EXPAND_TRANSITION_ITEMS) {
      break;
    }
  }
  return selectedCount >= input.orderedItems.length ? undefined : selected;
}

function selectVisibleCollapseProcessItemIds(input: {
  orderedItems: readonly StreamItem[];
  anchorItemId: string;
  scroll: HTMLElement | null;
}): ReadonlySet<string> | undefined {
  if (!input.scroll) return undefined;
  const viewportBottom = input.scroll.getBoundingClientRect().bottom;
  const selected = new Set<string>([input.anchorItemId]);
  let selectedCount = 0;
  let sawAnyMountedRow = false;
  let sawVisible = false;
  for (const item of input.orderedItems) {
    const row = input.scroll.querySelector<HTMLElement>(
      `[data-stream-row-id="${CSS.escape(item.id)}"]`,
    );
    if (!row) {
      if (sawVisible) break;
      continue;
    }
    sawAnyMountedRow = true;
    const rect = row.getBoundingClientRect();
    if (rect.top < viewportBottom + COLLAPSE_VIEWPORT_OVERSCAN_PX) {
      selected.add(item.id);
      selectedCount += 1;
      sawVisible = true;
      if (rect.bottom >= viewportBottom) break;
    } else if (sawVisible) {
      break;
    }
  }
  if (!sawAnyMountedRow) return undefined;
  return selectedCount >= input.orderedItems.length ? undefined : selected;
}

/** 网页超长过程展开时先挂载覆盖首屏的批次，收起时立即裁掉屏外尾段，避免占位跳闪与空白墙。 */
export function selectProcessTransitionVisibleItemIds(input: {
  action: "expand" | "collapse";
  orderedItems: readonly StreamItem[];
  anchorItemId: string;
  anchorNode: unknown;
  estimateHeight: (item: StreamItem) => number;
}): ReadonlySet<string> | undefined {
  if (!isWeb || input.orderedItems.length === 0) return undefined;
  const scroll = resolveScrollContainerFromAnchor(input.anchorNode);
  if (input.action === "expand") {
    return selectLeadingExpandProcessItemIds({
      orderedItems: input.orderedItems,
      anchorItemId: input.anchorItemId,
      scroll,
      estimateHeight: input.estimateHeight,
    });
  }
  return selectVisibleCollapseProcessItemIds({
    orderedItems: input.orderedItems,
    anchorItemId: input.anchorItemId,
    scroll,
  });
}

function initialExpansion(owner: string) {
  return {
    owner,
    expanded: new Set<string>(),
    retained: new Set<string>(),
    transitioning: new Set<string>(),
    transitionVisibleItemIds: new Map<string, ReadonlySet<string>>(),
  };
}

export interface ToggleProcessExpansionOptions {
  /** 过渡期间仅保留首屏可见的过程行，避免超长过程展开闪烁或收起露出空白占位。 */
  visibleItemIds?: ReadonlySet<string>;
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
  const toggle = useCallback((turnId: string, options?: ToggleProcessExpansionOptions) => {
    const previous = stateRef.current;
    const expanded = new Set(previous.expanded);
    if (expanded.has(turnId)) expanded.delete(turnId);
    else expanded.add(turnId);
    const transitionVisibleItemIds = new Map(previous.transitionVisibleItemIds);
    if (options?.visibleItemIds) {
      transitionVisibleItemIds.set(turnId, options.visibleItemIds);
    } else {
      transitionVisibleItemIds.delete(turnId);
    }
    const next = {
      ...previous,
      expanded,
      retained: new Set(previous.retained).add(turnId),
      transitioning: new Set(previous.transitioning).add(turnId),
      transitionVisibleItemIds,
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
          const settledVisibleItemIds = new Map(latest.transitionVisibleItemIds);
          settledVisibleItemIds.delete(turnId);
          const settled = {
            ...latest,
            retained,
            transitioning,
            transitionVisibleItemIds: settledVisibleItemIds,
          };
          stateRef.current = settled;
          setState(settled);
        },
        // 收起同样留足 MOTION_DURATION.instant 余量，避免定时器抢在 120ms Web Animation
        // 真正归零前提前卸载过程行，造成尾部顿挫。
        (expanded.has(turnId) ? MOTION_DURATION.base : MOTION_DURATION.fast) +
          MOTION_DURATION.instant,
      ),
    );
  }, []);
  return {
    expandedTurnIds: current.expanded,
    retainedTurnIds: current.retained,
    transitioningTurnIds: current.transitioning,
    transitionVisibleItemIds: current.transitionVisibleItemIds,
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
