import React, {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  memo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { ActivityIndicator } from "react-native";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
  estimateStreamItemHeight,
  findMountedWindowStart,
  getWebMountedRecentStreamItems,
  shouldAutoLoadOlderHistory,
  visibleWebHistoryItems,
} from "./web-virtualization";
import type { StreamItem } from "@/types/stream";
import { getStreamItemDomId } from "./history-index-model";
import type { StreamRenderInput, StreamStrategy, StreamViewportHandle } from "./strategy";
import { createStreamStrategy } from "./strategy";
import { useContentToggleAnchor } from "./use-content-toggle-anchor";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { MOTION_DURATION, MOTION_EASING_CSS } from "@/styles/motion";
import { createProcessMotion, PROCESS_SCROLL_ANCHOR_VAR } from "./process-motion.web";

interface CreateWebStreamStrategyInput {
  isMobileBreakpoint: boolean;
}

type ScrollBehaviorLike = "auto" | "smooth";

const WEB_BOTTOM_SETTLE_TIMEOUT_MS = 200;
const USER_SCROLL_DELTA_EPSILON = 1;
const ANCHOR_LAYOUT_EPSILON_PX = 0.5;
const BOTTOM_OVERSCROLL_TOLERANCE_PX = 2;
const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 64;
const AUTO_SCROLL_RESUME_THRESHOLD_PX = 1;
const HISTORY_START_THRESHOLD_PX = 96;
const HISTORY_ANCHOR_MAX_FRAMES = 12;
const ITEM_JUMP_MAX_FRAMES = 120;
const ITEM_JUMP_CENTER_TOLERANCE_PX = 2;
const ITEM_JUMP_STABLE_FRAMES = 2;
const USER_DOWNWARD_INPUT_WINDOW_MS = 500;
const PROGRAMMATIC_SCROLL_ECHO_TOLERANCE_PX = 2;

const motionViewportStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  position: "relative",
  display: "flex",
  flexDirection: "column",
};

const motionOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  overflow: "hidden",
  pointerEvents: "none",
};

const historyStartSlotStyle: CSSProperties = {
  position: "sticky",
  top: 4,
  zIndex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: 0,
  pointerEvents: "none",
};

const mountedRowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flexShrink: 0,
  contain: "layout style",
};

function isScrollContainerNearBottom(
  scrollContainer: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">,
  thresholdPx = AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
): boolean {
  const threshold = Number.isFinite(thresholdPx)
    ? Math.max(0, thresholdPx)
    : AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
  const { scrollTop, clientHeight, scrollHeight } = scrollContainer;
  if (![scrollTop, clientHeight, scrollHeight].every(Number.isFinite)) {
    return true;
  }
  const distanceFromBottom = scrollHeight - clientHeight - scrollTop;
  return distanceFromBottom <= threshold;
}

function isScrollContainerAtBottom(
  scrollContainer: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">,
): boolean {
  return isScrollContainerNearBottom(scrollContainer, AUTO_SCROLL_RESUME_THRESHOLD_PX);
}

function scrollElementToBottom(
  scrollContainer: HTMLElement,
  behavior: ScrollBehaviorLike = "auto",
): void {
  scrollContainer.scrollTo({
    top: scrollContainer.scrollHeight,
    behavior,
  });
}

function syncNearBottom(
  scrollContainer: HTMLElement | null,
  onNearBottomChange: (value: boolean) => void,
): boolean {
  if (!scrollContainer) {
    onNearBottomChange(true);
    return true;
  }
  const nextValue = isScrollContainerNearBottom(scrollContainer);
  onNearBottomChange(nextValue);
  return nextValue;
}

function getScrollContainerDistanceFromBottom(
  scrollContainer: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">,
): number {
  return scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop;
}

function isScrollContainerOverscrolledPastBottom(
  scrollContainer: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">,
): boolean {
  // Browser zoom can leave scrollTop fractional while the height metrics remain integer-valued.
  return getScrollContainerDistanceFromBottom(scrollContainer) < -BOTTOM_OVERSCROLL_TOLERANCE_PX;
}

interface HistoryAnchor {
  itemId: string;
  offset: number;
  processId?: string;
  processBodyTurnId?: string;
}

interface PendingHistoryAnchor {
  anchor: HistoryAnchor;
  firstItemId: string | null;
  cursor: string | null;
  sawLoading: boolean;
}

function readHistoryAnchor(scroll: HTMLElement): HistoryAnchor | null {
  const viewportBounds = scroll.getBoundingClientRect();
  for (const row of scroll.querySelectorAll<HTMLElement>("[data-stream-row-id]")) {
    const bounds = row.getBoundingClientRect();
    const itemId = row.dataset.streamRowId;
    if (
      itemId &&
      bounds.height > 0 &&
      bounds.bottom > viewportBounds.top &&
      bounds.top < viewportBounds.bottom
    ) {
      const process = row.querySelector<HTMLElement>('[data-testid^="completed-process-"]');
      if (process) {
        const processBounds = process.getBoundingClientRect();
        const processId = process.dataset.testid;
        if (
          processId &&
          processBounds.height > 0 &&
          processBounds.bottom > viewportBounds.top &&
          processBounds.top < viewportBounds.bottom
        ) {
          return { itemId, offset: processBounds.top - viewportBounds.top, processId };
        }
      }
      return {
        itemId,
        offset: bounds.top - viewportBounds.top,
      };
    }
  }
  return null;
}

function readProcessBodyAnchor(scroll: HTMLElement, turnId: string): HistoryAnchor | null {
  const viewport = scroll.getBoundingClientRect();
  for (const body of scroll.querySelectorAll<HTMLElement>(
    `[data-process-turn-id="${CSS.escape(turnId)}"]`,
  )) {
    const rect = body.getBoundingClientRect();
    const row = body.closest<HTMLElement>("[data-stream-row-id]");
    const itemId = row?.dataset.streamRowId;
    if (itemId && rect.height > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom) {
      return { itemId, offset: rect.top - viewport.top, processBodyTurnId: turnId };
    }
  }
  return null;
}

function readPrependAnchor(scroll: HTMLElement, readingProcess: string | undefined) {
  const anchor = readHistoryAnchor(scroll);
  if (readingProcess && anchor?.processId === `completed-process-${readingProcess}`) {
    // 同一回合补到早期过程时，入口会移到新首行，保留已经在读的正文。
    return readProcessBodyAnchor(scroll, readingProcess) ?? anchor;
  }
  return anchor;
}

function getHistoryAnchorSelector(anchor: HistoryAnchor): string {
  if (anchor.processId) return `[data-testid="${CSS.escape(anchor.processId)}"]`;
  const row = `[data-stream-row-id="${CSS.escape(anchor.itemId)}"]`;
  return anchor.processBodyTurnId
    ? `${row} [data-process-turn-id="${CSS.escape(anchor.processBodyTurnId)}"]`
    : row;
}

function refreshPendingHistoryAnchor(input: {
  scroll: HTMLElement;
  pending: PendingHistoryAnchor | null;
  loading: boolean;
  readingProcess: string | undefined;
}): void {
  if (!input.loading || !input.pending) return;
  const anchor = readPrependAnchor(input.scroll, input.readingProcess);
  if (anchor) input.pending.anchor = anchor;
}

interface WebHistoryRowProps {
  item: StreamItem;
  index: number;
  items: StreamItem[];
  renderRow: StreamRenderInput["renderers"]["renderHistoryVirtualizedRow"];
  measure?: (node: HTMLDivElement | null) => void;
  revision?: unknown;
  contentRevision?: unknown;
  displayRevision?: unknown;
  globalRevision?: unknown;
}

function resolveHistoryRowContentRevision(
  contentById: NonNullable<StreamRenderInput["historyRowRevision"]>["contentById"] | undefined,
  itemId: string,
): unknown {
  if (!contentById) return undefined;
  if (typeof contentById.get === "function") return contentById.get(itemId);
  return contentById.has(itemId);
}

function resolveHistoryRowDisplayRevision(
  displayStateById:
    | NonNullable<StreamRenderInput["historyRowRevision"]>["displayStateById"]
    | undefined,
  itemId: string,
): unknown {
  if (!displayStateById) return false;
  if (typeof displayStateById.get === "function") return displayStateById.get(itemId) ?? 0;
  return displayStateById.has(itemId);
}

function readHistoryRowRevision(revision: StreamRenderInput["historyRowRevision"]) {
  return {
    collapsedHeights: revision?.estimatedHeightById,
    processAnchorIdByItemId: revision?.processAnchorIdByItemId,
    virtualizeExpandedProcess: revision?.virtualizeExpandedProcess,
    contentById: revision?.contentById,
    displayStateById: revision?.displayStateById,
    globalRevision: revision?.globalContentRevision ?? revision?.globalDisplayState,
  };
}

function invokeWebHistoryRowRenderer(
  renderRow: StreamRenderInput["renderers"]["renderHistoryVirtualizedRow"],
  item: StreamItem,
  index: number,
  items: StreamItem[],
  _revisions: {
    revision: unknown;
    contentRevision: unknown;
    displayRevision: unknown;
    globalRevision: unknown;
  },
): ReactNode {
  return renderRow(item, index, items);
}

const WebHistoryRow = memo(function WebHistoryRow({
  item,
  index,
  items,
  renderRow,
  measure,
  revision,
  contentRevision,
  displayRevision,
  globalRevision,
}: WebHistoryRowProps) {
  "use no memo";
  const rowRef = useRef<HTMLDivElement | null>(null);
  const setRowRef = useCallback(
    (node: HTMLDivElement | null) => {
      rowRef.current = node;
      measure?.(node);
    },
    [measure],
  );
  useLayoutEffect(() => {
    // 补页改变索引但不重挂节点，也不一定触发 ResizeObserver；提交前重新登记当前位置。
    if (measure && rowRef.current) measure(rowRef.current);
  }, [index, measure]);
  return (
    <div
      data-index={measure ? index : undefined}
      data-stream-row-id={item.id}
      ref={setRowRef}
      style={mountedRowStyle}
    >
      {invokeWebHistoryRowRenderer(renderRow, item, index, items, {
        revision,
        contentRevision,
        displayRevision,
        globalRevision,
      })}
    </div>
  );
});

interface HistoryContentProps {
  firstItemId: string | null;
  itemIds: ReadonlySet<string>;
  scrollContainerRef: RefObject<HTMLElement | null>;
  followOutputRef: RefObject<boolean>;
  contentRef: (node: HTMLDivElement | null) => void;
  onPrepend: (anchor: HistoryAnchor) => void;
  onWindowLayoutChange: (anchor: HistoryAnchor) => void;
  virtualPaddingTop: number;
  virtualStartIndex: number;
  isToggleAnchoring: boolean;
  isHistoryAnchoring: boolean;
  readingProcessTurnRef: RefObject<string | undefined>;
  style: CSSProperties;
  children: ReactNode;
}

interface HistoryLayoutSnapshot {
  anchor: HistoryAnchor;
  prepended: boolean;
}

// 必须在 React 改写旧行之前读取锚点，布局副作用执行时旧 DOM 已经被替换。
class HistoryContent extends React.Component<
  HistoryContentProps,
  never,
  HistoryLayoutSnapshot | null
> {
  getSnapshotBeforeUpdate(previous: HistoryContentProps): HistoryLayoutSnapshot | null {
    const scroll = this.props.scrollContainerRef.current;
    const prepended =
      previous.firstItemId !== null &&
      previous.firstItemId !== this.props.firstItemId &&
      this.props.itemIds.has(previous.firstItemId);
    const windowChanged =
      previous.virtualPaddingTop !== this.props.virtualPaddingTop ||
      previous.virtualStartIndex !== this.props.virtualStartIndex;
    const skipWindowAdjustment = this.props.isToggleAnchoring || this.props.isHistoryAnchoring;
    if (
      (!prepended && (!windowChanged || skipWindowAdjustment)) ||
      !scroll ||
      scroll.clientHeight <= 0 ||
      this.props.followOutputRef.current
    ) {
      return null;
    }
    const anchor = prepended
      ? readPrependAnchor(scroll, this.props.readingProcessTurnRef.current)
      : readHistoryAnchor(scroll);
    return anchor ? { anchor, prepended } : null;
  }

  componentDidUpdate(
    _previous: HistoryContentProps,
    _state: never,
    snapshot: HistoryLayoutSnapshot | null,
  ): void {
    if (!snapshot) return;
    if (snapshot.prepended) this.props.onPrepend(snapshot.anchor);
    else this.props.onWindowLayoutChange(snapshot.anchor);
  }

  render() {
    return (
      <div ref={this.props.contentRef} style={this.props.style}>
        {this.props.children}
      </div>
    );
  }
}

function WebStreamViewport(props: StreamRenderInput & { isMobileBreakpoint: boolean }) {
  const {
    segments: sourceSegments,
    processExit,
    historyRowRevision,
    liveHeadRowRevision,
    boundary,
    renderers,
    listEmptyComponent,
    viewportRef,
    routeBottomAnchorRequest,
    isAuthoritativeHistoryReady,
    onNearBottomChange,
    onNearHistoryStart,
    isLoadingOlderHistory,
    hasOlderHistory,
    historyStartCursor,
    scrollEnabled,
    messageParagraphSpacing,
    conversationVerticalPadding = 16,
    conversationHorizontalPadding,
    isMobileBreakpoint,
  } = props;
  const {
    collapsedHeights,
    processAnchorIdByItemId,
    virtualizeExpandedProcess,
    contentById: historyContentById,
    displayStateById: historyDisplayStateById,
    globalRevision: historyGlobalRevision,
  } = readHistoryRowRevision(historyRowRevision);
  const resolveHistoryAnchorItemId = useCallback(
    (anchor: HistoryAnchor) => {
      // 补页会把收起入口移到本轮更早的过程，旧承载行此时已被零高度过滤。
      if (anchor.processId && processAnchorIdByItemId) {
        for (const [itemId, processId] of processAnchorIdByItemId) {
          if (processId === anchor.processId) return itemId;
        }
      }
      return anchor.itemId;
    },
    [processAnchorIdByItemId],
  );
  const segments = useMemo(() => {
    const historyVirtualized = visibleWebHistoryItems(
      sourceSegments.historyVirtualized,
      collapsedHeights,
    );
    const historyMounted = visibleWebHistoryItems(sourceSegments.historyMounted, collapsedHeights);
    if (!virtualizeExpandedProcess || historyVirtualized.length > 0) {
      return { ...sourceSegments, historyVirtualized, historyMounted };
    }
    // 紧凑网页平时仍保留常驻历史；超长过程才进入同一个外层虚拟窗口。
    const start = findMountedWindowStart({
      items: historyMounted,
      minMountedCount: getWebMountedRecentStreamItems(),
    });
    return {
      ...sourceSegments,
      historyVirtualized: historyMounted.slice(0, start),
      historyMounted: historyMounted.slice(start),
    };
  }, [sourceSegments, collapsedHeights, virtualizeExpandedProcess]);
  const isPaneActive = useRetainedPanelActive();
  const isPaneActiveRef = useRef(isPaneActive);
  isPaneActiveRef.current = isPaneActive;
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const viewportSizeRef = useRef({ width: 0, height: 0 });
  const contentRef = useRef<HTMLElement | null>(null);
  const lastKnownScrollTopRef = useRef(0);
  const lastKnownScrollHeightRef = useRef(0);
  const lastKnownClientHeightRef = useRef(0);
  const handleScrollContainerRef = useCallback((node: HTMLElement | null) => {
    scrollContainerRef.current = node;
    if (node) {
      viewportSizeRef.current = { width: node.clientWidth, height: node.clientHeight };
      lastKnownScrollTopRef.current = node.scrollTop;
      lastKnownScrollHeightRef.current = node.scrollHeight;
      lastKnownClientHeightRef.current = node.clientHeight;
    }
  }, []);
  const handleContentRef = useCallback((node: HTMLElement | null) => {
    contentRef.current = node;
  }, []);
  const [followOutput, setFollowOutputr] = useState(true);
  const followOutputRef = useRef(followOutput);
  const setFollowOutput = useCallback((value: boolean) => {
    followOutputRef.current = value;
    setFollowOutputr(value);
    return value;
  }, []);
  const inputEpochRef = useRef(0);
  const lastUserDownwardInputAtRef = useRef(-Infinity);
  const pendingProgrammaticScrollRef = useRef<{ expectedTop: number; epoch: number } | null>(null);
  const isPointerScrollActiveRef = useRef(false);
  const lastTouchClientYRef = useRef<number | null>(null);
  const pendingAutoScrollFrameRef = useRef<number | null>(null);
  const pendingItemJumpFrameRef = useRef<number | null>(null);
  const pendingHistoryAnchorFrameRef = useRef<number | null>(null);
  const historyAnchoringRef = useRef(false);
  const [isHistoryAnchoring, setIsHistoryAnchoring] = useState(false);
  const loadingHistoryRef = useRef(isLoadingOlderHistory);
  loadingHistoryRef.current = isLoadingOlderHistory;
  const pendingHistoryAnchorRef = useRef<PendingHistoryAnchor | null>(null);
  const [hasPendingHistoryAnchor, setHasPendingHistoryAnchor] = useState(false);
  const committedHistoryAnchorRef = useRef<{ anchor: HistoryAnchor; epoch: number } | null>(null);
  const toggleAnchorRef = useRef<HistoryAnchor | null>(null);
  const readingProcessTurnRef = useRef<string | undefined>(undefined);
  const holdAutomaticHistoryStartRef = useRef(false);
  const motionOverlayRef = useRef<HTMLDivElement | null>(null);
  const [processMotion] = useState(createProcessMotion);
  const applyProgrammaticScroll = useCallback((scroll: HTMLElement, writeScroll: () => void) => {
    const beforeTop = scroll.scrollTop;
    writeScroll();
    const afterTop = scroll.scrollTop;
    lastKnownScrollTopRef.current = afterTop;
    lastKnownScrollHeightRef.current = scroll.scrollHeight;
    lastKnownClientHeightRef.current = scroll.clientHeight;
    if (Math.abs(afterTop - beforeTop) > 0.01) {
      pendingProgrammaticScrollRef.current = {
        expectedTop: afterTop,
        epoch: inputEpochRef.current,
      };
    }
  }, []);
  const releaseHistoryAnchor = useCallback(() => {
    historyAnchoringRef.current = false;
    setIsHistoryAnchoring(false);
    committedHistoryAnchorRef.current = null;
    pendingHistoryAnchorRef.current = null;
    setHasPendingHistoryAnchor(false);
  }, []);
  const recordHistoryAnchor = useCallback((anchor: HistoryAnchor) => {
    const epoch = inputEpochRef.current;
    historyAnchoringRef.current = true;
    setIsHistoryAnchoring(true);
    committedHistoryAnchorRef.current = { anchor, epoch };
  }, []);
  const alignHistoryAnchorRow = useCallback(
    (scroll: HTMLElement, anchor: HistoryAnchor): { mounted: boolean; adjusted: boolean } => {
      const row = scroll.querySelector<HTMLElement>(getHistoryAnchorSelector(anchor));
      if (!row) {
        return { mounted: false, adjusted: false };
      }
      const rowBounds = row.getBoundingClientRect();
      if (rowBounds.height <= 0) {
        return { mounted: false, adjusted: false };
      }
      const delta = rowBounds.top - scroll.getBoundingClientRect().top - anchor.offset;
      if (Math.abs(delta) > ANCHOR_LAYOUT_EPSILON_PX) {
        applyProgrammaticScroll(scroll, () => {
          scroll.scrollTop += delta;
        });
        return { mounted: true, adjusted: true };
      }
      lastKnownScrollTopRef.current = scroll.scrollTop;
      return { mounted: true, adjusted: false };
    },
    [applyProgrammaticScroll],
  );
  const preserveVirtualWindowAnchor = useCallback(
    (anchor: HistoryAnchor) => {
      if (followOutputRef.current || historyAnchoringRef.current || !isPaneActiveRef.current) {
        return;
      }
      const scroll = scrollContainerRef.current;
      if (!scroll) return;
      // 虚拟窗口更换会改动祖先的占位内边距，浏览器此时会抑制自身滚动锚定。
      // 只在本次提交绘制前补齐实际位移，不跨帧锁定位置或抵消后续用户滚动。
      alignHistoryAnchorRow(scroll, anchor);
    },
    [alignHistoryAnchorRow],
  );
  const historyStartReadyRef = useRef(false);
  const lastAutoHistoryBackfillSignatureRef = useRef<string | null>(null);
  const handledRouteRequestKeyRef = useRef<string | null>(null);
  const hasAppliedInitialActivationRef = useRef(false);
  const shouldUseVirtualizer = segments.historyVirtualized.length > 0;
  const sourceFirstItemId =
    sourceSegments.historyVirtualized[0]?.id ??
    sourceSegments.historyMounted[0]?.id ??
    sourceSegments.liveHead[0]?.id ??
    null;
  const prepareForHistoryPrepend = useCallback(() => {
    const scroll = scrollContainerRef.current;
    const anchor =
      scroll && !followOutputRef.current
        ? readPrependAnchor(scroll, readingProcessTurnRef.current)
        : null;
    if (anchor) {
      pendingHistoryAnchorRef.current = {
        anchor,
        firstItemId: sourceFirstItemId,
        cursor: historyStartCursor ?? null,
        sawLoading: false,
      };
      setHasPendingHistoryAnchor(true);
    }
  }, [sourceFirstItemId, historyStartCursor]);
  const requestOlderHistory = useCallback(() => {
    prepareForHistoryPrepend();
    onNearHistoryStart();
  }, [onNearHistoryStart, prepareForHistoryPrepend]);
  useLayoutEffect(() => {
    const pending = pendingHistoryAnchorRef.current;
    if (!pending) return;
    if (followOutputRef.current) {
      releaseHistoryAnchor();
      return;
    }
    if (isLoadingOlderHistory) {
      pending.sawLoading = true;
      return;
    }
    // 有些页只更新已折叠条目或游标，没有 DOM 前插快照可以释放窗口。
    const cursorAdvanced = pending.cursor !== (historyStartCursor ?? null);
    if (
      !historyAnchoringRef.current &&
      pending.firstItemId === sourceFirstItemId &&
      (cursorAdvanced || pending.sawLoading)
    )
      releaseHistoryAnchor();
  }, [
    hasPendingHistoryAnchor,
    isLoadingOlderHistory,
    historyStartCursor,
    sourceFirstItemId,
    releaseHistoryAnchor,
  ]);
  const {
    renderHistoryVirtualizedRow,
    renderHistoryMountedRow,
    renderLiveHeadRow,
    renderLiveAuxiliary,
  } = renderers;

  followOutputRef.current = followOutput;

  const hasRouteBottomAnchorRequest = routeBottomAnchorRequest !== null;
  const activationKey = routeBottomAnchorRequest?.requestKey ?? props.agentId;
  const isActivationReady = !hasRouteBottomAnchorRequest || isAuthoritativeHistoryReady;

  const getScrollElement = useCallback(() => scrollContainerRef.current, []);
  const getItemKey = useCallback(
    (index: number) => {
      const row = segments.historyVirtualized[index];
      if (!row) {
        return index;
      }
      // 纯入口换承载行后仍是同一个可见条目，复用其已测量高度，避免重新估算。
      return processAnchorIdByItemId?.get(row.id) ?? row.id;
    },
    [segments.historyVirtualized, processAnchorIdByItemId],
  );
  const estimateSize = useCallback(
    (index: number) => {
      const row = segments.historyVirtualized[index];
      return row
        ? estimateStreamItemHeight(row, messageParagraphSpacing, collapsedHeights?.get(row.id))
        : 120;
    },
    [segments.historyVirtualized, collapsedHeights, messageParagraphSpacing],
  );
  const rowVirtualizer = useVirtualizer({
    useFlushSync: false,
    initialRect: viewportSizeRef.current,
    initialOffset: () => scrollContainerRef.current?.scrollTop ?? 0,
    count: segments.historyVirtualized.length,
    enabled: shouldUseVirtualizer,
    getScrollElement,
    getItemKey,
    estimateSize,
    rangeExtractor: useCallback(
      (range: Parameters<typeof defaultRangeExtractor>[0]) => {
        const toggleAnchor = toggleAnchorRef.current;
        if (toggleAnchor) {
          const itemId = resolveHistoryAnchorItemId(toggleAnchor);
          const index = segments.historyVirtualized.findIndex((item) => item.id === itemId);
          if (index >= 0 && (index < range.startIndex || index > range.endIndex)) {
            // 入口可能换承载行或进入虚拟区。只保留入口附近的有界窗口，
            // 不把旧窗口与新窗口之间的所有行同时挂载。
            const span = range.endIndex - range.startIndex;
            return defaultRangeExtractor({
              ...range,
              startIndex: Math.max(0, index - span),
              endIndex: Math.min(range.count - 1, index + span),
            });
          }
        }
        const pending = hasPendingHistoryAnchor ? pendingHistoryAnchorRef.current : null;
        if (!pending || pending.firstItemId === sourceFirstItemId)
          return defaultRangeExtractor(range);
        const anchorItemId = resolveHistoryAnchorItemId(pending.anchor);
        const index = segments.historyVirtualized.findIndex((item) => item.id === anchorItemId);
        if (index < 0) return defaultRangeExtractor(range);
        // 新页提交前先保留正在阅读的窗口，不能先挂载新页再靠滚动补救。
        const pendingEndIndex = Math.min(
          range.count - 1,
          index + Math.max(1, range.endIndex - range.startIndex),
        );
        return defaultRangeExtractor({ ...range, startIndex: index, endIndex: pendingEndIndex });
      },
      [
        hasPendingHistoryAnchor,
        segments.historyVirtualized,
        sourceFirstItemId,
        resolveHistoryAnchorItemId,
      ],
    ),
    measureElement: (element, entry, instance) => {
      // 观察回调直接消费本轮布局结果，不延后一帧再逐行强制重测。
      const size = entry?.borderBoxSize[0];
      if (size && size.inlineSize > 0) return size.blockSize;
      if (!entry) {
        const bounds = element.getBoundingClientRect();
        if (bounds.width > 0) return bounds.height;
      }
      // 隐藏面板没有参与布局，保留最后有效高度；首次挂载仍在提交时同步测量。
      const index = instance.indexFromElement(element);
      return instance.measurementsCache[index].size;
    },
    overscan: 4,
  });
  useEffect(() => {
    // 正文自然增高由浏览器锚定；窗口占位改变由提交快照校正，不再叠加虚拟器补偿。
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;
    return () => {
      rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
    };
  }, [rowVirtualizer]);
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualTotalSize = rowVirtualizer.getTotalSize();

  // 提交时同步更新占位尺寸，后续正文、图表和图片增高由观察器继续测量。
  const measureVirtualizedRowElement = useCallback(
    (node: HTMLDivElement | null) => {
      rowVirtualizer.measureElement(node);
    },
    [rowVirtualizer],
  );

  useEffect(() => {
    return () => {
      if (pendingItemJumpFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingItemJumpFrameRef.current);
      }
      if (pendingHistoryAnchorFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingHistoryAnchorFrameRef.current);
      }
    };
  }, []);

  const cancelPendingStickToBottom = useCallback(() => {
    const pendingFrame = pendingAutoScrollFrameRef.current;
    if (pendingFrame !== null) {
      pendingAutoScrollFrameRef.current = null;
      window.cancelAnimationFrame(pendingFrame);
    }
  }, []);

  const cancelItemJump = useCallback(() => {
    if (pendingItemJumpFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingItemJumpFrameRef.current);
      pendingItemJumpFrameRef.current = null;
    }
  }, []);

  const cancelPendingHistoryAnchor = useCallback(() => {
    historyAnchoringRef.current = false;
    setIsHistoryAnchoring(false);
    committedHistoryAnchorRef.current = null;
    if (!loadingHistoryRef.current) releaseHistoryAnchor();
    if (pendingHistoryAnchorFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingHistoryAnchorFrameRef.current);
      pendingHistoryAnchorFrameRef.current = null;
    }
  }, [releaseHistoryAnchor]);

  const {
    active: isToggleAnchoring,
    preserve: preserveToggleAnchor,
    cancel: cancelContentToggleAnchor,
    restore: restoreToggleAnchor,
  } = useContentToggleAnchor({
    inverted: false,
    getOffset: () => {
      const scroll = scrollContainerRef.current;
      if (!scroll) throw new Error("展开时对话视口未挂载");
      return scroll.scrollTop;
    },
    setOffset: (offset) => {
      const scroll = scrollContainerRef.current;
      if (!scroll) return;
      applyProgrammaticScroll(scroll, () => {
        scroll.scrollTop = offset;
      });
    },
    detach: () => {
      setFollowOutput(false);
      cancelPendingStickToBottom();
      cancelPendingHistoryAnchor();
      cancelItemJump();
    },
  });
  const cancelToggleAnchor = useCallback(() => {
    toggleAnchorRef.current = null;
    processMotion.cancel();
    cancelContentToggleAnchor();
  }, [cancelContentToggleAnchor, processMotion]);
  useLayoutEffect(() => processMotion.cancel, [processMotion, isPaneActive]);
  const takeScrollControl = useCallback(
    (direction: "up" | "down" | "pointer") => {
      inputEpochRef.current += 1;
      pendingProgrammaticScrollRef.current = null;
      cancelItemJump();
      cancelToggleAnchor();
      cancelPendingHistoryAnchor();
      if (direction === "up") {
        holdAutomaticHistoryStartRef.current = false;
        lastUserDownwardInputAtRef.current = -Infinity;
        setFollowOutput(false);
        cancelPendingStickToBottom();
      } else if (direction === "down") {
        lastUserDownwardInputAtRef.current = performance.now();
      }
    },
    [
      cancelItemJump,
      cancelPendingHistoryAnchor,
      cancelPendingStickToBottom,
      cancelToggleAnchor,
      setFollowOutput,
    ],
  );
  useLayoutEffect(() => {
    if (!isToggleAnchoring) toggleAnchorRef.current = null;
  }, [isToggleAnchoring]);
  useLayoutEffect(() => {
    if (committedHistoryAnchorRef.current?.anchor.processBodyTurnId) cancelToggleAnchor();
    else restoreToggleAnchor();
    const scroll = scrollContainerRef.current;
    const content = contentRef.current;
    const overlay = motionOverlayRef.current;
    if (scroll && content && overlay) processMotion.afterChange(scroll, content, overlay);
  });
  const preserveProcessAnchor = useCallback<StreamViewportHandle["preserveScrollAnchor"]>(
    (request) =>
      preserveToggleAnchor({
        ...request,
        applyChange: () => {
          // 展开可能把入口从常驻区移入虚拟区，首个提交就保留该行，不能等它离屏后再测量。
          const scroll = scrollContainerRef.current;
          const content = contentRef.current;
          if (scroll && content) {
            processMotion.beforeChange(scroll, content, request.process, isPaneActiveRef.current);
          }
          toggleAnchorRef.current = {
            itemId: request.itemId,
            processId: processAnchorIdByItemId?.get(request.itemId),
            offset: 0,
          };
          readingProcessTurnRef.current = request.process?.expanded
            ? request.process.turnId
            : undefined;
          holdAutomaticHistoryStartRef.current = readingProcessTurnRef.current !== undefined;
          request.applyChange();
        },
      }),
    [preserveToggleAnchor, processAnchorIdByItemId, processMotion],
  );

  const scrollMessagesToBottom = useCallback(
    (behavior: ScrollBehaviorLike = "auto") => {
      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer || !isPaneActiveRef.current || scrollContainer.clientHeight <= 0) {
        return;
      }
      if (isScrollContainerOverscrolledPastBottom(scrollContainer)) {
        return;
      }
      if (!isScrollContainerAtBottom(scrollContainer)) {
        applyProgrammaticScroll(scrollContainer, () =>
          scrollElementToBottom(scrollContainer, behavior),
        );
      }
      syncNearBottom(scrollContainer, onNearBottomChange);
    },
    [applyProgrammaticScroll, onNearBottomChange],
  );

  const scheduleStickToBottom = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer && isScrollContainerOverscrolledPastBottom(scrollContainer)) {
      return;
    }
    if (pendingAutoScrollFrameRef.current !== null) {
      return;
    }
    pendingAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingAutoScrollFrameRef.current = null;
      if (!followOutputRef.current || historyAnchoringRef.current || !isPaneActiveRef.current) {
        return;
      }
      scrollMessagesToBottom("auto");
    });
  }, [scrollMessagesToBottom]);

  const forceStickToBottom = useCallback(() => {
    cancelPendingStickToBottom();
    scrollMessagesToBottom("auto");
    scheduleStickToBottom();
  }, [cancelPendingStickToBottom, scheduleStickToBottom, scrollMessagesToBottom]);

  const alignProcessExitUntilRef = useRef(-Infinity);
  const processExitId = processExit?.turnId;
  const processExitRef = useRef(processExit);
  processExitRef.current = processExit;
  useLayoutEffect(() => {
    const exit = processExitRef.current;
    if (!exit) return;
    const scroll = scrollContainerRef.current;
    if (!scroll || !isPaneActive || !followOutputRef.current) {
      exit.onFinish();
      return;
    }
    forceStickToBottom();
    const viewport = scroll.getBoundingClientRect();
    const rows = Array.from(scroll.querySelectorAll<HTMLElement>("[data-stream-row-id]")).filter(
      (row) => {
        const id = row.dataset.streamRowId;
        if (!id || !exit.rowIds.has(id)) return false;
        const bounds = row.getBoundingClientRect();
        return bounds.height > 0 && bounds.top < viewport.bottom && bounds.bottom > viewport.top;
      },
    );
    if (!rows.length) {
      exit.onFinish();
      return;
    }
    alignProcessExitUntilRef.current = Infinity;
    // 只淡出可见过程行；不逐行改高度，不对正文、图片或回合按钮做出场动画。
    const fades = rows.map((row) =>
      row.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: MOTION_DURATION.fast,
        easing: MOTION_EASING_CSS.standard,
        fill: "forwards",
      }),
    );
    const lastFade = fades[fades.length - 1];
    lastFade.onfinish = exit.onFinish;
    return () => {
      lastFade.onfinish = null;
      for (const fade of fades) fade.cancel();
      // 折叠会使历史行换区，后续测得的真实行高也在绘制前对齐，避免露出旧偏移的一帧。
      alignProcessExitUntilRef.current = performance.now() + MOTION_DURATION.base;
    };
  }, [forceStickToBottom, isPaneActive, processExitId]);

  useLayoutEffect(() => {
    if (followOutputRef.current && performance.now() <= alignProcessExitUntilRef.current) {
      scrollMessagesToBottom();
    }
  });

  const updateScrollMetrics = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      onNearBottomChange(true);
      return;
    }
    viewportSizeRef.current = {
      width: scrollContainer.clientWidth,
      height: scrollContainer.clientHeight,
    };
    syncNearBottom(scrollContainer, onNearBottomChange);
  }, [onNearBottomChange]);

  const requestOlderHistoryAtStart = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (
      !scrollContainer ||
      holdAutomaticHistoryStartRef.current ||
      !historyStartReadyRef.current ||
      !isAuthoritativeHistoryReady ||
      !hasOlderHistory ||
      isLoadingOlderHistory ||
      scrollContainer.clientHeight <= 0 ||
      scrollContainer.scrollTop > HISTORY_START_THRESHOLD_PX
    ) {
      return;
    }
    requestOlderHistory();
  }, [hasOlderHistory, isAuthoritativeHistoryReady, isLoadingOlderHistory, requestOlderHistory]);

  const handleDomScroll = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const currentScrollTop = scrollContainer.scrollTop;
    processMotion.onScroll(scrollContainer);
    refreshPendingHistoryAnchor({
      scroll: scrollContainer,
      pending: pendingHistoryAnchorRef.current,
      loading: isLoadingOlderHistory,
      readingProcess: readingProcessTurnRef.current,
    });
    const programmatic = pendingProgrammaticScrollRef.current;
    pendingProgrammaticScrollRef.current = null;
    const isProgrammaticEcho =
      programmatic?.epoch === inputEpochRef.current &&
      Math.abs(programmatic.expectedTop - currentScrollTop) <=
        PROGRAMMATIC_SCROLL_ECHO_TOLERANCE_PX;
    const delta = currentScrollTop - lastKnownScrollTopRef.current;
    const layoutChanged =
      lastKnownScrollHeightRef.current !== scrollContainer.scrollHeight ||
      lastKnownClientHeightRef.current !== scrollContainer.clientHeight;
    const readingAnchorActive = isToggleAnchoring || historyAnchoringRef.current;
    const hasDownwardInput =
      isPointerScrollActiveRef.current ||
      performance.now() - lastUserDownwardInputAtRef.current <= USER_DOWNWARD_INPUT_WINDOW_MS;
    if (!readingAnchorActive && !isProgrammaticEcho && !layoutChanged) {
      if (isPointerScrollActiveRef.current && delta < -USER_SCROLL_DELTA_EPSILON) {
        holdAutomaticHistoryStartRef.current = false;
        if (followOutputRef.current) {
          cancelPendingStickToBottom();
          setFollowOutput(false);
        }
      } else if (
        !followOutputRef.current &&
        hasDownwardInput &&
        delta > USER_SCROLL_DELTA_EPSILON &&
        isScrollContainerAtBottom(scrollContainer)
      ) {
        setFollowOutput(true);
      }
    }

    lastKnownScrollTopRef.current = currentScrollTop;
    lastKnownScrollHeightRef.current = scrollContainer.scrollHeight;
    lastKnownClientHeightRef.current = scrollContainer.clientHeight;
    updateScrollMetrics();
    if (!readingAnchorActive) requestOlderHistoryAtStart();
  }, [
    cancelPendingStickToBottom,
    isLoadingOlderHistory,
    requestOlderHistoryAtStart,
    setFollowOutput,
    updateScrollMetrics,
    isToggleAnchoring,
    processMotion,
  ]);

  const autoLoadOlderHistoryIfViewportIsTooShort = useCallback(() => {
    // 点开过程不等于向上翻页；在顶边等待主动滚动，避免已读首行被一批批更早过程换掉。
    if (
      holdAutomaticHistoryStartRef.current ||
      isToggleAnchoring ||
      historyAnchoringRef.current ||
      hasPendingHistoryAnchor
    )
      return;
    const scrollContainer = scrollContainerRef.current;
    if (
      !scrollContainer ||
      !shouldAutoLoadOlderHistory({
        historyStartReady: historyStartReadyRef.current,
        isAuthoritativeHistoryReady,
        hasOlderHistory,
        isLoadingOlderHistory,
        clientHeight: scrollContainer.clientHeight,
        scrollHeight: scrollContainer.scrollHeight,
        scrollTop: scrollContainer.scrollTop,
        isFollowingOutput: followOutputRef.current,
        historyStartThreshold: HISTORY_START_THRESHOLD_PX,
      })
    ) {
      return;
    }

    const signature = [
      historyStartCursor,
      ...[segments.historyVirtualized, segments.historyMounted, segments.liveHead].flatMap(
        (items) => [items[0]?.id, items.at(-1)?.id, items.length],
      ),
      scrollContainer.clientHeight,
      scrollContainer.scrollHeight,
    ].join(":");
    if (lastAutoHistoryBackfillSignatureRef.current === signature) {
      return;
    }

    lastAutoHistoryBackfillSignatureRef.current = signature;
    requestOlderHistory();
  }, [
    hasOlderHistory,
    historyStartCursor,
    isAuthoritativeHistoryReady,
    isLoadingOlderHistory,
    requestOlderHistory,
    segments.historyMounted,
    segments.historyVirtualized,
    segments.liveHead,
    isToggleAnchoring,
    hasPendingHistoryAnchor,
  ]);

  useEffect(() => {
    lastAutoHistoryBackfillSignatureRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      historyStartReadyRef.current = true;
    });
    return () => {
      window.cancelAnimationFrame(frame);
      historyStartReadyRef.current = false;
    };
  }, [props.agentId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(autoLoadOlderHistoryIfViewportIsTooShort);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [autoLoadOlderHistoryIfViewportIsTooShort]);

  useLayoutEffect(() => {
    if (!isActivationReady || !isPaneActive) return;
    if (hasRouteBottomAnchorRequest) {
      if (handledRouteRequestKeyRef.current === activationKey) return;
      handledRouteRequestKeyRef.current = activationKey;
    } else if (hasAppliedInitialActivationRef.current) return;
    hasAppliedInitialActivationRef.current = true;
    // 路由的历史准备可能晚于首次上翻，不得夺回用户已释放的追尾。
    if (!followOutputRef.current) return;
    forceStickToBottom();
    const timeout = window.setTimeout(() => {
      if (!followOutputRef.current || historyAnchoringRef.current) {
        return;
      }
      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer) {
        return;
      }
      if (isScrollContainerNearBottom(scrollContainer)) {
        return;
      }
      scheduleStickToBottom();
    }, WEB_BOTTOM_SETTLE_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    activationKey,
    forceStickToBottom,
    hasRouteBottomAnchorRequest,
    isActivationReady,
    isPaneActive,
    scheduleStickToBottom,
  ]);

  useEffect(() => {
    if (!followOutputRef.current) {
      return;
    }
    scheduleStickToBottom();
  }, [
    scheduleStickToBottom,
    segments.historyMounted,
    segments.historyVirtualized,
    segments.liveHead,
  ]);

  useEffect(() => {
    if (!followOutputRef.current || !shouldUseVirtualizer) {
      return;
    }
    scheduleStickToBottom();
  }, [scheduleStickToBottom, shouldUseVirtualizer, virtualTotalSize]);

  useEffect(() => {
    updateScrollMetrics();
  }, [
    segments.historyMounted.length,
    segments.historyVirtualized.length,
    segments.liveHead.length,
    updateScrollMetrics,
    virtualTotalSize,
  ]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const contentNode = contentRef.current;
    if (!scrollContainer || typeof ResizeObserver === "undefined") {
      return;
    }

    updateScrollMetrics();
    let resizeFrame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (
        followOutputRef.current &&
        !historyAnchoringRef.current &&
        performance.now() <= alignProcessExitUntilRef.current
      ) {
        scrollMessagesToBottom();
        return;
      }
      if (resizeFrame !== null) {
        return;
      }
      // 合并同一帧内多次展开/收起高度变化引发的布局读取，避免每帧重复触发布局重排。
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        if (followOutputRef.current && !historyAnchoringRef.current) {
          scrollMessagesToBottom("auto");
        } else {
          updateScrollMetrics();
        }
        autoLoadOlderHistoryIfViewportIsTooShort();
      });
    });
    observer.observe(scrollContainer);
    if (contentNode) {
      observer.observe(contentNode);
    }
    return () => {
      observer.disconnect();
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
    };
  }, [
    autoLoadOlderHistoryIfViewportIsTooShort,
    scheduleStickToBottom,
    scrollMessagesToBottom,
    updateScrollMetrics,
  ]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY === 0) return;
      takeScrollControl(event.deltaY < 0 ? "up" : "down");
      if (event.deltaY < 0) {
        requestOlderHistoryAtStart();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (processMotion.isOnTrigger(scrollContainer, event.target)) return;
      takeScrollControl("pointer");
      isPointerScrollActiveRef.current = true;
    };
    const handlePointerUp = () => {
      isPointerScrollActiveRef.current = false;
    };
    const handleTouchStart = (event: TouchEvent) => {
      if (!processMotion.isOnTrigger(scrollContainer, event.target)) takeScrollControl("pointer");
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      lastTouchClientYRef.current = touch.clientY;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      const previousTouchY = lastTouchClientYRef.current;
      if (previousTouchY !== null && Math.abs(touch.clientY - previousTouchY) > 1) {
        const up = touch.clientY > previousTouchY;
        takeScrollControl(up ? "up" : "down");
        if (up) requestOlderHistoryAtStart();
      }
      lastTouchClientYRef.current = touch.clientY;
    };
    const handleTouchEnd = () => {
      lastTouchClientYRef.current = null;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const editingText =
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, select, [contenteditable='true']") !== null;
      if (event.defaultPrevented || editingText) return;
      if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") {
        takeScrollControl("up");
        requestOlderHistoryAtStart();
      } else if (event.key === "ArrowDown" || event.key === "PageDown" || event.key === "End") {
        takeScrollControl("down");
      }
    };

    scrollContainer.addEventListener("scroll", handleDomScroll, { passive: true });
    scrollContainer.addEventListener("wheel", handleWheel, { passive: true });
    scrollContainer.addEventListener("pointerdown", handlePointerDown, { passive: true });
    scrollContainer.addEventListener("pointerup", handlePointerUp, { passive: true });
    scrollContainer.addEventListener("pointercancel", handlePointerUp, { passive: true });
    scrollContainer.addEventListener("touchstart", handleTouchStart, { passive: true });
    scrollContainer.addEventListener("touchmove", handleTouchMove, { passive: true });
    scrollContainer.addEventListener("touchend", handleTouchEnd, { passive: true });
    scrollContainer.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    scrollContainer.addEventListener("keydown", handleKeyDown);

    return () => {
      scrollContainer.removeEventListener("scroll", handleDomScroll);
      scrollContainer.removeEventListener("wheel", handleWheel);
      scrollContainer.removeEventListener("pointerdown", handlePointerDown);
      scrollContainer.removeEventListener("pointerup", handlePointerUp);
      scrollContainer.removeEventListener("pointercancel", handlePointerUp);
      scrollContainer.removeEventListener("touchstart", handleTouchStart);
      scrollContainer.removeEventListener("touchmove", handleTouchMove);
      scrollContainer.removeEventListener("touchend", handleTouchEnd);
      scrollContainer.removeEventListener("touchcancel", handleTouchEnd);
      scrollContainer.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleDomScroll, processMotion, requestOlderHistoryAtStart, takeScrollControl]);

  const contentContainerStyle = useMemo((): CSSProperties => {
    return {
      display: "flex",
      flexDirection: "column",
      minHeight: "100%",
      paddingTop: conversationVerticalPadding,
      paddingBottom: conversationVerticalPadding,
      paddingLeft: conversationHorizontalPadding ?? (isMobileBreakpoint ? 8 : 16),
      paddingRight: conversationHorizontalPadding ?? (isMobileBreakpoint ? 8 : 16),
      boxSizing: "border-box",
    };
  }, [conversationHorizontalPadding, conversationVerticalPadding, isMobileBreakpoint]);
  const scrollContainerStyle = useMemo((): CSSProperties => {
    return {
      flex: 1,
      minHeight: 0,
      overflowX: "hidden",
      overflowY: scrollEnabled ? "auto" : "hidden",
      scrollbarGutter: "stable",
      overflowAnchor:
        isToggleAnchoring || isHistoryAnchoring
          ? "none"
          : (`var(${PROCESS_SCROLL_ANCHOR_VAR}, auto)` as CSSProperties["overflowAnchor"]),
      overscrollBehaviorY: "contain",
    };
  }, [scrollEnabled, isToggleAnchoring, isHistoryAnchoring]);
  const virtualWindow = useMemo(() => {
    const first = virtualRows[0];
    return {
      index: first?.index ?? 0,
      paddingTop: first?.start ?? 0,
      paddingBottom: Math.max(0, virtualTotalSize - (virtualRows.at(-1)?.end ?? 0)),
    };
  }, [virtualRows, virtualTotalSize]);
  const mountedHistoryRows = useMemo(() => {
    return segments.historyMounted.map((item, index) => (
      <WebHistoryRow
        key={processAnchorIdByItemId?.get(item.id) ?? item.id}
        item={item}
        index={index}
        items={segments.historyMounted}
        renderRow={renderHistoryMountedRow}
        contentRevision={resolveHistoryRowContentRevision(historyContentById, item.id)}
        displayRevision={resolveHistoryRowDisplayRevision(historyDisplayStateById, item.id)}
        globalRevision={historyGlobalRevision}
      />
    ));
  }, [
    historyContentById,
    historyDisplayStateById,
    historyGlobalRevision,
    renderHistoryMountedRow,
    segments.historyMounted,
    processAnchorIdByItemId,
  ]);
  const liveHeadRows = useMemo(() => {
    return segments.liveHead.map((item, index) => (
      <WebHistoryRow
        key={processAnchorIdByItemId?.get(item.id) ?? item.id}
        item={item}
        index={index}
        items={segments.liveHead}
        renderRow={renderLiveHeadRow}
        revision={liveHeadRowRevision}
      />
    ));
  }, [liveHeadRowRevision, renderLiveHeadRow, segments.liveHead, processAnchorIdByItemId]);
  const virtualTopStyle = useMemo<CSSProperties>(
    () => ({
      paddingTop: virtualWindow.paddingTop,
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
    }),
    [virtualWindow.paddingTop],
  );
  const virtualBottomStyle = useMemo<CSSProperties>(
    () => ({ height: virtualWindow.paddingBottom, flexShrink: 0 }),
    [virtualWindow.paddingBottom],
  );
  // 虚拟行与常驻行共用一个 keyed 兄弟列表；跨区不能更换父节点、重挂图片和工具内容。
  const historyRows = useMemo(() => {
    const rows: ReactNode[] = [];
    for (const virtualRow of virtualRows) {
      const item = segments.historyVirtualized[virtualRow.index];
      if (!item) continue;
      rows.push(
        <WebHistoryRow
          key={processAnchorIdByItemId?.get(item.id) ?? item.id}
          item={item}
          index={virtualRow.index}
          items={segments.historyVirtualized}
          measure={measureVirtualizedRowElement}
          renderRow={renderHistoryVirtualizedRow}
          contentRevision={resolveHistoryRowContentRevision(historyContentById, item.id)}
          displayRevision={resolveHistoryRowDisplayRevision(historyDisplayStateById, item.id)}
          globalRevision={historyGlobalRevision}
        />,
      );
    }
    rows.push(
      <div key="virtual-window-end" data-virtual-spacer="end" style={virtualBottomStyle} />,
    );
    return [...rows, ...mountedHistoryRows, ...liveHeadRows];
  }, [
    historyContentById,
    historyDisplayStateById,
    historyGlobalRevision,
    virtualBottomStyle,
    virtualRows,
    segments.historyVirtualized,
    processAnchorIdByItemId,
    measureVirtualizedRowElement,
    renderHistoryVirtualizedRow,
    mountedHistoryRows,
    liveHeadRows,
  ]);
  const liveAuxiliary = useMemo(() => {
    return renderLiveAuxiliary();
  }, [renderLiveAuxiliary]);
  const historyItemIds = useMemo(
    () =>
      new Set(
        [
          ...sourceSegments.historyVirtualized,
          ...sourceSegments.historyMounted,
          ...sourceSegments.liveHead,
        ].map((item) => item.id),
      ),
    [sourceSegments.historyVirtualized, sourceSegments.historyMounted, sourceSegments.liveHead],
  );
  const firstHistoryItemId = sourceFirstItemId;
  const restoreHistoryAnchor = useCallback(
    ({ anchor, epoch }: { anchor: HistoryAnchor; epoch: number }) => {
      const scroll = scrollContainerRef.current;
      if (
        !scroll ||
        !isPaneActiveRef.current ||
        followOutputRef.current ||
        epoch !== inputEpochRef.current
      ) {
        releaseHistoryAnchor();
        return;
      }
      let stableFrames = 0;
      let remainingFrames = HISTORY_ANCHOR_MAX_FRAMES;
      const restoreMounted = () => {
        const result = alignHistoryAnchorRow(scroll, anchor);
        stableFrames = result.mounted && !result.adjusted ? stableFrames + 1 : 0;
        return result.mounted;
      };
      if (!restoreMounted()) {
        const anchorItemId = resolveHistoryAnchorItemId(anchor);
        const index = segments.historyVirtualized.findIndex((item) => item.id === anchorItemId);
        if (index < 0) {
          releaseHistoryAnchor();
          return;
        }
        const target = rowVirtualizer.getOffsetForIndex(index, "start");
        if (!target) {
          releaseHistoryAnchor();
          return;
        }
        applyProgrammaticScroll(scroll, () => {
          rowVirtualizer.scrollToOffset(target[0] + conversationVerticalPadding - anchor.offset);
        });
      }
      if (pendingHistoryAnchorFrameRef.current !== null)
        window.cancelAnimationFrame(pendingHistoryAnchorFrameRef.current);
      // 补页后的新行会继续修正占位，阅读锚点需要保持到连续两帧布局稳定。
      const settleAnchor = () => {
        pendingHistoryAnchorFrameRef.current = null;
        if (
          scroll.clientHeight <= 0 ||
          !isPaneActiveRef.current ||
          followOutputRef.current ||
          epoch !== inputEpochRef.current
        ) {
          releaseHistoryAnchor();
          return;
        }
        restoreMounted();
        remainingFrames -= 1;
        if (stableFrames < ITEM_JUMP_STABLE_FRAMES && remainingFrames > 0) {
          pendingHistoryAnchorFrameRef.current = window.requestAnimationFrame(settleAnchor);
        } else {
          releaseHistoryAnchor();
        }
      };
      pendingHistoryAnchorFrameRef.current = window.requestAnimationFrame(settleAnchor);
    },
    [
      conversationVerticalPadding,
      alignHistoryAnchorRow,
      applyProgrammaticScroll,
      rowVirtualizer,
      segments.historyVirtualized,
      releaseHistoryAnchor,
      resolveHistoryAnchorItemId,
    ],
  );
  useLayoutEffect(() => {
    const anchor = committedHistoryAnchorRef.current;
    if (!anchor) return;
    committedHistoryAnchorRef.current = null;
    // 子内容先提交快照，等待虚拟器完成本次布局接入后再恢复，覆盖首次启用虚拟化的补页。
    restoreHistoryAnchor(anchor);
  });
  const scrollToItem = useCallback(
    (itemId: string) => {
      cancelToggleAnchor();
      readingProcessTurnRef.current = undefined;
      holdAutomaticHistoryStartRef.current = false;
      cancelPendingHistoryAnchor();
      setFollowOutput(false);
      cancelPendingStickToBottom();
      cancelItemJump();
      const virtualIndex = segments.historyVirtualized.findIndex((item) => item.id === itemId);
      let remainingFrames = ITEM_JUMP_MAX_FRAMES;
      let stableFrames = 0;
      let requestedDomCenter = false;
      const settleTarget = () => {
        pendingItemJumpFrameRef.current = null;
        const scrollContainer = scrollContainerRef.current;
        if (!isPaneActiveRef.current || !scrollContainer) return;
        const target = document.getElementById(getStreamItemDomId(itemId));
        if (!(target instanceof HTMLElement) || !scrollContainer.contains(target)) {
          stableFrames = 0;
          if (virtualIndex >= 0) {
            applyProgrammaticScroll(scrollContainer, () => {
              rowVirtualizer.scrollToIndex(virtualIndex, { align: "center", behavior: "auto" });
            });
          }
        } else {
          const scrollBounds = scrollContainer.getBoundingClientRect();
          const targetBounds = target.getBoundingClientRect();
          const centerDelta =
            targetBounds.top +
            targetBounds.height / 2 -
            (scrollBounds.top + scrollBounds.height / 2);
          const isCentered = Math.abs(centerDelta) <= ITEM_JUMP_CENTER_TOLERANCE_PX;
          const isAtTopBoundary =
            scrollContainer.scrollTop <= ITEM_JUMP_CENTER_TOLERANCE_PX && centerDelta < 0;
          const isAtBottomBoundary =
            getScrollContainerDistanceFromBottom(scrollContainer) <=
              ITEM_JUMP_CENTER_TOLERANCE_PX && centerDelta > 0;
          const isAtBestReachablePosition = isCentered || isAtTopBoundary || isAtBottomBoundary;
          if (!requestedDomCenter || !isAtBestReachablePosition) {
            applyProgrammaticScroll(scrollContainer, () => {
              scrollContainer.scrollTop += centerDelta;
            });
            requestedDomCenter = true;
            stableFrames = 0;
          } else {
            stableFrames += 1;
            if (stableFrames >= ITEM_JUMP_STABLE_FRAMES) {
              return;
            }
          }
        }

        remainingFrames -= 1;
        if (remainingFrames <= 0) {
          console.warn("[对话历史索引] 跳转未在限定时间内完成", { itemId, virtualIndex });
          return;
        }
        pendingItemJumpFrameRef.current = window.requestAnimationFrame(settleTarget);
      };
      settleTarget();
    },
    [
      cancelPendingHistoryAnchor,
      cancelPendingStickToBottom,
      cancelItemJump,
      applyProgrammaticScroll,
      setFollowOutput,
      rowVirtualizer,
      segments.historyVirtualized,
      cancelToggleAnchor,
    ],
  );
  useEffect(() => {
    const handle: StreamViewportHandle = {
      prepareForHistoryPrepend,
      preserveScrollAnchor: preserveProcessAnchor,
      scrollToBottom: () => {
        cancelToggleAnchor();
        cancelPendingHistoryAnchor();
        cancelItemJump();
        setFollowOutput(true);
        cancelPendingStickToBottom();
        forceStickToBottom();
      },
      scrollToItem,
      prepareForViewportChange: () => {
        if (!followOutputRef.current) {
          return;
        }
        scheduleStickToBottom();
      },
    };
    viewportRef.current = handle;
    return () => {
      if (viewportRef.current === handle) {
        viewportRef.current = null;
      }
      cancelPendingStickToBottom();
    };
  }, [
    cancelPendingHistoryAnchor,
    cancelPendingStickToBottom,
    cancelItemJump,
    setFollowOutput,
    forceStickToBottom,
    scheduleStickToBottom,
    scrollToItem,
    viewportRef,
    cancelToggleAnchor,
    preserveProcessAnchor,
    prepareForHistoryPrepend,
  ]);
  const historyStartSlot = useMemo(() => {
    if (!isLoadingOlderHistory) {
      return null;
    }
    return (
      <div style={historyStartSlotStyle} data-testid="load-older-history-spinner">
        <ActivityIndicator size="small" />
      </div>
    );
  }, [isLoadingOlderHistory]);
  const shouldRenderEmpty =
    !boundary.hasMountedHistory &&
    !boundary.hasVirtualizedHistory &&
    !boundary.hasLiveHead &&
    !liveAuxiliary;

  return (
    <div style={motionViewportStyle}>
      <div
        ref={handleScrollContainerRef}
        data-testid="agent-chat-scroll"
        id={`agent-chat-scroll-${shouldUseVirtualizer ? "web-dom-virtualized" : "web-dom-scroll"}`}
        style={scrollContainerStyle}
      >
        <HistoryContent
          contentRef={handleContentRef}
          style={contentContainerStyle}
          firstItemId={firstHistoryItemId}
          itemIds={historyItemIds}
          scrollContainerRef={scrollContainerRef}
          followOutputRef={followOutputRef}
          onPrepend={recordHistoryAnchor}
          onWindowLayoutChange={preserveVirtualWindowAnchor}
          virtualPaddingTop={virtualWindow.paddingTop}
          virtualStartIndex={virtualWindow.index}
          isToggleAnchoring={isToggleAnchoring}
          isHistoryAnchoring={isHistoryAnchoring}
          readingProcessTurnRef={readingProcessTurnRef}
        >
          {historyStartSlot}
          <div style={virtualTopStyle} data-history-rows>
            {historyRows}
          </div>
          {liveAuxiliary}
          {shouldRenderEmpty ? listEmptyComponent : null}
        </HistoryContent>
      </div>
      <div
        ref={motionOverlayRef}
        inert
        aria-hidden="true"
        data-scrollbar-static
        style={motionOverlayStyle}
      />
    </div>
  );
}

export function createWebStreamStrategy(input: CreateWebStreamStrategyInput): StreamStrategy {
  return createStreamStrategy({
    render: (renderInput) => (
      <WebStreamViewport
        key={renderInput.agentId}
        {...renderInput}
        isMobileBreakpoint={input.isMobileBreakpoint}
      />
    ),
    orderTailReverse: false,
    orderHeadReverse: false,
    assistantTurnTraversalStep: -1,
    edgeSlot: "footer",
    historyLiveBoundaryEdge: "last",
    liveHeadHistoryBoundaryEdge: "first",
    frameChildOrder: "content-then-footer",
    flatListInverted: false,
    overlayScrollbarInverted: false,
    maintainVisibleContentPosition: undefined,
    bottomAnchorTransportBehavior: {
      verificationDelayFrames: 0,
      verificationRetryMode: "rescroll",
    },
    disableParentScrollOnInlineDetailsExpansion: false,
    anchorBottomOnContentSizeChange: true,
    animateManualScrollToBottom: false,
    useVirtualizedList: false,
    isNearBottom: (inputMetrics) => {
      const distanceFromBottom = Math.max(
        0,
        inputMetrics.contentHeight - (inputMetrics.offsetY + inputMetrics.viewportHeight),
      );
      return distanceFromBottom <= inputMetrics.threshold;
    },
    getBottomOffset: (metrics) => Math.max(0, metrics.contentHeight - metrics.viewportHeight),
  });
}
