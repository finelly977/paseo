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
  shouldAutoLoadOlderHistory,
  visibleWebHistoryItems,
} from "./web-virtualization";
import type { StreamItem } from "@/types/stream";
import { getStreamItemDomId } from "./history-index-model";
import type { StreamRenderInput, StreamStrategy, StreamViewportHandle } from "./strategy";
import { createStreamStrategy } from "./strategy";
import { useContentToggleAnchor } from "./use-content-toggle-anchor";

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
const ITEM_JUMP_MAX_FRAMES = 120;
const ITEM_JUMP_CENTER_TOLERANCE_PX = 2;
const ITEM_JUMP_STABLE_FRAMES = 2;

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

function refreshPendingHistoryAnchor(input: {
  scroll: HTMLElement;
  pending: PendingHistoryAnchor | null;
  loading: boolean;
}): void {
  if (!input.loading || !input.pending) return;
  const anchor = readHistoryAnchor(input.scroll);
  if (anchor) input.pending.anchor = anchor;
}

interface WebHistoryRowProps {
  item: StreamItem;
  index: number;
  items: StreamItem[];
  renderRow: StreamRenderInput["renderers"]["renderHistoryVirtualizedRow"];
  measure?: (node: HTMLDivElement | null) => void;
}

const WebHistoryRow = memo(function WebHistoryRow({
  item,
  index,
  items,
  renderRow,
  measure,
}: WebHistoryRowProps) {
  return (
    <div
      data-index={measure ? index : undefined}
      data-stream-row-id={item.id}
      ref={measure}
      style={mountedRowStyle}
    >
      {renderRow(item, index, items)}
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
  virtualWindowLayout: CSSProperties;
  isToggleAnchoring: boolean;
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
    const windowChanged = previous.virtualWindowLayout !== this.props.virtualWindowLayout;
    if (
      (!prepended && (!windowChanged || this.props.isToggleAnchoring)) ||
      !scroll ||
      scroll.clientHeight <= 0 ||
      this.props.followOutputRef.current
    ) {
      return null;
    }
    const anchor = readHistoryAnchor(scroll);
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
  const collapsedHeights = historyRowRevision?.estimatedHeightById;
  const processAnchorIdByItemId = historyRowRevision?.processAnchorIdByItemId;
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
  const segments = useMemo(
    () => ({
      ...sourceSegments,
      historyVirtualized: visibleWebHistoryItems(
        sourceSegments.historyVirtualized,
        collapsedHeights,
      ),
      historyMounted: visibleWebHistoryItems(sourceSegments.historyMounted, collapsedHeights),
    }),
    [sourceSegments, collapsedHeights],
  );
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const handleScrollContainerRef = useCallback((node: HTMLElement | null) => {
    scrollContainerRef.current = node;
  }, []);
  const handleContentRef = useCallback((node: HTMLElement | null) => {
    contentRef.current = node;
  }, []);
  const [followOutput, setFollowOutputr] = useState(true);
  const followOutputRef = useRef(followOutput);
  const setFollowOutput = (value: boolean) => {
    followOutputRef.current = value;
    setFollowOutputr(value);
    return value;
  };
  const lastKnownScrollTopRef = useRef(0);
  const pendingUserScrollUpIntentRef = useRef(false);
  const isPointerScrollActiveRef = useRef(false);
  const lastTouchClientYRef = useRef<number | null>(null);
  const pendingAutoScrollFrameRef = useRef<number | null>(null);
  const pendingAutoScrollTimeoutRef = useRef<number | null>(null);
  const pendingItemJumpFrameRef = useRef<number | null>(null);
  const pendingHistoryAnchorFrameRef = useRef<number | null>(null);
  const historyAnchoringRef = useRef(false);
  const loadingHistoryRef = useRef(isLoadingOlderHistory);
  loadingHistoryRef.current = isLoadingOlderHistory;
  const pendingHistoryAnchorRef = useRef<PendingHistoryAnchor | null>(null);
  const [hasPendingHistoryAnchor, setHasPendingHistoryAnchor] = useState(false);
  const releaseHistoryAnchor = useCallback(() => {
    historyAnchoringRef.current = false;
    pendingHistoryAnchorRef.current = null;
    setHasPendingHistoryAnchor(false);
  }, []);
  const committedHistoryAnchorRef = useRef<HistoryAnchor | null>(null);
  const toggleAnchorItemIdRef = useRef<string | null>(null);
  const recordHistoryAnchor = useCallback((anchor: HistoryAnchor) => {
    historyAnchoringRef.current = true;
    committedHistoryAnchorRef.current = anchor;
  }, []);
  const preserveVirtualWindowAnchor = useCallback((anchor: HistoryAnchor) => {
    const scroll = scrollContainerRef.current;
    if (!scroll) return;
    const selector = anchor.processId
      ? `[data-testid="${CSS.escape(anchor.processId)}"]`
      : `[data-stream-row-id="${CSS.escape(anchor.itemId)}"]`;
    const row = scroll.querySelector<HTMLElement>(selector);
    if (!row) return;
    // 虚拟窗口更换会改动祖先的占位内边距，浏览器此时会抑制自身滚动锚定。
    // 只在本次提交绘制前补齐实际位移，不跨帧锁定位置或抵消后续用户滚动。
    const delta =
      row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - anchor.offset;
    if (Math.abs(delta) > ANCHOR_LAYOUT_EPSILON_PX) {
      scroll.scrollTop += delta;
    }
    lastKnownScrollTopRef.current = scroll.scrollTop;
  }, []);
  const historyStartReadyRef = useRef(false);
  const lastAutoHistoryBackfillSignatureRef = useRef<string | null>(null);
  const shouldUseVirtualizer = segments.historyVirtualized.length > 0;
  const sourceFirstItemId =
    sourceSegments.historyVirtualized[0]?.id ??
    sourceSegments.historyMounted[0]?.id ??
    sourceSegments.liveHead[0]?.id ??
    null;
  const prepareForHistoryPrepend = useCallback(() => {
    const scroll = scrollContainerRef.current;
    const anchor = scroll && !followOutputRef.current ? readHistoryAnchor(scroll) : null;
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
      const heightOverride = collapsedHeights?.get(row.id);
      // 纯入口换承载行后仍是同一个可见条目，复用其已测量高度，避免重新估算。
      const key = processAnchorIdByItemId?.get(row.id) ?? row.id;
      return heightOverride === undefined ? key : `${key}:display-height-${heightOverride}`;
    },
    [segments.historyVirtualized, collapsedHeights, processAnchorIdByItemId],
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
    count: segments.historyVirtualized.length,
    enabled: shouldUseVirtualizer,
    getScrollElement,
    getItemKey,
    estimateSize,
    rangeExtractor: useCallback(
      (range: Parameters<typeof defaultRangeExtractor>[0]) => {
        const toggleItemId = toggleAnchorItemIdRef.current;
        if (toggleItemId !== null) {
          const index = segments.historyVirtualized.findIndex((item) => item.id === toggleItemId);
          if (index >= 0 && (index < range.startIndex || index > range.endIndex)) {
            const endIndex = Math.min(range.count - 1, index + range.endIndex - range.startIndex);
            return defaultRangeExtractor({ ...range, startIndex: index, endIndex });
          }
        }
        const pending = hasPendingHistoryAnchor ? pendingHistoryAnchorRef.current : null;
        if (!pending || pending.firstItemId === sourceFirstItemId)
          return defaultRangeExtractor(range);
        const anchorItemId = resolveHistoryAnchorItemId(pending.anchor);
        const index = segments.historyVirtualized.findIndex((item) => item.id === anchorItemId);
        if (index < 0) return defaultRangeExtractor(range);
        // 新页提交前先保留正在阅读的窗口，不能先挂载新页再靠滚动补救。
        const endIndex = Math.min(
          range.count - 1,
          index + Math.max(1, range.endIndex - range.startIndex),
        );
        return defaultRangeExtractor({ ...range, startIndex: index, endIndex });
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
    const pendingTimeout = pendingAutoScrollTimeoutRef.current;
    if (pendingTimeout !== null) {
      pendingAutoScrollTimeoutRef.current = null;
      window.clearTimeout(pendingTimeout);
    }
  }, []);

  const cancelPendingHistoryAnchor = useCallback(() => {
    historyAnchoringRef.current = false;
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
      scroll.scrollTop = offset;
      lastKnownScrollTopRef.current = scroll.scrollTop;
    },
    detach: () => {
      setFollowOutput(false);
      pendingUserScrollUpIntentRef.current = false;
      cancelPendingStickToBottom();
      cancelPendingHistoryAnchor();
      if (pendingItemJumpFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingItemJumpFrameRef.current);
        pendingItemJumpFrameRef.current = null;
      }
    },
  });
  const cancelToggleAnchor = useCallback(() => {
    toggleAnchorItemIdRef.current = null;
    cancelContentToggleAnchor();
  }, [cancelContentToggleAnchor]);
  useLayoutEffect(() => {
    if (!isToggleAnchoring) toggleAnchorItemIdRef.current = null;
  }, [isToggleAnchoring]);
  useLayoutEffect(() => {
    restoreToggleAnchor();
  });
  const preserveProcessAnchor = useCallback<StreamViewportHandle["preserveScrollAnchor"]>(
    (request) =>
      preserveToggleAnchor({
        ...request,
        applyChange: () => {
          // 展开可能把入口从常驻区移入虚拟区，首个提交就保留该行，不能等它离屏后再测量。
          toggleAnchorItemIdRef.current = request.itemId;
          request.applyChange();
        },
      }),
    [preserveToggleAnchor],
  );

  const scrollMessagesToBottom = useCallback(
    (behavior: ScrollBehaviorLike = "auto") => {
      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer) {
        return;
      }
      if (isScrollContainerOverscrolledPastBottom(scrollContainer)) {
        return;
      }
      scrollElementToBottom(scrollContainer, behavior);
      lastKnownScrollTopRef.current = scrollContainer.scrollTop;
      syncNearBottom(scrollContainer, onNearBottomChange);
    },
    [onNearBottomChange],
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
      if (!followOutputRef.current) {
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

  const updateScrollMetrics = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      onNearBottomChange(true);
      return;
    }
    syncNearBottom(scrollContainer, onNearBottomChange);
  }, [onNearBottomChange]);

  const handleDomScroll = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const currentScrollTop = scrollContainer.scrollTop;
    refreshPendingHistoryAnchor({
      scroll: scrollContainer,
      pending: pendingHistoryAnchorRef.current,
      loading: isLoadingOlderHistory,
    });
    const isAtBottom = isScrollContainerAtBottom(scrollContainer);
    const scrolledUp = currentScrollTop < lastKnownScrollTopRef.current - USER_SCROLL_DELTA_EPSILON;
    const scrolledDown =
      currentScrollTop > lastKnownScrollTopRef.current + USER_SCROLL_DELTA_EPSILON;
    const readingAnchorActive = isToggleAnchoring || historyAnchoringRef.current;

    if (!readingAnchorActive && !followOutputRef.current && isAtBottom && scrolledDown) {
      setFollowOutput(true);
      pendingUserScrollUpIntentRef.current = false;
    } else if (followOutputRef.current && pendingUserScrollUpIntentRef.current) {
      if (scrolledUp || !isAtBottom) {
        cancelPendingStickToBottom();
        setFollowOutput(false);
      }
      pendingUserScrollUpIntentRef.current = false;
    } else if (followOutputRef.current && isPointerScrollActiveRef.current) {
      if (scrolledUp) {
        cancelPendingStickToBottom();
        setFollowOutput(false);
      }
    }

    lastKnownScrollTopRef.current = currentScrollTop;
    updateScrollMetrics();
    if (
      !readingAnchorActive &&
      historyStartReadyRef.current &&
      isAuthoritativeHistoryReady &&
      !isLoadingOlderHistory &&
      hasOlderHistory &&
      currentScrollTop <= HISTORY_START_THRESHOLD_PX
    ) {
      requestOlderHistory();
    }
  }, [
    cancelPendingStickToBottom,
    hasOlderHistory,
    isAuthoritativeHistoryReady,
    isLoadingOlderHistory,
    requestOlderHistory,
    updateScrollMetrics,
    isToggleAnchoring,
  ]);

  const requestOlderHistoryFromUserIntent = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (
      !scrollContainer ||
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

  const autoLoadOlderHistoryIfViewportIsTooShort = useCallback(() => {
    if (isToggleAnchoring || historyAnchoringRef.current || hasPendingHistoryAnchor) return;
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
      historyStartCursor ?? "",
      segments.historyVirtualized[0]?.id ?? "",
      segments.historyVirtualized.at(-1)?.id ?? "",
      segments.historyVirtualized.length,
      segments.historyMounted[0]?.id ?? "",
      segments.historyMounted.at(-1)?.id ?? "",
      segments.historyMounted.length,
      segments.liveHead[0]?.id ?? "",
      segments.liveHead.at(-1)?.id ?? "",
      segments.liveHead.length,
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
    if (!isActivationReady) {
      return;
    }
    if (hasRouteBottomAnchorRequest && !followOutputRef.current) {
      return;
    }
    setFollowOutput(true);
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
    const observer = new ResizeObserver(() => {
      updateScrollMetrics();
      autoLoadOlderHistoryIfViewportIsTooShort();
      if (!followOutputRef.current || historyAnchoringRef.current) {
        return;
      }
      scheduleStickToBottom();
    });
    observer.observe(scrollContainer);
    if (contentNode) {
      observer.observe(contentNode);
    }
    return () => {
      observer.disconnect();
    };
  }, [autoLoadOlderHistoryIfViewportIsTooShort, scheduleStickToBottom, updateScrollMetrics]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      cancelToggleAnchor();
      cancelPendingHistoryAnchor();
      if (event.deltaY < 0) {
        pendingUserScrollUpIntentRef.current = true;
        cancelPendingStickToBottom();
        requestOlderHistoryFromUserIntent();
      }
    };
    const handlePointerDown = () => {
      cancelToggleAnchor();
      cancelPendingHistoryAnchor();
      isPointerScrollActiveRef.current = true;
    };
    const handlePointerUp = () => {
      isPointerScrollActiveRef.current = false;
    };
    const handleTouchStart = (event: TouchEvent) => {
      cancelToggleAnchor();
      cancelPendingHistoryAnchor();
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
      if (previousTouchY !== null && touch.clientY > previousTouchY + 1) {
        pendingUserScrollUpIntentRef.current = true;
        cancelPendingStickToBottom();
        requestOlderHistoryFromUserIntent();
      }
      lastTouchClientYRef.current = touch.clientY;
    };
    const handleTouchEnd = () => {
      lastTouchClientYRef.current = null;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      cancelToggleAnchor();
      const editingText =
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, select, [contenteditable='true']") !== null;
      if (event.defaultPrevented || editingText) return;
      if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") {
        cancelPendingHistoryAnchor();
        pendingUserScrollUpIntentRef.current = true;
        cancelPendingStickToBottom();
        requestOlderHistoryFromUserIntent();
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
  }, [
    cancelPendingHistoryAnchor,
    cancelToggleAnchor,
    cancelPendingStickToBottom,
    handleDomScroll,
    hasOlderHistory,
    isAuthoritativeHistoryReady,
    isLoadingOlderHistory,
    onNearHistoryStart,
    requestOlderHistoryFromUserIntent,
  ]);

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
      overflowAnchor: isToggleAnchoring ? "none" : "auto",
      overscrollBehaviorY: "contain",
    };
  }, [scrollEnabled, isToggleAnchoring]);
  const virtualRowsContainerStyle = useMemo((): CSSProperties => {
    const virtualPaddingTop = virtualRows[0]?.start ?? 0;
    const virtualPaddingBottom = Math.max(0, virtualTotalSize - (virtualRows.at(-1)?.end ?? 0));
    return {
      display: "flex",
      flexDirection: "column",
      width: "100%",
      paddingTop: virtualPaddingTop,
      paddingBottom: virtualPaddingBottom,
      flexShrink: 0,
    };
  }, [virtualRows, virtualTotalSize]);
  const mountedHistoryRows = useMemo(() => {
    return segments.historyMounted.map((item, index) => (
      <WebHistoryRow
        key={item.id}
        item={item}
        index={index}
        items={segments.historyMounted}
        renderRow={renderHistoryMountedRow}
      />
    ));
  }, [renderHistoryMountedRow, segments.historyMounted]);
  const liveHeadRows = useMemo(() => {
    void liveHeadRowRevision;
    return segments.liveHead.map((item, index) => (
      <div key={item.id} data-stream-row-id={item.id} style={mountedRowStyle}>
        {renderLiveHeadRow(item, index, segments.liveHead)}
      </div>
    ));
  }, [liveHeadRowRevision, renderLiveHeadRow, segments.liveHead]);
  const mountedRows = useMemo(
    () => [...mountedHistoryRows, ...liveHeadRows],
    [liveHeadRows, mountedHistoryRows],
  );
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
    (anchor: HistoryAnchor) => {
      const scroll = scrollContainerRef.current;
      if (!scroll) return;
      let stableFrames = 0;
      let remainingFrames = ITEM_JUMP_MAX_FRAMES;
      const restoreMounted = () => {
        const selector = anchor.processId
          ? `[data-testid="${CSS.escape(anchor.processId)}"]`
          : `[data-stream-row-id="${CSS.escape(anchor.itemId)}"]`;
        const row = scroll.querySelector<HTMLElement>(selector);
        if (!row) return false;
        const delta =
          row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - anchor.offset;
        if (Math.abs(delta) > ANCHOR_LAYOUT_EPSILON_PX) {
          stableFrames = 0;
          scroll.scrollTop += delta;
        } else {
          stableFrames += 1;
        }
        lastKnownScrollTopRef.current = scroll.scrollTop;
        return true;
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
        rowVirtualizer.scrollToOffset(target[0] + conversationVerticalPadding - anchor.offset);
        lastKnownScrollTopRef.current = scroll.scrollTop;
      }
      if (pendingHistoryAnchorFrameRef.current !== null)
        window.cancelAnimationFrame(pendingHistoryAnchorFrameRef.current);
      // 补页后的新行会继续修正占位，阅读锚点需要保持到连续两帧布局稳定。
      const settleAnchor = () => {
        pendingHistoryAnchorFrameRef.current = null;
        if (scroll.clientHeight <= 0) {
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
      cancelPendingHistoryAnchor();
      setFollowOutput(false);
      cancelPendingStickToBottom();
      if (pendingItemJumpFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingItemJumpFrameRef.current);
        pendingItemJumpFrameRef.current = null;
      }
      const virtualIndex = segments.historyVirtualized.findIndex((item) => item.id === itemId);
      let remainingFrames = ITEM_JUMP_MAX_FRAMES;
      let stableFrames = 0;
      let requestedDomCenter = false;
      const settleTarget = () => {
        pendingItemJumpFrameRef.current = null;
        const scrollContainer = scrollContainerRef.current;
        const target = scrollContainer ? document.getElementById(getStreamItemDomId(itemId)) : null;
        if (
          !scrollContainer ||
          !(target instanceof HTMLElement) ||
          !scrollContainer.contains(target)
        ) {
          stableFrames = 0;
          if (virtualIndex >= 0) {
            rowVirtualizer.scrollToIndex(virtualIndex, { align: "center", behavior: "auto" });
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
            target.scrollIntoView({ behavior: "auto", block: "center" });
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
        virtualWindowLayout={virtualRowsContainerStyle}
        isToggleAnchoring={isToggleAnchoring}
      >
        {historyStartSlot}
        {shouldUseVirtualizer ? (
          <div style={virtualRowsContainerStyle}>
            {virtualRows.map((virtualRow) => {
              const item = segments.historyVirtualized[virtualRow.index];
              if (!item) {
                return null;
              }
              return (
                <WebHistoryRow
                  key={virtualRow.key}
                  item={item}
                  index={virtualRow.index}
                  items={segments.historyVirtualized}
                  measure={measureVirtualizedRowElement}
                  renderRow={renderHistoryVirtualizedRow}
                />
              );
            })}
          </div>
        ) : null}
        {mountedRows}
        {liveAuxiliary}
        {shouldRenderEmpty ? listEmptyComponent : null}
      </HistoryContent>
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
