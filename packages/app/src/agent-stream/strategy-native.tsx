import React, {
  Fragment,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FlatList,
  ActivityIndicator,
  Keyboard,
  Platform,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import type { StreamItem } from "@/types/stream";
import { Button } from "@/components/ui/button";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { shouldLoadNativeHistory, visibleNativeHistoryRows } from "./native-history-pagination";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useBottomAnchorController } from "./bottom-anchor-controller";
import { useContentToggleAnchor } from "./use-content-toggle-anchor";
import type { ContentToggleRequest } from "./content-toggle-anchor";
import type { StreamRenderInput, StreamStrategy, StreamViewportHandle } from "./strategy";
import {
  createStreamStrategy,
  isNearBottomForStreamRenderStrategy,
  resolveBottomAnchorTransportBehavior,
} from "./strategy";

const DEFAULT_MAINTAIN_VISIBLE_CONTENT_POSITION = Object.freeze({
  minIndexForVisible: 0,
  autoscrollToTopThreshold: 0,
});
const HISTORY_FOOTER_STYLE = { alignItems: "center", paddingVertical: 12 } as const;
const VIEWPORT_STYLE = { flex: 1 } as const;
const HISTORY_EDGE_STYLE = { width: 1, height: 1 } as const;

interface HistoryRowDisplayVariants {
  regular?: StreamItem;
  compact?: StreamItem;
}

const historyRowDisplayVariants = new WeakMap<StreamItem, HistoryRowDisplayVariants>();

function getHistoryRowDisplayVariant(item: StreamItem, compact: boolean): StreamItem {
  let variants = historyRowDisplayVariants.get(item);
  if (!variants) {
    variants = {};
    historyRowDisplayVariants.set(item, variants);
  }
  const key = compact ? "compact" : "regular";
  variants[key] ??= { ...item };
  return variants[key];
}

function keyExtractor(item: { id: string }): string {
  return item.id;
}

function measureAnchorBounds(input: {
  scroll: View;
  edge: View;
  onMeasured: (bounds: { scrollTop: number; edgeTop: number }) => void;
}): void {
  input.scroll.measureInWindow((_x, scrollTop) => {
    input.edge.measureInWindow((_edgeX, edgeTop) => input.onMeasured({ scrollTop, edgeTop }));
  });
}

function NativeStreamViewport(props: StreamRenderInput & { strategy: StreamStrategy }) {
  const isActive = useRetainedPanelActive();
  const {
    agentId,
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
    historyStartCursor,
    scrollEnabled,
    listStyle,
    baseListContentContainerStyle,
    strategy,
  } = props;
  const { renderHistoryMountedRow, renderLiveHeadRow, renderLiveAuxiliary } = renderers;
  const flatListRef = useRef<FlatList<StreamItem>>(null);
  const nativeViewportRef = useRef<View>(null);
  const historyEdgeRef = useRef<View>(null);
  const [preservedTopGap, setPreservedTopGap] = useState(0);
  const nativeContentStyle = useMemo(
    () => [
      baseListContentContainerStyle,
      {
        paddingBottom: (props.conversationVerticalPadding ?? 0) + preservedTopGap,
      },
    ],
    [baseListContentContainerStyle, props.conversationVerticalPadding, preservedTopGap],
  );
  const streamViewportMetricsRef = useRef({
    containerKey: "native-virtualized",
    contentHeight: 0,
    viewportWidth: 0,
    viewportHeight: 0,
    offsetY: 0,
    viewportMeasuredForKey: null as string | null,
    contentMeasuredForKey: null as string | null,
  });
  const scrollOffsetYRef = useRef(0);
  const isUserScrollActiveRef = useRef(false);
  const userScrollEndFrameIdRef = useRef<number | null>(null);
  const programmaticScrollEventBudgetRef = useRef(0);
  const [isNativeViewportSettling, setIsNativeViewportSettling] = useState(false);
  const nativeViewportSettlingFrameIdRef = useRef<number | null>(null);
  const historyStartReadyRef = useRef(false);
  const lastHistoryRequestRef = useRef<string | null>(null);
  const toggleTargetRef = useRef<{
    itemId: string;
    previousIndex: number;
    viewportTop: number;
    revealedIndex: number | null;
    contentHeight: number;
    contentChanged: boolean;
    topGap: number;
    resolved: boolean;
    lastMeasuredIndex: number;
  } | null>(null);

  const loadHistoryAtOldestEdge = useStableEvent((manual = false) => {
    if (isToggleAnchoring) return;
    const metrics = streamViewportMetricsRef.current;
    if (
      !shouldLoadNativeHistory({
        ready:
          historyStartReadyRef.current &&
          isActive &&
          isAuthoritativeHistoryReady &&
          metrics.contentMeasuredForKey !== null,
        hasOlder: hasOlderHistory,
        loading: isLoadingOlderHistory,
        viewportHeight: metrics.viewportHeight,
        contentHeight: metrics.contentHeight,
        offsetY: metrics.offsetY,
      })
    )
      return;
    const requestKey = `${agentId}:${historyStartCursor ?? ""}:${segments.historyMounted.length}:${segments.historyVirtualized.length}`;
    // 自动补页失败后停在当前游标，由滚动或点击明确重试，避免无限请求。
    if (!manual && lastHistoryRequestRef.current === requestKey) return;
    lastHistoryRequestRef.current = requestKey;
    onNearHistoryStart();
  });
  const handleManualHistoryLoad = useStableEvent(() => loadHistoryAtOldestEdge(true));
  const handleEndReached = useStableEvent(() => loadHistoryAtOldestEdge());

  const historyItems = useMemo(() => {
    if (segments.historyVirtualized.length === 0) {
      return segments.historyMounted;
    }
    return [...segments.historyVirtualized, ...segments.historyMounted];
  }, [segments.historyMounted, segments.historyVirtualized]);
  // Keep unchanged item identities intact so live updates only rerender rows
  // whose projected content or local display state actually changed. A rare
  // breakpoint change intentionally refreshes the whole history window.
  const globallyRevisedHistoryRows = useMemo(() => {
    const globalDisplayState = historyRowRevision?.globalDisplayState ?? false;
    return historyItems.map((item) => getHistoryRowDisplayVariant(item, globalDisplayState));
  }, [historyItems, historyRowRevision?.globalDisplayState]);
  const displayStateHistoryRows = useMemo(
    () =>
      globallyRevisedHistoryRows.map((item) =>
        historyRowRevision?.displayStateById.has(item.id) ? { ...item } : item,
      ),
    [globallyRevisedHistoryRows, historyRowRevision?.displayStateById],
  );
  const historyRows = useMemo(() => {
    const visibleRows = historyRowRevision
      ? visibleNativeHistoryRows({
          items: displayStateHistoryRows,
          collapsedHeights: historyRowRevision.estimatedHeightById,
        })
      : displayStateHistoryRows;
    // 只替换内容发生变化的行引用，不能原地修改共享时间线对象。
    // oxlint-disable-next-line oxc/no-map-spread
    return visibleRows.map((item) =>
      historyRowRevision?.contentById.has(item.id) ? { ...item } : item,
    );
  }, [displayStateHistoryRows, historyRowRevision]);

  const clearNativeViewportSettling = useCallback(() => {
    if (nativeViewportSettlingFrameIdRef.current !== null) {
      cancelAnimationFrame(nativeViewportSettlingFrameIdRef.current);
      nativeViewportSettlingFrameIdRef.current = null;
    }
  }, []);

  const clearPendingUserScrollEnd = useCallback(() => {
    if (userScrollEndFrameIdRef.current !== null) {
      cancelAnimationFrame(userScrollEndFrameIdRef.current);
      userScrollEndFrameIdRef.current = null;
    }
  }, []);

  const markNativeViewportSettling = useCallback(() => {
    clearNativeViewportSettling();
    setIsNativeViewportSettling(true);
    let remainingFrames = 4;
    const tick = () => {
      if (remainingFrames <= 0) {
        nativeViewportSettlingFrameIdRef.current = null;
        setIsNativeViewportSettling(false);
        return;
      }
      remainingFrames -= 1;
      nativeViewportSettlingFrameIdRef.current = requestAnimationFrame(tick);
    };
    nativeViewportSettlingFrameIdRef.current = requestAnimationFrame(tick);
  }, [clearNativeViewportSettling]);

  const bottomAnchorTransportBehavior = useMemo(
    () =>
      resolveBottomAnchorTransportBehavior({
        strategy,
        isViewportSettling: isNativeViewportSettling,
      }),
    [isNativeViewportSettling, strategy],
  );

  const scrollToBottom = useCallback(
    (animated: boolean) => {
      programmaticScrollEventBudgetRef.current = 3;
      flatListRef.current?.scrollToOffset({
        offset: 0,
        animated,
      });
      scrollOffsetYRef.current = 0;
      streamViewportMetricsRef.current = {
        ...streamViewportMetricsRef.current,
        offsetY: 0,
      };
      onNearBottomChange(true);
    },
    [onNearBottomChange],
  );

  const bottomAnchorController = useBottomAnchorController({
    agentId,
    routeRequest: routeBottomAnchorRequest,
    isAuthoritativeHistoryReady,
    renderStrategy: "inverted-stream",
    transportBehavior: bottomAnchorTransportBehavior,
    getMeasurementState: () => streamViewportMetricsRef.current,
    isNearBottom: () => {
      const metrics = streamViewportMetricsRef.current;
      return isNearBottomForStreamRenderStrategy({
        strategy,
        offsetY: metrics.offsetY,
        threshold: 32,
        contentHeight: metrics.contentHeight,
        viewportHeight: metrics.viewportHeight,
      });
    },
    scrollToBottom,
  });
  const setAnchorOffset = useStableEvent((offset: number) => {
    programmaticScrollEventBudgetRef.current = 3;
    scrollOffsetYRef.current = offset;
    streamViewportMetricsRef.current.offsetY = offset;
    flatListRef.current?.scrollToOffset({ offset, animated: false });
  });
  const {
    active: isToggleAnchoring,
    preserve: preserveToggleAnchor,
    cancel: cancelToggleAnchor,
  } = useContentToggleAnchor({
    inverted: true,
    getOffset: () => scrollOffsetYRef.current,
    setOffset: setAnchorOffset,
    detach: () => {
      clearPendingUserScrollEnd();
      bottomAnchorController.detachByUser();
    },
  });
  const preserveProcessAnchor = useStableEvent((request: ContentToggleRequest) => {
    let captured = false;
    let capturedTarget: typeof toggleTargetRef.current = null;
    const previousIndex = historyRows.findIndex((item) => item.id === request.itemId);
    preserveToggleAnchor({
      ...request,
      applyChange: () => {
        // 只在共享控制器确认本次点击仍有效后发布原生定位目标。
        toggleTargetRef.current = capturedTarget;
        if (capturedTarget) setPreservedTopGap(capturedTarget.topGap);
        request.applyChange();
      },
      measure: (callback) => {
        if (captured) revealProcessAnchor(true);
        request.measure((top) => {
          if (captured || top === null) {
            const target = toggleTargetRef.current;
            if (captured && target !== capturedTarget) {
              callback(null);
              return;
            }
            if (captured && target && !target.contentChanged) {
              callback(null);
              return;
            }
            if (captured && target) target.resolved = top !== null;
            callback(top);
            return;
          }
          captured = true;
          const scroll = nativeViewportRef.current;
          const edge = historyEdgeRef.current;
          if (!scroll || !edge) {
            callback(null);
            return;
          }
          measureAnchorBounds({
            scroll,
            edge,
            onMeasured: ({ scrollTop, edgeTop }) => {
              capturedTarget = {
                itemId: request.itemId,
                previousIndex,
                viewportTop: top - scrollTop,
                revealedIndex: null,
                contentHeight: streamViewportMetricsRef.current.contentHeight,
                contentChanged: false,
                topGap:
                  streamViewportMetricsRef.current.contentHeight <=
                  streamViewportMetricsRef.current.viewportHeight + 1
                    ? Math.max(preservedTopGap, edgeTop - scrollTop)
                    : preservedTopGap,
                resolved: false,
                lastMeasuredIndex: -1,
              };
              console.debug("[AgentStream] Captured process anchor", {
                itemId: request.itemId,
                top,
                scrollTop,
                edgeTop,
                contentHeight: streamViewportMetricsRef.current.contentHeight,
                viewportHeight: streamViewportMetricsRef.current.viewportHeight,
                topGap: capturedTarget.topGap,
              });
              callback(top);
            },
          });
        });
      },
    });
  });
  const revealProcessAnchor = useStableEvent((force = false) => {
    const target = toggleTargetRef.current;
    if (!isToggleAnchoring || !target || target.resolved) return;
    const index = historyRows.findIndex((item) => item.id === target.itemId);
    if (index < 0)
      console.debug("[AgentStream] Missing process row", {
        itemId: target.itemId,
        count: historyRows.length,
      });
    if (index < 0 || index === target.previousIndex || (!force && index === target.revealedIndex))
      return;
    // 展开会把同一个入口移到较大的虚拟下标，先让其重新进入渲染窗口，再精确校正屏幕坐标。
    target.revealedIndex = index;
    flatListRef.current?.scrollToIndex({
      index,
      viewPosition: 1,
      viewOffset: -target.viewportTop,
      animated: false,
    });
  });
  useLayoutEffect(() => {
    if (!isToggleAnchoring) {
      toggleTargetRef.current = null;
      return;
    }
    revealProcessAnchor();
  }, [historyRows, isToggleAnchoring, revealProcessAnchor]);
  const handleScrollToIndexFailed = useStableEvent(
    (input: { index: number; averageItemLength: number; highestMeasuredFrameIndex: number }) => {
      const target = toggleTargetRef.current;
      if (!isToggleAnchoring || !target) {
        console.error(
          "[AgentStream] 历史定位目标尚未测量",
          new Error("Unmeasured history row"),
          input,
        );
        return;
      }
      if (target.lastMeasuredIndex !== input.highestMeasuredFrameIndex) {
        target.lastMeasuredIndex = input.highestMeasuredFrameIndex;
        console.debug("[AgentStream] Seeking process row", {
          ...input,
          contentHeight: streamViewportMetricsRef.current.contentHeight,
          viewportHeight: streamViewportMetricsRef.current.viewportHeight,
          offset: scrollOffsetYRef.current,
        });
      }
      setAnchorOffset(
        Math.max(
          0,
          input.averageItemLength * (input.index + 1) -
            streamViewportMetricsRef.current.viewportHeight +
            target.viewportTop,
        ),
      );
    },
  );
  useEffect(() => {
    const frame = requestAnimationFrame(() => loadHistoryAtOldestEdge());
    return () => cancelAnimationFrame(frame);
  }, [
    historyStartCursor,
    isLoadingOlderHistory,
    isAuthoritativeHistoryReady,
    hasOlderHistory,
    isToggleAnchoring,
    isActive,
    segments.historyMounted.length,
    segments.historyVirtualized.length,
    loadHistoryAtOldestEdge,
  ]);

  // Android's maintainVisibleContentPosition ignores the list inversion transform and
  // fights the controller's offset-zero correction while the live header grows.
  const maintainVisibleContentPosition =
    isToggleAnchoring ||
    (Platform.OS === "android" && bottomAnchorController.mode === "sticky-bottom")
      ? undefined
      : DEFAULT_MAINTAIN_VISIBLE_CONTENT_POSITION;

  useLayoutEffect(() => {
    streamViewportMetricsRef.current = {
      containerKey: "native-virtualized",
      contentHeight: 0,
      viewportWidth: 0,
      viewportHeight: 0,
      offsetY: 0,
      viewportMeasuredForKey: null,
      contentMeasuredForKey: null,
    };
    scrollOffsetYRef.current = 0;
    isUserScrollActiveRef.current = false;
    clearPendingUserScrollEnd();
    clearNativeViewportSettling();
    setIsNativeViewportSettling(false);
    historyStartReadyRef.current = false;
    setPreservedTopGap(0);
    lastHistoryRequestRef.current = null;
    const frame = requestAnimationFrame(() => {
      historyStartReadyRef.current = true;
      loadHistoryAtOldestEdge();
    });
    return () => {
      cancelAnimationFrame(frame);
      clearPendingUserScrollEnd();
    };
  }, [agentId, clearNativeViewportSettling, clearPendingUserScrollEnd, loadHistoryAtOldestEdge]);

  useEffect(() => {
    if (!isActive) cancelToggleAnchor();
    return () => cancelToggleAnchor();
  }, [agentId, isActive, cancelToggleAnchor]);

  useEffect(() => {
    if (!isActive) return;
    const keyboardEvents = [
      "keyboardWillShow",
      "keyboardWillHide",
      "keyboardDidShow",
      "keyboardDidHide",
      "keyboardWillChangeFrame",
      "keyboardDidChangeFrame",
    ] as const;
    const subscriptions = keyboardEvents.map((eventName) =>
      Keyboard.addListener(eventName, () => {
        markNativeViewportSettling();
      }),
    );
    return () => {
      for (const subscription of subscriptions) {
        subscription.remove();
      }
      clearNativeViewportSettling();
    };
  }, [clearNativeViewportSettling, markNativeViewportSettling, isActive]);

  useEffect(() => {
    bottomAnchorController.prepareForStickyContentChange();
  }, [bottomAnchorController, historyRows, segments.liveHead]);

  useEffect(() => {
    const handle: StreamViewportHandle = {
      preserveScrollAnchor: preserveProcessAnchor,
      scrollToBottom: (reason = "jump-to-bottom") => {
        cancelToggleAnchor();
        setPreservedTopGap(0);
        bottomAnchorController.requestLocalAnchor({
          agentId,
          reason,
        });
      },
      scrollToItem: (itemId) => {
        cancelToggleAnchor();
        const index = historyRows.findIndex((item) => item.id === itemId);
        if (index >= 0) {
          try {
            flatListRef.current?.scrollToIndex({
              index,
              animated: true,
              viewPosition: 0.4,
            });
          } catch (error) {
            console.error("[AgentStream] 消息跳转失败", error);
          }
          return;
        }
        if (segments.liveHead.some((item) => item.id === itemId)) {
          bottomAnchorController.requestLocalAnchor({ agentId, reason: "jump-to-bottom" });
        }
      },
      prepareForViewportChange: () => {
        bottomAnchorController.prepareForStickyViewportChange();
        markNativeViewportSettling();
      },
    };
    viewportRef.current = handle;
    return () => {
      if (viewportRef.current === handle) {
        viewportRef.current = null;
      }
    };
  }, [
    agentId,
    bottomAnchorController,
    historyRows,
    markNativeViewportSettling,
    segments.liveHead,
    viewportRef,
    preserveProcessAnchor,
    cancelToggleAnchor,
  ]);

  const isScrollEventNearBottom = useStableEvent(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      return isNearBottomForStreamRenderStrategy({
        strategy,
        offsetY: contentOffset.y,
        threshold: 32,
        contentHeight: contentSize.height,
        viewportHeight: layoutMeasurement.height,
      });
    },
  );

  const handleScroll = useStableEvent((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const previousOffsetY = scrollOffsetYRef.current;
    scrollOffsetYRef.current = contentOffset.y;
    streamViewportMetricsRef.current = {
      contentHeight: Math.max(0, contentSize.height),
      viewportWidth: Math.max(0, layoutMeasurement.width),
      viewportHeight: Math.max(0, layoutMeasurement.height),
      containerKey: "native-virtualized",
      offsetY: contentOffset.y,
      viewportMeasuredForKey: "native-virtualized",
      contentMeasuredForKey: "native-virtualized",
    };

    const nearBottom = isScrollEventNearBottom(event);
    onNearBottomChange(nearBottom);

    loadHistoryAtOldestEdge(isUserScrollActiveRef.current);

    if (
      !isUserScrollActiveRef.current &&
      programmaticScrollEventBudgetRef.current > 0 &&
      contentOffset.y <= 8
    ) {
      programmaticScrollEventBudgetRef.current -= 1;
    } else {
      programmaticScrollEventBudgetRef.current = 0;
      bottomAnchorController.handleScrollNearBottomChange({
        nextIsNearBottom: nearBottom,
        scrollDelta: contentOffset.y - previousOffsetY,
      });
    }
  });

  const handleScrollBeginDrag = useStableEvent(() => {
    cancelToggleAnchor();
    clearPendingUserScrollEnd();
    isUserScrollActiveRef.current = true;
    bottomAnchorController.beginUserScroll();
  });

  // Defer drag end so momentum can take ownership, but capture the terminal
  // gesture position now because layout may move the viewport in the meantime.
  const handleScrollEndDrag = useStableEvent((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const isNearBottom = isScrollEventNearBottom(event);
    clearPendingUserScrollEnd();
    userScrollEndFrameIdRef.current = requestAnimationFrame(() => {
      userScrollEndFrameIdRef.current = null;
      isUserScrollActiveRef.current = false;
      bottomAnchorController.endUserScroll({ isNearBottom });
    });
  });

  const handleMomentumScrollBegin = useStableEvent(() => {
    clearPendingUserScrollEnd();
  });

  const handleMomentumScrollEnd = useStableEvent(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const isNearBottom = isScrollEventNearBottom(event);
      clearPendingUserScrollEnd();
      isUserScrollActiveRef.current = false;
      bottomAnchorController.endUserScroll({ isNearBottom });
    },
  );

  const handleListLayout = useStableEvent((event: LayoutChangeEvent) => {
    const previousViewportWidth = streamViewportMetricsRef.current.viewportWidth;
    const previousViewportHeight = streamViewportMetricsRef.current.viewportHeight;
    const viewportWidth = Math.max(0, event.nativeEvent.layout.width);
    const viewportHeight = Math.max(0, event.nativeEvent.layout.height);
    if (!isActive || viewportWidth <= 0 || viewportHeight <= 0) return;
    const viewportChanged =
      (previousViewportWidth > 0 && previousViewportWidth !== viewportWidth) ||
      (previousViewportHeight > 0 && previousViewportHeight !== viewportHeight);
    streamViewportMetricsRef.current = {
      ...streamViewportMetricsRef.current,
      containerKey: "native-virtualized",
      viewportWidth,
      viewportHeight,
      viewportMeasuredForKey: "native-virtualized",
    };
    if (viewportChanged) {
      markNativeViewportSettling();
    }
    bottomAnchorController.handleViewportMetricsChange({
      previousViewportWidth,
      viewportWidth,
      previousViewportHeight,
      viewportHeight,
    });
    loadHistoryAtOldestEdge();
  });

  const handleContentSizeChange = useStableEvent((_width: number, height: number) => {
    if (!isActive || height <= 0) return;
    const previousContentHeight = streamViewportMetricsRef.current.contentHeight;
    const nextContentHeight = Math.max(0, height);
    const target = toggleTargetRef.current;
    if (target && nextContentHeight !== target.contentHeight) target.contentChanged = true;
    streamViewportMetricsRef.current = {
      ...streamViewportMetricsRef.current,
      containerKey: "native-virtualized",
      contentHeight: nextContentHeight,
      contentMeasuredForKey: "native-virtualized",
    };
    bottomAnchorController.handleContentSizeChange({
      previousContentHeight,
      contentHeight: nextContentHeight,
    });
    revealProcessAnchor(true);
    loadHistoryAtOldestEdge();
  });

  const renderItem = useStableEvent(
    ({ item, index }: ListRenderItemInfo<StreamItem>): ReactElement | null => {
      const rendered = renderHistoryMountedRow(item, index, historyItems);
      return (rendered ?? null) as ReactElement | null;
    },
  );

  const liveHeaderContent = useMemo(() => {
    // Stable render events read the latest expansion state; this revision makes
    // the memo invoke them again when that state changes.
    void liveHeadRowRevision;
    const liveHeadRows = segments.liveHead.map((item, index) => (
      <Fragment key={item.id}>{renderLiveHeadRow(item, index, segments.liveHead)}</Fragment>
    ));
    const liveAuxiliary = renderLiveAuxiliary();
    if (
      liveHeadRows.length === 0 &&
      !liveAuxiliary &&
      !boundary.hasMountedHistory &&
      !boundary.hasVirtualizedHistory
    ) {
      return (listEmptyComponent ?? null) as ReactElement | null;
    }
    return (
      <Fragment>
        {liveHeadRows}
        {liveAuxiliary}
      </Fragment>
    );
  }, [
    boundary,
    listEmptyComponent,
    liveHeadRowRevision,
    renderLiveAuxiliary,
    renderLiveHeadRow,
    segments.liveHead,
  ]);

  const historyFooterContent = useMemo(() => {
    return (
      <View>
        <View
          ref={historyEdgeRef}
          collapsable={false}
          pointerEvents="none"
          style={HISTORY_EDGE_STYLE}
        />
        {hasOlderHistory || isLoadingOlderHistory ? (
          <View style={HISTORY_FOOTER_STYLE}>
            {isLoadingOlderHistory ? (
              <ActivityIndicator testID="load-older-history-spinner" size="small" />
            ) : (
              <Button
                variant="ghost"
                size="sm"
                testID="load-older-history"
                onPress={handleManualHistoryLoad}
              >
                加载更早消息
              </Button>
            )}
          </View>
        ) : null}
      </View>
    );
  }, [hasOlderHistory, isLoadingOlderHistory, handleManualHistoryLoad]);

  // RN's FlatList strictMode keeps its internal renderItem wrapper stable when
  // data or the live header changes, preserving the row identities above.
  return (
    <View ref={nativeViewportRef} collapsable={false} style={VIEWPORT_STYLE}>
      <FlatList
        ref={flatListRef}
        data={historyRows}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        strictMode
        testID="agent-chat-scroll"
        nativeID="agent-chat-scroll-native-virtualized"
        ListHeaderComponent={liveHeaderContent ?? undefined}
        ListFooterComponent={historyFooterContent ?? undefined}
        contentContainerStyle={nativeContentStyle}
        style={listStyle}
        onLayout={handleListLayout}
        onScroll={handleScroll}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollBegin={handleMomentumScrollBegin}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        scrollEventThrottle={16}
        onContentSizeChange={handleContentSizeChange}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.2}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        maintainVisibleContentPosition={maintainVisibleContentPosition}
        initialNumToRender={40}
        maxToRenderPerBatch={40}
        updateCellsBatchingPeriod={0}
        windowSize={21}
        removeClippedSubviews={false}
        scrollEnabled={scrollEnabled}
        showsVerticalScrollIndicator
        inverted
      />
    </View>
  );
}

export function createNativeStreamStrategy(): StreamStrategy {
  const strategy = createStreamStrategy({
    render: (renderInput) => <NativeStreamViewport {...renderInput} strategy={strategy} />,
    orderTailReverse: true,
    orderHeadReverse: true,
    assistantTurnTraversalStep: 1,
    edgeSlot: "header",
    historyLiveBoundaryEdge: "first",
    liveHeadHistoryBoundaryEdge: "last",
    frameChildOrder: "footer-then-content",
    flatListInverted: true,
    overlayScrollbarInverted: true,
    maintainVisibleContentPosition: DEFAULT_MAINTAIN_VISIBLE_CONTENT_POSITION,
    bottomAnchorTransportBehavior: {
      verificationDelayFrames: 2,
      verificationRetryMode: "recheck",
    },
    disableParentScrollOnInlineDetailsExpansion: false,
    anchorBottomOnContentSizeChange: false,
    animateManualScrollToBottom: true,
    useVirtualizedList: true,
    isNearBottom: (input) => input.offsetY <= input.threshold,
    getBottomOffset: () => 0,
  });
  return strategy;
}
