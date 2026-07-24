import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import type { ConversationHistoryIndexEntry } from "./history-index-model";
import { getStreamItemDomId, sampleConversationHistoryIndex } from "./history-index-model";
import type { StreamViewportHandle } from "./strategy";

export interface ConversationHistoryIndexProps {
  entries: readonly ConversationHistoryIndexEntry[];
  viewportRef: RefObject<StreamViewportHandle | null>;
}

const railStyle: CSSProperties = {
  position: "absolute",
  zIndex: 10,
  top: 16,
  bottom: 16,
  left: `max(4px, calc(50% - ${MAX_CONTENT_WIDTH / 2 + 28}px))`,
  width: 24,
  pointerEvents: "none",
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
  viewportRef: RefObject<StreamViewportHandle | null>;
}

function ConversationHistoryIndexMarker({
  entry,
  fraction,
  isActive,
  viewportRef,
}: ConversationHistoryIndexMarkerProps) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const markerStyle = useMemo<ViewStyle>(
    () => ({
      position: "absolute",
      top: `${fraction * 100}%`,
      left: 0,
      width: 24,
      height: 16,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transform: [{ translateY: -8 }],
    }),
    [fraction],
  );
  let tickStyle = styles.tickInactive;
  if (isHovered) {
    tickStyle = styles.tickHovered;
  }
  if (isActive) {
    tickStyle = styles.tickActive;
  }
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);
  const handleFocus = useCallback(() => setIsHovered(true), []);
  const handleBlur = useCallback(() => setIsHovered(false), []);
  const handlePress = useCallback(() => {
    viewportRef.current?.scrollToItem(entry.id);
  }, [entry.id, viewportRef]);

  return (
    <Pressable
      pointerEvents="auto"
      accessibilityLabel={t("agentStream.historyIndex.jumpTo", { title: entry.title })}
      style={markerStyle}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={
        isActive ? ACTIVE_MARKER_ACCESSIBILITY_STATE : INACTIVE_MARKER_ACCESSIBILITY_STATE
      }
    >
      <View style={tickStyle} />
      {isHovered ? (
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

export function ConversationHistoryIndex({ entries, viewportRef }: ConversationHistoryIndexProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const visibleEntries = useMemo(() => sampleConversationHistoryIndex(entries), [entries]);
  const entryByDomId = useMemo(
    () => new Map(entries.map((entry) => [getStreamItemDomId(entry.id), entry])),
    [entries],
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
    >
      <View pointerEvents="none" style={styles.track} />
      {visibleEntries.map((entry, index) => (
        <ConversationHistoryIndexMarker
          key={entry.id}
          entry={entry}
          fraction={visibleEntries.length === 1 ? 0.5 : index / (visibleEntries.length - 1)}
          isActive={activeId === entry.id}
          viewportRef={viewportRef}
        />
      ))}
    </div>
  );
}

const styles = StyleSheet.create((theme) => ({
  track: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 8,
    width: 2,
    backgroundColor: theme.colors.border,
    opacity: 0.7,
  },
  tickInactive: {
    width: 8,
    height: 1,
    borderRadius: 999,
    backgroundColor: theme.colors.foregroundMuted,
    opacity: 0.65,
  },
  tickHovered: {
    width: 20,
    height: 1,
    borderRadius: 999,
    backgroundColor: theme.colors.foreground,
    opacity: 1,
  },
  tickActive: {
    width: 20,
    height: 2,
    borderRadius: 999,
    backgroundColor: theme.colors.foreground,
    opacity: 1,
  },
  tooltip: {
    position: "absolute",
    left: 28,
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
