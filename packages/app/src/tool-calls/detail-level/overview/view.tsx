import React, { memo, useCallback, useMemo, useRef, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Brain, Wrench } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { ExpandableBadge, ProcessGroupListProvider } from "@/components/message";
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

const ProcessGroupItemsList = memo(function ProcessGroupItemsList({
  calls,
  renderItem,
}: {
  calls: readonly ProcessRunItem[];
  renderItem: (entry: ProcessRunItem, isLast: boolean) => ReactNode;
}) {
  return (
    <>
      {calls.map((entry, index) => (
        <React.Fragment key={entry.id}>
          {renderItem(entry, index === calls.length - 1)}
        </React.Fragment>
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
  const scrollToEnd = useCallback((animated: boolean) => {
    scrollRef.current?.scrollToEnd({ animated });
    syncDomEdgeFadeRef.current();
  }, []);
  const { handleScroll, syncEdgeFade } = useFollowLatestScroll({
    open: !isCompact && expanded,
    itemCount: group.run.calls.length,
    latestItemId: group.run.latest.id,
    scrollToEnd,
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
  const renderItems = useCallback(
    () =>
      renderItem ? (
        <ProcessGroupItemsList calls={group.run.calls} renderItem={renderItem} />
      ) : (
        (children?.() ?? null)
      ),
    [children, group.run.calls, renderItem],
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
