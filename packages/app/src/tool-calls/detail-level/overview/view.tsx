import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Brain, Wrench } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  animateLiveElementEntrance,
  createSmoothScrollChase,
  isWebReducedMotionPreferred,
  trackLiveAnimation,
} from "@/agent-stream/live-entrance";
import { ExpandableBadge, ProcessGroupListProvider } from "@/components/message";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import type { ProcessRunItem } from "../grouping";
import {
  buildScrollEdgeMaskImage,
  useFollowLatestScroll,
  type ScrollEdgeFade,
} from "./follow-latest";
import {
  isThoughtOnlyOverviewSummary,
  type OverviewSummary,
  type OverviewToolCallGroup,
} from "./model";
import { OverviewToolCallGroupSheet } from "./sheet";

function getScrollableDomNode(scroll: ScrollView | null): HTMLElement | null {
  if (!isWeb || !scroll) return null;
  const candidate: unknown =
    typeof (scroll as { getScrollableNode?: () => unknown }).getScrollableNode === "function"
      ? (scroll as { getScrollableNode: () => unknown }).getScrollableNode()
      : scroll;
  return candidate instanceof HTMLElement ? candidate : null;
}

function applyEdgeFadeMask(node: View | null, edgeFade: ScrollEdgeFade): void {
  if (!isWeb) return;
  const domNode: unknown = node;
  if (!(domNode instanceof HTMLElement)) return;
  const mask = buildScrollEdgeMaskImage(edgeFade);
  domNode.style.maskImage = mask;
  domNode.style.setProperty("-webkit-mask-image", mask);
  domNode.setAttribute("data-scroll-fade", edgeFade);
}

interface OverviewGroupProps {
  group: OverviewToolCallGroup;
  executionActive: boolean;
  expanded: boolean;
  isLastInSequence: boolean;
  onExpandedChange: (groupId: string, expanded: boolean) => void;
  renderItem?: (entry: ProcessRunItem, isLast: boolean) => ReactNode;
  children?: () => ReactNode;
}

const STEP_ROW_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
};

const ProcessGroupStepRow = memo(function ProcessGroupStepRow({
  entry,
  isLast,
  renderItem,
  registerNode,
}: {
  entry: ProcessRunItem;
  isLast: boolean;
  renderItem: (entry: ProcessRunItem, isLast: boolean) => ReactNode;
  registerNode: (id: string, node: HTMLDivElement | null) => void;
}) {
  const handleRef = useCallback(
    (node: HTMLDivElement | null) => {
      registerNode(entry.id, node);
    },
    [entry.id, registerNode],
  );
  return (
    <div ref={handleRef} style={STEP_ROW_STYLE}>
      {renderItem(entry, isLast)}
    </div>
  );
});

const ProcessGroupItemsList = memo(function ProcessGroupItemsList({
  calls,
  renderItem,
  animateNewSteps,
}: {
  calls: readonly ProcessRunItem[];
  renderItem: (entry: ProcessRunItem, isLast: boolean) => ReactNode;
  animateNewSteps: boolean;
}) {
  const panelActive = useRetainedPanelActive();
  const knownStepIdsRef = useRef<Set<string> | null>(null);
  const stepNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const animationsRef = useRef<Set<Animation>>(new Set());

  const registerNode = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) {
      stepNodesRef.current.set(id, node);
    } else {
      stepNodesRef.current.delete(id);
    }
  }, []);

  useEffect(() => {
    const animations = animationsRef.current;
    return () => {
      for (const animation of animations) animation.cancel();
      animations.clear();
    };
  }, []);

  useLayoutEffect(() => {
    if (!isWeb) return;
    const known = knownStepIdsRef.current;
    if (!known) {
      knownStepIdsRef.current = new Set(calls.map((entry) => entry.id));
      return;
    }
    const newlyAdded = calls.filter((entry) => !known.has(entry.id));
    for (const entry of calls) known.add(entry.id);
    if (!animateNewSteps || !panelActive || newlyAdded.length === 0) {
      return;
    }
    if (isWebReducedMotionPreferred()) {
      return;
    }
    let staggerIndex = 0;
    for (const entry of newlyAdded) {
      const node = stepNodesRef.current.get(entry.id);
      if (!node) continue;
      const animation = animateLiveElementEntrance(node, {
        preset: "process-step",
        staggerIndex,
      });
      staggerIndex += 1;
      trackLiveAnimation(animationsRef.current, animation);
    }
  }, [animateNewSteps, calls, panelActive]);

  if (!isWeb) {
    return (
      <>
        {calls.map((entry, index) => (
          <React.Fragment key={entry.id}>
            {renderItem(entry, index === calls.length - 1)}
          </React.Fragment>
        ))}
      </>
    );
  }

  return (
    <>
      {calls.map((entry, index) => (
        <ProcessGroupStepRow
          key={entry.id}
          entry={entry}
          isLast={index === calls.length - 1}
          renderItem={renderItem}
          registerNode={registerNode}
        />
      ))}
    </>
  );
});

export const TOOL_CALL_GROUP_MAX_HEIGHT = 360;

function joinSummaryParts(parts: string[], conjunction: string): string {
  if (parts.length === 0) {
    return "";
  }
  let joined = parts[0] ?? "";
  if (parts.length === 2) {
    joined = `${parts[0]} ${conjunction} ${parts[1]}`;
  } else if (parts.length > 2) {
    joined = `${parts.slice(0, -1).join(", ")}, ${conjunction} ${parts.at(-1)}`;
  }
  const firstCharacter = joined[0];
  return firstCharacter ? `${firstCharacter.toLocaleUpperCase()}${joined.slice(1)}` : joined;
}

function useOverviewSummary(summary: OverviewSummary): string {
  const { t } = useTranslation();
  return useMemo(() => {
    const parts: string[] = [];
    const entries = [
      [summary.editedFileCount, "toolCallGroup.editedFiles"],
      [summary.commandCount, "toolCallGroup.commands"],
      [summary.readFileCount, "toolCallGroup.readFiles"],
      [summary.searchCount, "toolCallGroup.searches"],
      [summary.otherToolCount, "toolCallGroup.otherTools"],
      [summary.paseoCallCount, "toolCallGroup.paseoCalls"],
      [summary.thoughtCount, "toolCallGroup.thoughts"],
    ] as const;
    for (const [count, key] of entries) {
      if (count > 0) {
        parts.push(t(`${key}.${count === 1 ? "one" : "other"}`, { count }));
      }
    }
    return joinSummaryParts(parts, t("toolCallGroup.and"));
  }, [summary, t]);
}

export const OverviewToolCallGroupView = memo(function OverviewToolCallGroupView({
  group,
  executionActive,
  expanded,
  isLastInSequence,
  onExpandedChange,
  renderItem,
  children,
}: OverviewGroupProps) {
  const scrollRef = useRef<ScrollView>(null);
  const maskWrapperRef = useRef<View>(null);
  const isCompact = useIsCompactFormFactor();
  const aggregateSummary = useOverviewSummary(group.summary);
  const thoughtOnly = isThoughtOnlyOverviewSummary(group.summary);
  const headerIcon = thoughtOnly ? Brain : Wrench;
  const handleEdgeFadeChange = useCallback((edgeFade: ScrollEdgeFade) => {
    applyEdgeFadeMask(maskWrapperRef.current, edgeFade);
  }, []);
  const syncDomEdgeFadeRef = useRef<() => void>(() => {});
  const smoothScrollChase = useMemo(
    () =>
      createSmoothScrollChase({
        getScrollContainer: () => getScrollableDomNode(scrollRef.current),
        applyScrollTop: (scroll, nextTop) => {
          scroll.scrollTop = nextTop;
        },
        onStep: () => {
          syncDomEdgeFadeRef.current();
        },
        onSettled: () => {
          syncDomEdgeFadeRef.current();
        },
      }),
    [],
  );
  useEffect(() => () => smoothScrollChase.cancel(), [smoothScrollChase]);
  const scrollToEnd = useCallback(
    (animated: boolean) => {
      if (isWeb && animated && !isWebReducedMotionPreferred()) {
        smoothScrollChase.chase();
        return;
      }
      smoothScrollChase.cancel();
      const domNode = getScrollableDomNode(scrollRef.current);
      if (domNode) {
        domNode.scrollTop = Math.max(0, domNode.scrollHeight - domNode.clientHeight);
      } else {
        scrollRef.current?.scrollToEnd({ animated });
      }
      syncDomEdgeFadeRef.current();
    },
    [smoothScrollChase],
  );
  const { handleScroll, syncEdgeFade } = useFollowLatestScroll({
    open: !isCompact && expanded,
    itemCount: group.run.calls.length,
    latestItemId: group.run.latest.id,
    scrollToEnd,
    onStopFollowing: smoothScrollChase.cancel,
    onEdgeFadeChange: handleEdgeFadeChange,
  });
  const syncDomEdgeFade = useCallback(() => {
    const domNode = getScrollableDomNode(scrollRef.current);
    if (!domNode) return;
    syncEdgeFade(domNode.scrollTop, domNode.clientHeight, domNode.scrollHeight);
  }, [syncEdgeFade]);
  syncDomEdgeFadeRef.current = syncDomEdgeFade;
  const toggle = useCallback(() => {
    onExpandedChange(group.run.id, !expanded);
  }, [expanded, group.run.id, onExpandedChange]);
  const close = useCallback(() => {
    onExpandedChange(group.run.id, false);
  }, [group.run.id, onExpandedChange]);
  const animateNewSteps = !group.run.isSealed && executionActive;
  const renderItems = useCallback(
    () =>
      renderItem ? (
        <ProcessGroupItemsList
          calls={group.run.calls}
          renderItem={renderItem}
          animateNewSteps={animateNewSteps}
        />
      ) : (
        (children?.() ?? null)
      ),
    [animateNewSteps, children, group.run.calls, renderItem],
  );
  const renderDetails = useCallback(
    () => (
      <View ref={maskWrapperRef} testID="tool-call-group-mask" style={styles.scrollMask}>
        <ScrollView
          ref={scrollRef}
          testID="tool-call-group-scroll"
          style={styles.scroll}
          contentContainerStyle={styles.content}
          nestedScrollEnabled
          scrollEventThrottle={16}
          showsVerticalScrollIndicator
          onScroll={handleScroll}
          onLayout={syncDomEdgeFade}
          onContentSizeChange={syncDomEdgeFade}
        >
          <ProcessGroupListProvider>{renderItems()}</ProcessGroupListProvider>
        </ScrollView>
      </View>
    ),
    [handleScroll, renderItems, syncDomEdgeFade],
  );

  if (isCompact) {
    return (
      <>
        <ExpandableBadge
          testID="tool-call-group"
          label={aggregateSummary}
          icon={headerIcon}
          trailingChevron
          isLoading={group.isLoading && executionActive}
          isExpanded={false}
          isLastInSequence={isLastInSequence}
          onToggle={toggle}
        />
        <OverviewToolCallGroupSheet
          visible={expanded}
          summary={aggregateSummary}
          thoughtOnly={thoughtOnly}
          itemCount={group.run.calls.length}
          latestItemId={group.run.latest.id}
          onClose={close}
        >
          {expanded ? <ProcessGroupListProvider>{renderItems()}</ProcessGroupListProvider> : null}
        </OverviewToolCallGroupSheet>
      </>
    );
  }

  return (
    <ExpandableBadge
      testID="tool-call-group"
      label={aggregateSummary}
      icon={headerIcon}
      isLoading={group.isLoading && executionActive}
      isExpanded={expanded}
      isLastInSequence={isLastInSequence}
      onToggle={toggle}
      renderDetails={renderDetails}
      borderlessWhenExpanded
      trailingChevron
    />
  );
});

const styles = StyleSheet.create((theme) => ({
  scrollMask: {
    maxHeight: TOOL_CALL_GROUP_MAX_HEIGHT,
  },
  scroll: {
    maxHeight: TOOL_CALL_GROUP_MAX_HEIGHT,
  },
  content: {
    marginLeft: theme.spacing[3],
    paddingLeft: theme.spacing[1],
    paddingRight: theme.spacing[1],
    paddingBottom: theme.spacing[1],
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
  },
}));
