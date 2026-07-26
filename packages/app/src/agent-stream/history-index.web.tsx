import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { ConversationHistoryIndexEntry } from "./history-index-model";
import {
  getHistoryIndexWaveScale,
  getStreamItemDomId,
  sampleConversationHistoryIndex,
} from "./history-index-model";
import type { StreamViewportHandle } from "./strategy";

export interface ConversationHistoryIndexProps {
  entries: readonly ConversationHistoryIndexEntry[];
  viewportRef: RefObject<StreamViewportHandle | null>;
  onNavigate?: (entry: ConversationHistoryIndexEntry) => Promise<void> | void;
}

const railStyle: CSSProperties = {
  position: "absolute",
  zIndex: 10,
  top: "50%",
  height: "min(46vh, 360px)",
  minHeight: 220,
  left: 0,
  width: 32,
  transform: "translateY(-50%)",
  pointerEvents: "auto",
};
const ACTIVE_MARKER_ACCESSIBILITY_STATE = { selected: true } as const;
const INACTIVE_MARKER_ACCESSIBILITY_STATE = { selected: false } as const;

function findScrollContainer(root: HTMLElement | null): HTMLElement | null {
  const candidate = root?.parentElement?.querySelector('[data-testid="agent-chat-scroll"]');
  return candidate instanceof HTMLElement ? candidate : null;
}

interface ConversationHistoryIndexMarkerProps {
  entry: ConversationHistoryIndexEntry;
  fraction: number;
  isActive: boolean;
  isPointerHovered: boolean;
  pointerFraction: number | null;
  reduceMotion: boolean;
  viewportRef: RefObject<StreamViewportHandle | null>;
  onNavigate?: (entry: ConversationHistoryIndexEntry) => Promise<void> | void;
}

function ConversationHistoryIndexMarker({
  entry,
  fraction,
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
      top: `${fraction * 100}%`,
      left: 0,
      width: 32,
      height: 12,
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "center",
      paddingLeft: 4,
      transform: [{ translateY: -6 }],
    }),
    [fraction],
  );
  const isHighlighted = isPointerHovered || isFocused;
  const waveScale = Math.max(
    getHistoryIndexWaveScale(fraction, pointerFraction),
    isActive ? 1.6 : 1,
  );
  const tickWaveStyle = useMemo<CSSProperties>(
    () => ({
      width: 8,
      height: 2,
      display: "flex",
      alignItems: "center",
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
  const handlePress = useCallback(() => {
    if (onNavigate) {
      void onNavigate(entry);
      return;
    }
    viewportRef.current?.scrollToItem(entry.id);
  }, [entry, onNavigate, viewportRef]);

  return (
    <Pressable
      pointerEvents="auto"
      accessibilityLabel={t("agentStream.historyIndex.jumpTo", { title: entry.title })}
      style={markerStyle}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={
        isActive ? ACTIVE_MARKER_ACCESSIBILITY_STATE : INACTIVE_MARKER_ACCESSIBILITY_STATE
      }
    >
      <div aria-hidden style={tickWaveStyle}>
        <View
          style={[styles.tick, isHighlighted && styles.tickHovered, isActive && styles.tickActive]}
        />
      </div>
      {isHighlighted ? (
        <View style={styles.tooltip} pointerEvents="none">
          <Text style={styles.tooltipTitle}>{entry.title}</Text>
          <Text style={styles.tooltipPreview}>
            {entry.preview || t("agentStream.historyIndex.noPreview")}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function ConversationHistoryIndex({
  entries,
  viewportRef,
  onNavigate,
}: ConversationHistoryIndexProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pointerFraction, setPointerFraction] = useState<number | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const pointerFrameRef = useRef<number | null>(null);
  const visibleEntries = useMemo(() => sampleConversationHistoryIndex(entries), [entries]);
  const entryByDomId = useMemo(
    () => new Map(entries.map((entry) => [getStreamItemDomId(entry.id), entry])),
    [entries],
  );
  const hoveredIndex = useMemo(() => {
    if (pointerFraction === null || visibleEntries.length === 0) {
      return null;
    }
    return Math.round(pointerFraction * (visibleEntries.length - 1));
  }, [pointerFraction, visibleEntries.length]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReduceMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  const handleMouseMove = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextFraction = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    if (pointerFrameRef.current !== null) {
      cancelAnimationFrame(pointerFrameRef.current);
    }
    pointerFrameRef.current = requestAnimationFrame(() => {
      pointerFrameRef.current = null;
      setPointerFraction(nextFraction);
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (pointerFrameRef.current !== null) {
      cancelAnimationFrame(pointerFrameRef.current);
      pointerFrameRef.current = null;
    }
    setPointerFraction(null);
  }, []);

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
      if (onNavigate) {
        void onNavigate(entry);
        return;
      }
      viewportRef.current?.scrollToItem(entry.id);
    },
    [hoveredIndex, onNavigate, viewportRef, visibleEntries],
  );

  const updateActiveMarker = useCallback(() => {
    const scrollContainer = findScrollContainer(rootRef.current);
    if (!scrollContainer) {
      return;
    }
    const bounds = scrollContainer.getBoundingClientRect();
    const targetY = bounds.top + bounds.height * 0.35;
    let closestEntry: ConversationHistoryIndexEntry | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    const mountedTargets = scrollContainer.querySelectorAll<HTMLElement>(
      '[id^="paseo-stream-item-"]',
    );
    for (const target of mountedTargets) {
      const entry = entryByDomId.get(target.id);
      if (!entry) {
        continue;
      }
      const targetBounds = target.getBoundingClientRect();
      const distance = Math.abs(targetBounds.top + targetBounds.height / 2 - targetY);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestEntry = entry;
      }
    }
    if (!closestEntry) {
      setActiveId(null);
      return;
    }
    let closestMarkerId: string | null = null;
    let closestMarkerDistance = Number.POSITIVE_INFINITY;
    for (const entry of visibleEntries) {
      const distance = Math.abs(entry.sourceIndex - closestEntry.sourceIndex);
      if (distance < closestMarkerDistance) {
        closestMarkerDistance = distance;
        closestMarkerId = entry.id;
      }
    }
    setActiveId(closestMarkerId);
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
    scheduleUpdate();
    return () => {
      scrollContainer.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      if (pointerFrameRef.current !== null) {
        cancelAnimationFrame(pointerFrameRef.current);
        pointerFrameRef.current = null;
      }
    };
  }, [updateActiveMarker]);

  if (visibleEntries.length === 0) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      role="navigation"
      aria-label={t("agentStream.historyIndex.label")}
      style={railStyle}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClickCapture={handleClickCapture}
    >
      {visibleEntries.map((entry, index) => (
        <ConversationHistoryIndexMarker
          key={entry.id}
          entry={entry}
          fraction={visibleEntries.length === 1 ? 0.5 : index / (visibleEntries.length - 1)}
          isActive={activeId === entry.id}
          isPointerHovered={hoveredIndex === index}
          pointerFraction={pointerFraction}
          reduceMotion={reduceMotion}
          viewportRef={viewportRef}
          onNavigate={onNavigate}
        />
      ))}
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
  tickActive: {
    height: 2,
    backgroundColor: theme.colors.foreground,
    opacity: 1,
  },
  tooltip: {
    position: "absolute",
    left: 32,
    top: -18,
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
