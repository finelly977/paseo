import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type UIEvent as ReactUIEvent,
  type RefObject,
} from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { ConversationHistoryIndexEntry } from "./history-index-model";
import {
  getHistoryIndexWaveScale,
  getHistoryIndexEntryKey,
  getStreamItemDomId,
  resolveHistoryIndexRailLayout,
  resolveHistoryIndexWheelDeltaPx,
  resolveHistoryIndexWindow,
} from "./history-index-model";
import { useRetainedPanelActive } from "@/components/retained-panel";
import type { StreamViewportHandle } from "./strategy";

export interface ConversationHistoryIndexProps {
  entries: readonly ConversationHistoryIndexEntry[];
  itemOwners?: ReadonlyMap<string, ConversationHistoryIndexEntry>;
  viewportRef: RefObject<StreamViewportHandle | null>;
  onNavigate?: (entry: ConversationHistoryIndexEntry) => Promise<void> | void;
}

/** The measured band the rail may occupy; the rail itself only claims what its markers need. */
const railBandStyle: CSSProperties = {
  position: "absolute",
  zIndex: 10,
  top: 0,
  bottom: 0,
  left: 0,
  width: 32,
  pointerEvents: "none",
};
const ACTIVE_MARKER_ACCESSIBILITY_STATE = { selected: true } as const;
const INACTIVE_MARKER_ACCESSIBILITY_STATE = { selected: false } as const;
const MARKER_HIT_HEIGHT = 12;
const RAIL_BOTTOM_EPSILON = 2;
const CONTENT_BOTTOM_EPSILON = 2;

interface MountedHistoryIndexEntry {
  entry: ConversationHistoryIndexEntry;
  top: number;
  height: number;
}

export function resolveActiveHistoryIndexEntry(input: {
  entries: readonly ConversationHistoryIndexEntry[];
  mountedEntries: readonly MountedHistoryIndexEntry[];
  targetY: number;
  isAtBottom: boolean;
}): ConversationHistoryIndexEntry | null {
  if (input.entries.length === 0) {
    return null;
  }
  if (input.isAtBottom) {
    return input.entries[input.entries.length - 1] ?? null;
  }

  let closestBefore: MountedHistoryIndexEntry | null = null;
  let firstMounted: MountedHistoryIndexEntry | null = null;
  for (const mounted of input.mountedEntries) {
    const center = mounted.top + mounted.height / 2;
    if (!firstMounted || center < firstMounted.top + firstMounted.height / 2) {
      firstMounted = mounted;
    }
    if (
      center <= input.targetY &&
      (!closestBefore || center > closestBefore.top + closestBefore.height / 2)
    ) {
      closestBefore = mounted;
    }
  }
  return (closestBefore ?? firstMounted)?.entry ?? null;
}

function findScrollContainer(root: HTMLElement | null): HTMLElement | null {
  const candidate = root?.parentElement?.querySelector('[data-testid="agent-chat-scroll"]');
  return candidate instanceof HTMLElement ? candidate : null;
}

interface ConversationHistoryIndexMarkerProps {
  entry: ConversationHistoryIndexEntry;
  offset: number;
  contentPixelHeight: number;
  visiblePixelHeight: number;
  isActive: boolean;
  isPointerHovered: boolean;
  pointerFraction: number | null;
  reduceMotion: boolean;
  viewportRef: RefObject<StreamViewportHandle | null>;
  onNavigate?: (entry: ConversationHistoryIndexEntry) => Promise<void> | void;
}

function ConversationHistoryIndexMarker({
  entry,
  offset,
  contentPixelHeight,
  visiblePixelHeight,
  isActive,
  isPointerHovered,
  pointerFraction,
  reduceMotion,
  viewportRef,
  onNavigate,
}: ConversationHistoryIndexMarkerProps) {
  const { t } = useTranslation();
  const [isFocused, setIsFocused] = useState(false);
  const markerStyle = useMemo<ViewStyle>(
    () => ({
      position: "absolute",
      top: offset,
      left: 0,
      width: 32,
      height: MARKER_HIT_HEIGHT,
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "center",
      paddingLeft: 4,
    }),
    [offset],
  );
  const isHighlighted = isPointerHovered || isFocused;
  // 指针分数映射到可交互内容高度，再取刻度中心坐标，与刻度偏移同一坐标系。
  const pointerOffsetPx = useMemo(() => {
    if (pointerFraction === null || contentPixelHeight <= 0) {
      return null;
    }
    return (
      pointerFraction * Math.max(0, contentPixelHeight - MARKER_HIT_HEIGHT) + MARKER_HIT_HEIGHT / 2
    );
  }, [contentPixelHeight, pointerFraction]);
  const waveScale = Math.max(
    getHistoryIndexWaveScale(offset + MARKER_HIT_HEIGHT / 2, pointerOffsetPx, visiblePixelHeight),
    isActive ? 1.6 : 1,
  );
  const tickWaveStyle = useMemo<CSSProperties>(
    () => ({
      width: 8,
      height: MARKER_HIT_HEIGHT,
      display: "flex",
      // Centring a 1px hairline in an even-height box puts it on a half pixel, so it
      // antialiases across two rows while the 2px active tick stays crisp. Pin every
      // tick to the same whole-pixel baseline instead.
      alignItems: "flex-start",
      paddingTop: MARKER_HIT_HEIGHT / 2,
      transform: `scaleX(${waveScale})`,
      transformOrigin: "left center",
      transitionProperty: "transform, opacity",
      transitionDuration: reduceMotion ? "0ms" : "180ms",
      transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
    }),
    [reduceMotion, waveScale],
  );
  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);
  const markerData = useMemo(() => ({ historyIndex: entry.sourceIndex }), [entry.sourceIndex]);
  const handlePress = useCallback(() => {
    if (onNavigate) {
      void onNavigate(entry);
      return;
    }
    viewportRef.current?.scrollToItem(entry.id);
  }, [entry, onNavigate, viewportRef]);

  return (
    <Pressable
      dataSet={markerData}
      pointerEvents="auto"
      accessibilityLabel={t("agentStream.historyIndex.jumpTo", { title: entry.title })}
      style={markerStyle}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPress={handlePress}
      accessibilityRole="button"
      aria-current={isActive ? "step" : undefined}
      accessibilityState={
        isActive ? ACTIVE_MARKER_ACCESSIBILITY_STATE : INACTIVE_MARKER_ACCESSIBILITY_STATE
      }
    >
      <div aria-hidden style={tickWaveStyle}>
        <View
          style={[styles.tick, isHighlighted && styles.tickHovered, isActive && styles.tickActive]}
        />
      </div>
    </Pressable>
  );
}

export function ConversationHistoryIndex({
  entries,
  itemOwners,
  viewportRef,
  onNavigate,
}: ConversationHistoryIndexProps) {
  const { t } = useTranslation();
  const isPanelActive = useRetainedPanelActive();
  const isPanelActiveRef = useRef(isPanelActive);
  isPanelActiveRef.current = isPanelActive;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const userScrolledAwayRef = useRef(false);
  const savedScrollTopRef = useRef(0);
  const wasHiddenRef = useRef(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pointerFraction, setPointerFraction] = useState<number | null>(null);
  const [bandHeight, setBandHeight] = useState(0);
  const [visibilityEpoch, setVisibilityEpoch] = useState(0);
  const [railScrollTop, setRailScrollTop] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const pointerFrameRef = useRef<number | null>(null);
  const pointerOffsetRef = useRef<number | null>(null);
  const pendingFocusRef = useRef<number | null>(null);
  const railLayout = useMemo(
    () =>
      resolveHistoryIndexRailLayout({
        entryCount: entries.length,
        availableHeight: bandHeight,
        markerHeight: MARKER_HIT_HEIGHT,
      }),
    [bandHeight, entries.length],
  );
  const visibleEntries = useMemo(
    () => (railLayout.markerCount > 0 ? entries : []),
    [entries, railLayout.markerCount],
  );
  const markerWindow = resolveHistoryIndexWindow({
    entryCount: visibleEntries.length,
    scrollTop: railScrollTop,
    railHeight: railLayout.railHeight,
  });
  const renderedEntries = visibleEntries.slice(markerWindow.start, markerWindow.end);
  const entryByDomId = useMemo(
    () =>
      new Map([
        ...entries.map((entry) => [getStreamItemDomId(entry.id), entry] as const),
        ...Array.from(itemOwners ?? [], ([id, entry]) => [getStreamItemDomId(id), entry] as const),
      ]),
    [entries, itemOwners],
  );
  const railStyle = useMemo<CSSProperties>(
    () => ({
      position: "absolute",
      top: railLayout.railTop,
      left: 0,
      width: 32,
      height: railLayout.railHeight,
      pointerEvents: "auto",
      overflowY: railLayout.contentHeight > railLayout.railHeight ? "auto" : "hidden",
      overflowX: "hidden",
      overscrollBehaviorY: "contain",
      overflowAnchor: "none",
      scrollbarWidth: "none",
      msOverflowStyle: "none",
    }),
    [railLayout.contentHeight, railLayout.railHeight, railLayout.railTop],
  );
  const railContentStyle = useMemo<CSSProperties>(
    () => ({
      position: "relative",
      width: 32,
      height: railLayout.contentHeight,
      pointerEvents: "none",
    }),
    [railLayout.contentHeight],
  );
  const hoveredIndex = useMemo(() => {
    if (pointerFraction === null || visibleEntries.length === 0) {
      return null;
    }
    return Math.round(pointerFraction * (visibleEntries.length - 1));
  }, [pointerFraction, visibleEntries.length]);
  const hoveredEntry = hoveredIndex === null ? null : (visibleEntries[hoveredIndex] ?? null);
  const hoveredTooltipTop = useMemo(() => {
    if (hoveredIndex === null) {
      return 0;
    }
    const markerTop = railLayout.railTop + hoveredIndex * railLayout.markerPitch - railScrollTop;
    return Math.max(4, Math.min(Math.max(4, bandHeight - 112), markerTop - 18));
  }, [bandHeight, hoveredIndex, railLayout.markerPitch, railLayout.railTop, railScrollTop]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReduceMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    const band = rootRef.current;
    if (!band) {
      return;
    }
    const observer = new ResizeObserver((observed) => {
      const height = observed[0]?.contentRect.height;
      if (height === undefined) {
        return;
      }
      if (height <= 0) {
        // 面板经由 display:none 隐藏后 Chromium 会归零 DOM scrollTop，记录以便恢复可见时还原。
        wasHiddenRef.current = true;
        return;
      }
      setBandHeight(height);
      if (wasHiddenRef.current) {
        setVisibilityEpoch((current) => current + 1);
      }
    });
    observer.observe(band);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isPanelActive) {
      wasHiddenRef.current = true;
      return;
    }
    if (wasHiddenRef.current) {
      setVisibilityEpoch((current) => current + 1);
    }
  }, [isPanelActive]);

  /** 跳转后收起浮层：指针仍停在轨道上，仅靠 mouseleave 无法结束悬停态。 */
  const dismissHover = useCallback(() => {
    if (pointerFrameRef.current !== null) {
      cancelAnimationFrame(pointerFrameRef.current);
      pointerFrameRef.current = null;
    }
    pointerOffsetRef.current = null;
    setPointerFraction(null);
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && rootRef.current?.contains(focused)) {
      focused.blur();
    }
  }, []);

  const syncPointerFractionForScroll = useCallback(
    (scrollTop: number) => {
      const pointerOffset = pointerOffsetRef.current;
      if (pointerOffset === null) {
        return;
      }
      if (pointerFrameRef.current !== null) {
        cancelAnimationFrame(pointerFrameRef.current);
        pointerFrameRef.current = null;
      }
      const contentHeight = Math.max(1, railLayout.contentHeight - MARKER_HIT_HEIGHT);
      setPointerFraction(Math.max(0, Math.min(1, (pointerOffset + scrollTop) / contentHeight)));
    },
    [railLayout.contentHeight],
  );

  const restoreRailScrollIfHidden = useCallback((rail: HTMLDivElement): number => {
    const maxScroll = Math.max(0, rail.scrollHeight - rail.clientHeight);
    if (!wasHiddenRef.current || maxScroll <= 0) {
      return rail.scrollTop;
    }
    const targetScrollTop = userScrolledAwayRef.current
      ? Math.max(0, Math.min(savedScrollTopRef.current, maxScroll))
      : maxScroll;
    wasHiddenRef.current = false;
    rail.scrollTop = targetScrollTop;
    savedScrollTopRef.current = targetScrollTop;
    setRailScrollTop(targetScrollTop);
    return targetScrollTop;
  }, []);

  const handleMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const scrollableRail = event.currentTarget;
      const currentScrollTop = restoreRailScrollIfHidden(scrollableRail);
      const bounds = scrollableRail.getBoundingClientRect();
      const contentHeight = Math.max(1, railLayout.contentHeight - MARKER_HIT_HEIGHT);
      const pointerOffset = event.clientY - bounds.top;
      pointerOffsetRef.current = pointerOffset;
      const nextFraction = Math.max(
        0,
        Math.min(1, (pointerOffset + currentScrollTop) / contentHeight),
      );
      if (pointerFrameRef.current !== null) {
        cancelAnimationFrame(pointerFrameRef.current);
      }
      pointerFrameRef.current = requestAnimationFrame(() => {
        pointerFrameRef.current = null;
        setPointerFraction(nextFraction);
      });
    },
    [railLayout.contentHeight, restoreRailScrollIfHidden],
  );

  const handleMouseLeave = useCallback(() => {
    if (pointerFrameRef.current !== null) {
      cancelAnimationFrame(pointerFrameRef.current);
      pointerFrameRef.current = null;
    }
    pointerOffsetRef.current = null;
    setPointerFraction(null);
  }, []);
  const handleRailScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>) => {
      if (!isPanelActiveRef.current || event.currentTarget.clientHeight <= 0) {
        return;
      }
      const nextScrollTop = event.currentTarget.scrollTop;
      const maxScroll = Math.max(
        0,
        event.currentTarget.scrollHeight - event.currentTarget.clientHeight,
      );
      savedScrollTopRef.current = nextScrollTop;
      setRailScrollTop(nextScrollTop);
      userScrolledAwayRef.current = nextScrollTop < maxScroll - RAIL_BOTTOM_EPSILON;
      syncPointerFractionForScroll(nextScrollTop);
    },
    [syncPointerFractionForScroll],
  );

  // 接管轨道滚轮，把浏览器默认 ~100px/格的滚轮步长按 8px 刻度密度缩放，避免轻滚即直达顶部。
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      const maxScroll = Math.max(0, rail.scrollHeight - rail.clientHeight);
      if (maxScroll <= 0 || event.ctrlKey || event.metaKey) {
        return;
      }
      const deltaPx = resolveHistoryIndexWheelDeltaPx({
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        railHeight: rail.clientHeight,
      });
      if (deltaPx === 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const baseScrollTop = restoreRailScrollIfHidden(rail);
      const nextScrollTop = Math.max(0, Math.min(maxScroll, baseScrollTop + deltaPx));
      if (nextScrollTop === baseScrollTop) {
        return;
      }
      rail.scrollTop = nextScrollTop;
      savedScrollTopRef.current = nextScrollTop;
      userScrolledAwayRef.current = nextScrollTop < maxScroll - RAIL_BOTTOM_EPSILON;
      setRailScrollTop(nextScrollTop);
      syncPointerFractionForScroll(nextScrollTop);
    };
    rail.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      rail.removeEventListener("wheel", handleWheel);
    };
  }, [restoreRailScrollIfHidden, syncPointerFractionForScroll, visibleEntries.length]);

  // 内容超出轨道高度时默认展示最新刻度；用户没有主动上滚时，新刻度到来仍保持在底部。
  // 从隐藏保活状态切回时，优先还原隐藏前停留的位置或重新贴底，抵消 Chromium 归零 scrollTop。
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !isPanelActive || rail.clientHeight <= 0) {
      return;
    }
    const maxScroll = Math.max(0, rail.scrollHeight - rail.clientHeight);
    if (maxScroll <= 0) {
      wasHiddenRef.current = false;
      savedScrollTopRef.current = 0;
      setRailScrollTop(0);
      return;
    }
    if (wasHiddenRef.current) {
      const restored = userScrolledAwayRef.current
        ? Math.max(0, Math.min(savedScrollTopRef.current, maxScroll))
        : maxScroll;
      wasHiddenRef.current = false;
      rail.scrollTop = restored;
      savedScrollTopRef.current = restored;
      setRailScrollTop(restored);
      return;
    }
    if (userScrolledAwayRef.current) {
      if (rail.scrollTop > maxScroll) {
        rail.scrollTop = maxScroll;
        savedScrollTopRef.current = maxScroll;
        setRailScrollTop(maxScroll);
      }
      return;
    }
    rail.scrollTop = maxScroll;
    savedScrollTopRef.current = maxScroll;
    setRailScrollTop(maxScroll);
  }, [entries.length, isPanelActive, railLayout, visibilityEpoch]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!(event.target instanceof HTMLElement)) return;
      const marker = event.target.closest<HTMLElement>("[data-history-index]");
      if (!marker) return;
      const current = Number(marker.dataset.historyIndex);
      let next: number;
      switch (event.key) {
        case "ArrowUp":
          next = current - 1;
          break;
        case "ArrowDown":
          next = current + 1;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = entries.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      next = Math.max(0, Math.min(entries.length - 1, next));
      const rail = event.currentTarget;
      const top = next * railLayout.markerPitch;
      const scrollTop = Math.max(0, Math.min(top, rail.scrollHeight - rail.clientHeight));
      rail.scrollTop = scrollTop;
      savedScrollTopRef.current = scrollTop;
      userScrolledAwayRef.current =
        scrollTop < rail.scrollHeight - rail.clientHeight - RAIL_BOTTOM_EPSILON;
      setRailScrollTop(scrollTop);
      const target = rail.querySelector<HTMLElement>(`[data-history-index="${next}"]`);
      if (target) target.focus();
      else pendingFocusRef.current = next;
    },
    [entries.length, railLayout.markerPitch],
  );

  useEffect(() => {
    const index = pendingFocusRef.current;
    if (index === null) return;
    const marker = railRef.current?.querySelector<HTMLElement>(`[data-history-index="${index}"]`);
    if (marker) {
      marker.focus();
      pendingFocusRef.current = null;
    }
  }, [markerWindow.start, markerWindow.end]);

  const handleMarkerNavigate = useCallback(
    (entry: ConversationHistoryIndexEntry) => {
      dismissHover();
      if (onNavigate) {
        return onNavigate(entry);
      }
      viewportRef.current?.scrollToItem(entry.id);
    },
    [dismissHover, onNavigate, viewportRef],
  );

  const handleClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.detail === 0 || hoveredIndex === null) {
        return;
      }
      const entry = visibleEntries[hoveredIndex];
      if (!entry) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dismissHover();
      if (onNavigate) {
        void onNavigate(entry);
        return;
      }
      viewportRef.current?.scrollToItem(entry.id);
    },
    [dismissHover, hoveredIndex, onNavigate, viewportRef, visibleEntries],
  );

  const updateActiveMarker = useCallback(() => {
    const scrollContainer = findScrollContainer(rootRef.current);
    if (!scrollContainer) {
      return;
    }
    const distanceFromBottom =
      scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop;
    const isAtBottom = distanceFromBottom <= CONTENT_BOTTOM_EPSILON;
    if (isAtBottom) {
      // 贴底流式输出时直接选中最新轮次，避免遍历全部历史节点触发同步布局重排。
      const closestEntry = visibleEntries[visibleEntries.length - 1] ?? null;
      setActiveId(closestEntry ? getHistoryIndexEntryKey(closestEntry) : null);
      return;
    }
    const bounds = scrollContainer.getBoundingClientRect();
    const targetY = bounds.top + bounds.height * 0.35;
    const mountedEntries: MountedHistoryIndexEntry[] = [];
    const mountedTargets = scrollContainer.querySelectorAll<HTMLElement>(
      '[id^="paseo-stream-item-"]',
    );
    for (const target of mountedTargets) {
      const entry = entryByDomId.get(target.id);
      if (!entry) {
        continue;
      }
      const targetBounds = target.getBoundingClientRect();
      mountedEntries.push({ entry, top: targetBounds.top, height: targetBounds.height });
    }
    const closestEntry = resolveActiveHistoryIndexEntry({
      entries: visibleEntries,
      mountedEntries,
      targetY,
      isAtBottom: false,
    });
    if (!closestEntry) {
      setActiveId(null);
      return;
    }
    setActiveId(getHistoryIndexEntryKey(closestEntry));
  }, [entryByDomId, visibleEntries]);

  useEffect(() => {
    const scrollContainer = findScrollContainer(rootRef.current);
    if (!scrollContainer) {
      return;
    }
    let frame: number | null = null;
    const scheduleUpdate = () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        updateActiveMarker();
      });
    };
    scrollContainer.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    const contentObserver = new MutationObserver((records) => {
      for (const record of records) {
        const target =
          record.target instanceof Element ? record.target : record.target.parentElement;
        if (target?.closest("[data-disclosure-animating], [data-scrollbar-static]")) {
          continue;
        }
        scheduleUpdate();
        return;
      }
    });
    contentObserver.observe(scrollContainer, {
      childList: true,
      subtree: true,
    });
    scheduleUpdate();
    return () => {
      scrollContainer.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      contentObserver.disconnect();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      if (pointerFrameRef.current !== null) {
        cancelAnimationFrame(pointerFrameRef.current);
        pointerFrameRef.current = null;
      }
    };
  }, [updateActiveMarker]);

  // The band always renders so its ResizeObserver can measure the available height;
  // without a measurement the rail would have no marker budget and never appear.
  return (
    <div ref={rootRef} style={railBandStyle}>
      {visibleEntries.length > 0 ? (
        <div
          ref={railRef}
          role="navigation"
          aria-label={t("agentStream.historyIndex.label")}
          data-hidden-scrollbar
          style={railStyle}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onScroll={handleRailScroll}
          onClickCapture={handleClickCapture}
          onKeyDown={handleKeyDown}
        >
          <div style={railContentStyle}>
            {renderedEntries.map((entry, index) => (
              <ConversationHistoryIndexMarker
                key={getHistoryIndexEntryKey(entry)}
                entry={entry}
                offset={(markerWindow.start + index) * railLayout.markerPitch}
                contentPixelHeight={railLayout.contentHeight}
                visiblePixelHeight={railLayout.railHeight}
                isActive={activeId === getHistoryIndexEntryKey(entry)}
                isPointerHovered={hoveredIndex === markerWindow.start + index}
                pointerFraction={pointerFraction}
                reduceMotion={reduceMotion}
                viewportRef={viewportRef}
                onNavigate={handleMarkerNavigate}
              />
            ))}
          </div>
        </div>
      ) : null}
      {hoveredEntry ? (
        <View style={[styles.tooltip, { top: hoveredTooltipTop }]} pointerEvents="none">
          <Text style={styles.tooltipTitle}>{hoveredEntry.title}</Text>
          <Text style={styles.tooltipPreview}>
            {hoveredEntry.preview || t("agentStream.historyIndex.noPreview")}
          </Text>
        </View>
      ) : null}
    </div>
  );
}

const styles = StyleSheet.create((theme) => ({
  tick: {
    width: 8,
    height: 1,
    borderRadius: 999,
    backgroundColor: theme.colors.foregroundMuted,
    opacity: 0.65,
  },
  tickHovered: {
    backgroundColor: theme.colors.foreground,
    opacity: 1,
  },
  // Every tick keeps the 1px height so they share one whole-pixel baseline; the
  // active one reads as heavier through colour, not by growing off the baseline.
  tickActive: {
    backgroundColor: theme.colors.foreground,
    opacity: 1,
  },
  tooltip: {
    position: "absolute",
    left: 32,
    width: 280,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    zIndex: 2,
    shadowColor: "#000000",
    shadowOpacity: 0.24,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 4 },
  },
  tooltipTitle: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
    marginBottom: 6,
  },
  tooltipPreview: {
    color: theme.colors.foregroundMuted,
    lineHeight: 20,
  },
}));
