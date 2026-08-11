import React, {
  Fragment,
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityIndicator } from "react-native";
import { measureElement as measureVirtualElement, useVirtualizer } from "@tanstack/react-virtual";
import { estimateStreamItemHeight, shouldAdjustScrollForMeasuredItem } from "./web-virtualization";
import { getStreamItemDomId } from "./history-index-model";
import type { StreamRenderInput, StreamStrategy, StreamViewportHandle } from "./strategy";
import { createStreamStrategy } from "./strategy";

interface CreateWebStreamStrategyInput {
  isMobileBreakpoint: boolean;
}

type ScrollBehaviorLike = "auto" | "smooth";

const WEB_BOTTOM_SETTLE_TIMEOUT_MS = 200;
const USER_SCROLL_DELTA_EPSILON = 1;
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

function WebStreamViewport(props: StreamRenderInput & { isMobileBreakpoint: boolean }) {
  const {
    segments,
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
    scrollEnabled,
    messageParagraphSpacing,
    conversationVerticalPadding = 16,
    conversationHorizontalPadding,
    isMobileBreakpoint,
  } = props;
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
  const historyStartReadyRef = useRef(false);
  const shouldUseVirtualizer = segments.historyVirtualized.length > 0;
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

  const rowVirtualizer = useVirtualizer({
    count: segments.historyVirtualized.length,
    enabled: shouldUseVirtualizer,
    getScrollElement: () => scrollContainerRef.current,
    getItemKey: (index: number) => {
      const row = segments.historyVirtualized[index];
      if (!row) {
        return index;
      }
      const heightOverride = historyRowRevision?.estimatedHeightById.get(row.id);
      return heightOverride === undefined ? row.id : `${row.id}:display-height-${heightOverride}`;
    },
    estimateSize: (index: number) => {
      const row = segments.historyVirtualized[index];
      return row
        ? estimateStreamItemHeight(
            row,
            messageParagraphSpacing,
            historyRowRevision?.estimatedHeightById.get(row.id),
          )
        : 120;
    },
    measureElement: measureVirtualElement,
    useAnimationFrameWithResizeObserver: true,
    overscan: 8,
  });
  useEffect(() => {
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
      const viewportHeight = instance.scrollRect?.height ?? 0;
      const scrollOffset = instance.scrollOffset ?? 0;
      const remainingDistance = instance.getTotalSize() - (scrollOffset + viewportHeight);
      return shouldAdjustScrollForMeasuredItem({
        itemStart: item.start,
        scrollOffset,
        distanceFromBottom: remainingDistance,
        bottomThreshold: AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
      });
    };
    return () => {
      rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
    };
  }, [rowVirtualizer]);
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualTotalSize = rowVirtualizer.getTotalSize();

  // Measure during commit, not a frame later. Deferring guarantees one painted frame
  // at the estimated height before the correction lands, which reads as the row
  // expanding/collapsing while scrolling up into unmeasured history. Rows that resize
  // afterwards (markdown, images) are still caught by the virtualizer's
  // ResizeObserver, which runs on an animation frame.
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
    const isAtBottom = isScrollContainerAtBottom(scrollContainer);
    const scrolledUp = currentScrollTop < lastKnownScrollTopRef.current - USER_SCROLL_DELTA_EPSILON;
    const scrolledDown =
      currentScrollTop > lastKnownScrollTopRef.current + USER_SCROLL_DELTA_EPSILON;

    if (!followOutputRef.current && isAtBottom && scrolledDown) {
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
      historyStartReadyRef.current &&
      hasOlderHistory &&
      currentScrollTop <= HISTORY_START_THRESHOLD_PX
    ) {
      onNearHistoryStart();
    }
  }, [cancelPendingStickToBottom, hasOlderHistory, onNearHistoryStart, updateScrollMetrics]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      historyStartReadyRef.current = true;
    });
    return () => {
      window.cancelAnimationFrame(frame);
      historyStartReadyRef.current = false;
    };
  }, [props.agentId]);

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
      if (!followOutputRef.current) {
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
      if (!followOutputRef.current) {
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
  }, [scheduleStickToBottom, updateScrollMetrics]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        pendingUserScrollUpIntentRef.current = true;
        cancelPendingStickToBottom();
      }
    };
    const handlePointerDown = () => {
      isPointerScrollActiveRef.current = true;
    };
    const handlePointerUp = () => {
      isPointerScrollActiveRef.current = false;
    };
    const handleTouchStart = (event: TouchEvent) => {
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
      }
      lastTouchClientYRef.current = touch.clientY;
    };
    const handleTouchEnd = () => {
      lastTouchClientYRef.current = null;
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
    };
  }, [cancelPendingStickToBottom, handleDomScroll]);

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
      overscrollBehaviorY: "contain",
    };
  }, [scrollEnabled]);
  const virtualRowsContainerStyle = useMemo((): CSSProperties => {
    return {
      position: "relative",
      width: "100%",
      height: virtualTotalSize,
    };
  }, [virtualTotalSize]);
  const renderVirtualRowStyle = useCallback(
    (start: number): CSSProperties => ({
      position: "absolute",
      top: 0,
      left: 0,
      display: "flex",
      flexDirection: "column",
      width: "100%",
      transform: `translateY(${start}px)`,
    }),
    [],
  );
  const mountedHistoryRows = useMemo(() => {
    return segments.historyMounted.map((item, index) => (
      <Fragment key={item.id}>
        {renderHistoryMountedRow(item, index, segments.historyMounted)}
      </Fragment>
    ));
  }, [renderHistoryMountedRow, segments.historyMounted]);
  const liveHeadRows = useMemo(() => {
    void liveHeadRowRevision;
    return segments.liveHead.map((item, index) => (
      <Fragment key={item.id}>{renderLiveHeadRow(item, index, segments.liveHead)}</Fragment>
    ));
  }, [liveHeadRowRevision, renderLiveHeadRow, segments.liveHead]);
  const mountedRows = useMemo(
    () => [...mountedHistoryRows, ...liveHeadRows],
    [liveHeadRows, mountedHistoryRows],
  );
  const liveAuxiliary = useMemo(() => {
    return renderLiveAuxiliary();
  }, [renderLiveAuxiliary]);
  const scrollToItem = useCallback(
    (itemId: string) => {
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
    [cancelPendingStickToBottom, rowVirtualizer, segments.historyVirtualized],
  );
  useEffect(() => {
    const handle: StreamViewportHandle = {
      scrollToBottom: () => {
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
    cancelPendingStickToBottom,
    forceStickToBottom,
    scheduleStickToBottom,
    scrollToItem,
    viewportRef,
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
      <div ref={handleContentRef} style={contentContainerStyle}>
        {historyStartSlot}
        {shouldUseVirtualizer ? (
          <div style={virtualRowsContainerStyle}>
            {virtualRows.map((virtualRow) => {
              const item = segments.historyVirtualized[virtualRow.index];
              if (!item) {
                return null;
              }
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={measureVirtualizedRowElement}
                  style={renderVirtualRowStyle(virtualRow.start)}
                >
                  {renderHistoryVirtualizedRow(item, virtualRow.index, segments.historyVirtualized)}
                </div>
              );
            })}
          </div>
        ) : null}
        {mountedRows}
        {liveAuxiliary}
        {shouldRenderEmpty ? listEmptyComponent : null}
      </div>
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
