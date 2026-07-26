import type { TurnTiming } from "@/timeline/turn-time";
import type { StreamItem } from "@/types/stream";
import { getAssistantBlockSpacing, getGapBetweenStreamItems } from "./spacing";
import type { StreamFrameChildOrder, StreamStrategy } from "./strategy";

export type StreamToolSequence = "single" | "first" | "middle" | "last" | "none";

export interface TurnFooterHost {
  itemId: string;
  items: StreamItem[];
  timing?: TurnTiming;
  startIndex: number;
  processItemIds: string[];
}

export interface StreamLayoutItem {
  item: StreamItem;
  index: number;
  items: StreamItem[];
  aboveItem: StreamItem | null;
  belowItem: StreamItem | null;
  gapBelow: number;
  assistantSpacing: "default" | "compactTop" | "compactBottom" | "compactBoth";
  completedFooter: TurnFooterHost | null;
  toolSequence: StreamToolSequence;
  isFirstInUserGroup: boolean;
  isLastInUserGroup: boolean;
  isLastInToolSequence: boolean;
  frameOrder: StreamFrameChildOrder;
}

export interface StreamLayout {
  history: StreamLayoutItem[];
  liveHead: StreamLayoutItem[];
  auxiliaryTurnFooter: TurnFooterHost | null;
}

export interface StreamLayoutInput {
  strategy: StreamStrategy;
  agentStatus: string;
  history: StreamItem[];
  liveHead: StreamItem[];
  timingByAssistantId: Map<string, TurnTiming>;
}

interface LayoutSegmentInput {
  strategy: StreamStrategy;
  items: StreamItem[];
  timingByAssistantId: Map<string, TurnTiming>;
  auxiliaryTurnFooter: TurnFooterHost | null;
  frameOrder: StreamFrameChildOrder;
  boundaryIndex: number | null;
  boundaryAboveItem: StreamItem | null;
  boundaryBelowItem: StreamItem | null;
  boundaryAboveItems: StreamItem[] | null;
  boundaryAboveIndex: number | null;
}

interface AssistantFooterSource {
  item: Extract<StreamItem, { kind: "assistant_message" }>;
  items: StreamItem[];
  index: number;
}

function createTurnFooterHost(input: {
  strategy: StreamStrategy;
  item: StreamItem;
  items: StreamItem[];
  index: number;
  processItems: StreamItem[];
  turnEndIndex: number;
  processBoundaryAboveItems?: StreamItem[] | null;
  processBoundaryAboveIndex?: number | null;
  timingByAssistantId: Map<string, TurnTiming>;
}): TurnFooterHost {
  return {
    itemId: input.item.id,
    items: input.items,
    timing: input.timingByAssistantId.get(input.item.id),
    startIndex: input.index,
    processItemIds: collectCompletedTurnProcessItemIds({
      strategy: input.strategy,
      items: input.processItems,
      finalAssistant: input.item,
      turnEndIndex: input.turnEndIndex,
      boundaryAboveItems: input.processBoundaryAboveItems,
      boundaryAboveIndex: input.processBoundaryAboveIndex,
    }),
  };
}

export function collectCompletedTurnProcessItemIds(input: {
  strategy: StreamStrategy;
  items: StreamItem[];
  finalAssistant: StreamItem;
  turnEndIndex: number;
  boundaryAboveItems?: StreamItem[] | null;
  boundaryAboveIndex?: number | null;
}): string[] {
  const processItemIds: string[] = [];
  const finalAssistantBlockGroupId =
    input.finalAssistant.kind === "assistant_message"
      ? input.finalAssistant.blockGroupId
      : undefined;
  let items = input.items;
  let index = input.turnEndIndex;
  let canCrossBoundary = true;

  while (true) {
    for (
      ;
      index >= 0 && index < items.length;
      index = input.strategy.getNeighborIndex(index, "above")
    ) {
      const item = items[index];
      if (!item || item.kind === "user_message") {
        return processItemIds;
      }
      const isFailureItem =
        (item.kind === "activity_log" && item.activityType === "error") ||
        (item.kind === "assistant_message" && item.text.trimStart().startsWith("[System Error]"));
      if (isFailureItem) {
        return [];
      }
      const belongsToFinalAssistantBlockGroup =
        finalAssistantBlockGroupId !== undefined &&
        item.kind === "assistant_message" &&
        item.blockGroupId === finalAssistantBlockGroupId;
      if (item.id !== input.finalAssistant.id && !belongsToFinalAssistantBlockGroup) {
        processItemIds.push(item.id);
      }
    }

    if (
      !canCrossBoundary ||
      !input.boundaryAboveItems ||
      input.boundaryAboveIndex === null ||
      input.boundaryAboveIndex === undefined
    ) {
      return processItemIds;
    }

    items = input.boundaryAboveItems;
    index = input.boundaryAboveIndex;
    canCrossBoundary = false;
  }
}

function findLatestAssistantInTurn(input: {
  strategy: StreamStrategy;
  items: StreamItem[];
  startIndex: number;
  boundaryAboveItems?: StreamItem[] | null;
  boundaryAboveIndex?: number | null;
}): AssistantFooterSource | null {
  let items = input.items;
  let index = input.startIndex;
  let canCrossBoundary = true;

  while (true) {
    for (
      ;
      index >= 0 && index < items.length;
      index = input.strategy.getNeighborIndex(index, "above")
    ) {
      const item = items[index];
      if (!item || item.kind === "user_message") {
        return null;
      }
      if (item.kind === "assistant_message") {
        return { item, items, index };
      }
    }

    if (
      !canCrossBoundary ||
      !input.boundaryAboveItems ||
      input.boundaryAboveIndex === null ||
      input.boundaryAboveIndex === undefined
    ) {
      return null;
    }

    items = input.boundaryAboveItems;
    index = input.boundaryAboveIndex;
    canCrossBoundary = false;
  }
}

function resolveAuxiliaryTurnFooter(input: StreamLayoutInput): TurnFooterHost | null {
  if (input.agentStatus === "running") {
    return null;
  }

  const footerItems = input.liveHead.length > 0 ? input.liveHead : input.history;
  const latestIndex = input.strategy.getLatestItemIndex(footerItems);
  if (latestIndex === null) {
    return null;
  }
  const boundaryAboveItems = input.liveHead.length > 0 ? input.history : null;
  const boundaryAboveIndex = boundaryAboveItems
    ? input.strategy.getHistoryLiveBoundaryIndex(boundaryAboveItems)
    : null;

  const assistant = findLatestAssistantInTurn({
    strategy: input.strategy,
    items: footerItems,
    startIndex: latestIndex,
    boundaryAboveItems,
    boundaryAboveIndex,
  });
  if (!assistant) {
    return null;
  }

  return createTurnFooterHost({
    strategy: input.strategy,
    item: assistant.item,
    items: assistant.items,
    index: assistant.index,
    processItems: footerItems,
    turnEndIndex: latestIndex,
    processBoundaryAboveItems: boundaryAboveItems,
    processBoundaryAboveIndex: boundaryAboveIndex,
    timingByAssistantId: input.timingByAssistantId,
  });
}

function resolveCompletedFooter(input: {
  strategy: StreamStrategy;
  items: StreamItem[];
  index: number;
  item: StreamItem;
  belowItem: StreamItem | null;
  timingByAssistantId: Map<string, TurnTiming>;
  auxiliaryTurnFooter: TurnFooterHost | null;
  boundaryAboveItems: StreamItem[] | null;
  boundaryAboveIndex: number | null;
}): TurnFooterHost | null {
  if (input.item.kind === "user_message" || input.belowItem?.kind !== "user_message") {
    return null;
  }

  const assistant = findLatestAssistantInTurn({
    strategy: input.strategy,
    items: input.items,
    startIndex: input.index,
    boundaryAboveItems: input.boundaryAboveItems,
    boundaryAboveIndex: input.boundaryAboveIndex,
  });
  if (!assistant || input.auxiliaryTurnFooter?.itemId === assistant.item.id) {
    return null;
  }
  return createTurnFooterHost({
    strategy: input.strategy,
    item: assistant.item,
    items: assistant.items,
    index: assistant.index,
    processItems: input.items,
    turnEndIndex: input.index,
    processBoundaryAboveItems: input.boundaryAboveItems,
    processBoundaryAboveIndex: input.boundaryAboveIndex,
    timingByAssistantId: input.timingByAssistantId,
  });
}

function isToolSequenceItem(
  item: StreamItem | null,
): item is Extract<StreamItem, { kind: "tool_call" | "thought" | "todo_list" }> {
  return item?.kind === "tool_call" || item?.kind === "thought" || item?.kind === "todo_list";
}

function getToolSequence(input: {
  item: StreamItem;
  aboveItem: StreamItem | null;
  belowItem: StreamItem | null;
}): StreamToolSequence {
  if (!isToolSequenceItem(input.item)) {
    return "none";
  }

  const hasAbove = isToolSequenceItem(input.aboveItem);
  const hasBelow = isToolSequenceItem(input.belowItem);
  if (hasAbove && hasBelow) {
    return "middle";
  }
  if (hasAbove) {
    return "last";
  }
  if (hasBelow) {
    return "first";
  }
  return "single";
}

function getSegmentNeighbor(input: {
  strategy: StreamStrategy;
  items: StreamItem[];
  index: number;
  relation: "above" | "below";
  boundaryIndex: number | null;
  boundaryItem: StreamItem | null;
}): StreamItem | null {
  const neighbor = input.strategy.getNeighborItem(input.items, input.index, input.relation);
  if (neighbor) {
    return neighbor;
  }
  if (input.index === input.boundaryIndex) {
    return input.boundaryItem;
  }
  return null;
}

function layoutSegment(input: LayoutSegmentInput): StreamLayoutItem[] {
  return input.items.map((item, index) => {
    const aboveItem = getSegmentNeighbor({
      strategy: input.strategy,
      items: input.items,
      index,
      relation: "above",
      boundaryIndex: input.boundaryIndex,
      boundaryItem: input.boundaryAboveItem,
    });
    const belowItem = getSegmentNeighbor({
      strategy: input.strategy,
      items: input.items,
      index,
      relation: "below",
      boundaryIndex: input.boundaryIndex,
      boundaryItem: input.boundaryBelowItem,
    });
    const assistantSpacing = getAssistantBlockSpacing({
      item,
      aboveItem,
      belowItem,
    });
    const completedFooter = resolveCompletedFooter({
      strategy: input.strategy,
      items: input.items,
      index,
      item,
      belowItem,
      timingByAssistantId: input.timingByAssistantId,
      auxiliaryTurnFooter: input.auxiliaryTurnFooter,
      boundaryAboveItems: input.boundaryAboveItems,
      boundaryAboveIndex: input.boundaryAboveIndex,
    });

    return {
      item,
      index,
      items: input.items,
      aboveItem,
      belowItem,
      gapBelow: completedFooter ? 0 : getGapBetweenStreamItems(item, belowItem),
      assistantSpacing,
      completedFooter,
      toolSequence: getToolSequence({ item, aboveItem, belowItem }),
      isFirstInUserGroup: item.kind === "user_message" && aboveItem?.kind !== "user_message",
      isLastInUserGroup: item.kind === "user_message" && belowItem?.kind !== "user_message",
      isLastInToolSequence: isToolSequenceItem(item) && !isToolSequenceItem(belowItem),
      frameOrder: input.frameOrder,
    };
  });
}

// Keyed by history array identity; inner key encodes the inputs that affect history layout.
// History layout is stable across text-chunk flushes because the liveHead boundary item's
// kind and id don't change when only its text grows.
const historyLayoutCache = new WeakMap<StreamItem[], Map<string, StreamLayoutItem[]>>();

export function layoutStream(input: StreamLayoutInput): StreamLayout {
  const auxiliaryTurnFooter = resolveAuxiliaryTurnFooter(input);
  const historyBoundaryIndex = input.strategy.getHistoryLiveBoundaryIndex(input.history);
  const liveHeadBoundaryIndex = input.strategy.getLiveHeadHistoryBoundaryIndex(input.liveHead);
  const historyBoundaryItem =
    historyBoundaryIndex === null ? null : (input.history[historyBoundaryIndex] ?? null);
  const liveHeadBoundaryItem =
    liveHeadBoundaryIndex === null ? null : (input.liveHead[liveHeadBoundaryIndex] ?? null);
  const frameOrder = input.strategy.getFrameChildOrder();

  let history: StreamLayoutItem[];
  if (input.history.length > 0) {
    // The cache key encodes every input that can change history layout. liveHeadBoundaryItem.id
    // and .kind are stable across text-only flushes (text growth doesn't change what kind of
    // item borders history), so cached layout stays valid between flushes.
    const historyCacheKey = [
      frameOrder,
      historyBoundaryIndex ?? "null",
      liveHeadBoundaryItem?.id ?? "null",
      liveHeadBoundaryItem?.kind ?? "null",
      auxiliaryTurnFooter?.itemId ?? "null",
    ].join(":");
    let byKey = historyLayoutCache.get(input.history);
    if (!byKey) {
      byKey = new Map();
      historyLayoutCache.set(input.history, byKey);
    }
    const cached = byKey.get(historyCacheKey);
    if (cached) {
      history = cached;
    } else {
      history = layoutSegment({
        strategy: input.strategy,
        items: input.history,
        timingByAssistantId: input.timingByAssistantId,
        auxiliaryTurnFooter,
        frameOrder,
        boundaryIndex: historyBoundaryIndex,
        boundaryAboveItem: null,
        boundaryBelowItem: liveHeadBoundaryItem,
        boundaryAboveItems: null,
        boundaryAboveIndex: null,
      });
      byKey.set(historyCacheKey, history);
    }
  } else {
    history = [];
  }

  const liveHead = layoutSegment({
    strategy: input.strategy,
    items: input.liveHead,
    timingByAssistantId: input.timingByAssistantId,
    auxiliaryTurnFooter,
    frameOrder,
    boundaryIndex: liveHeadBoundaryIndex,
    boundaryAboveItem: historyBoundaryItem,
    boundaryBelowItem: null,
    boundaryAboveItems: input.history,
    boundaryAboveIndex: historyBoundaryIndex,
  });

  return {
    history,
    liveHead,
    auxiliaryTurnFooter,
  };
}
