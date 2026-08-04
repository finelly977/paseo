import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
  useWindowDimensions,
  StyleSheet as RNStyleSheet,
} from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useRetainedPanelActive } from "@/components/retained-panel";
import type { GitActions } from "@/git/policy";
import { ThemedChevron, chevronColorMapping } from "@/git/themed-chevron";
import {
  useCheckoutCommitsQuery,
  type CheckoutCommitsQueryResult,
  type ClassifiedCheckoutCommit,
} from "@/git/use-commits-query";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { CommitRow, type CommitRef } from "./commit-row";
import { GraphActions } from "./graph-actions";
import { GraphResizeHandle } from "./graph-resize-handle";

const MIN_GRAPH_HEIGHT = 140;
const MAX_GRAPH_HEIGHT = 720;
const MAX_GRAPH_VIEWPORT_RATIO = 0.7;
const ThemedActivityIndicator = withUnistyles(ActivityIndicator);

const activityIndicatorColorMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});

const commitKeyExtractor = (commit: ClassifiedCheckoutCommit) => commit.sha;

interface CommitsSectionProps {
  serverId: string;
  cwd: string;
  gitActions: GitActions;
  fetchSupported: boolean;
  hasRemote: boolean;
  isFetching: boolean;
  onFetch: () => void;
  refreshSupported: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  currentBranchName: string | null;
  onCommitPress: (sha: string) => void;
}

function resolveGraphHeight(requestedHeight: number, viewportHeight: number): number {
  const viewportMaximum = Math.max(MIN_GRAPH_HEIGHT, viewportHeight * MAX_GRAPH_VIEWPORT_RATIO);
  return Math.min(Math.max(requestedHeight, MIN_GRAPH_HEIGHT), MAX_GRAPH_HEIGHT, viewportMaximum);
}

function CommitsSectionSkeleton() {
  const { t } = useTranslation();
  return (
    <View
      accessible
      accessibilityLabel={t("workspace.git.diff.commits.loading")}
      style={styles.skeleton}
      testID="commits-section-skeleton"
    >
      <View style={styles.skeletonRow}>
        <View style={styles.skeletonDot} />
        <View style={styles.skeletonSubject} />
        <View style={styles.skeletonTimestamp} />
        <View style={styles.skeletonCaret} />
      </View>
    </View>
  );
}

function normalizeBranchLabel(label: string): string {
  return label.replace(/^refs\/(heads|remotes)\//, "").replace(/^origin\//, "");
}

function resolveCommitRefs({
  commit,
  index,
  firstWorkspaceIndex,
  firstBaseIndex,
  currentBranchName,
  baseRef,
}: {
  commit: ClassifiedCheckoutCommit;
  index: number;
  firstWorkspaceIndex: number;
  firstBaseIndex: number;
  currentBranchName: string | null;
  baseRef: string | null;
}): CommitRef[] {
  const refs = (commit.refs ?? []).map((label): CommitRef => {
    if (label.startsWith("tag: ")) {
      return { label: label.slice(5), kind: "tag" };
    }
    if (label.startsWith("origin/")) {
      return { label, kind: "remote" };
    }
    if (
      currentBranchName &&
      normalizeBranchLabel(label) === normalizeBranchLabel(currentBranchName)
    ) {
      return { label, kind: "current" };
    }
    if (baseRef && normalizeBranchLabel(label) === normalizeBranchLabel(baseRef)) {
      return { label, kind: "base" };
    }
    return { label, kind: "current" };
  });
  if (
    refs.length === 0 &&
    currentBranchName &&
    (index === firstWorkspaceIndex || (firstWorkspaceIndex === -1 && index === 0))
  ) {
    refs.push({ label: currentBranchName, kind: "current" });
  }
  if (refs.length === 0 && baseRef && index === firstBaseIndex) {
    refs.push({ label: baseRef, kind: "base" });
  }
  return refs;
}

function CommitsSectionContent({
  query,
  now,
  currentBranchName,
  onCommitPress,
}: {
  query: Exclude<CheckoutCommitsQueryResult, { status: "unsupported" }>;
  now: Date;
  currentBranchName: string | null;
  onCommitPress: (sha: string) => void;
}) {
  const { t } = useTranslation();
  const [expandedSha, setExpandedSha] = useState<string | null>(null);
  const loadedCommitCount = query.status === "loaded" ? query.data.commits.length : 0;
  const isFetchingNextPage = query.status === "loaded" && query.isFetchingNextPage;
  const firstWorkspaceIndex =
    query.status === "loaded" ? query.data.commits.findIndex((commit) => !commit.isOnBase) : -1;
  const firstBaseIndex =
    query.status === "loaded" ? query.data.commits.findIndex((commit) => commit.isOnBase) : -1;
  const baseRef = query.status === "loaded" ? query.data.baseRef : null;
  const handleToggleExpanded = useCallback((sha: string) => {
    setExpandedSha((current) => (current === sha ? null : sha));
  }, []);
  const renderCommit = useCallback(
    ({ item, index }: { item: ClassifiedCheckoutCommit; index: number }) => (
      <CommitRow
        commit={item}
        isFirst={index === 0}
        isLast={index === loadedCommitCount - 1}
        isOnBaseLane={item.isOnBase && firstWorkspaceIndex !== -1}
        isBranchPoint={item.isOnBase && index === firstBaseIndex && firstWorkspaceIndex !== -1}
        now={now}
        isExpanded={expandedSha === item.sha}
        refs={resolveCommitRefs({
          commit: item,
          index,
          firstWorkspaceIndex,
          firstBaseIndex,
          currentBranchName,
          baseRef,
        })}
        onToggleExpanded={handleToggleExpanded}
        onOpenCommitDiff={onCommitPress}
      />
    ),
    [
      currentBranchName,
      baseRef,
      expandedSha,
      firstBaseIndex,
      firstWorkspaceIndex,
      handleToggleExpanded,
      loadedCommitCount,
      now,
      onCommitPress,
    ],
  );
  const renderFooter = useCallback(
    () =>
      isFetchingNextPage ? (
        <ThemedActivityIndicator
          size="small"
          uniProps={activityIndicatorColorMapping}
          style={styles.loadingMore}
          testID="commits-section-loading-more"
        />
      ) : null,
    [isFetchingNextPage],
  );

  if (query.status === "error") {
    return (
      <Text style={styles.errorRow} testID="commits-section-error">
        {t("workspace.git.diff.commits.loadError")}
      </Text>
    );
  }
  if (query.status !== "loaded") {
    return <CommitsSectionSkeleton />;
  }
  if (query.data.commits.length === 0) {
    return (
      <View style={styles.emptyRow} testID="commits-section-empty">
        <Text style={styles.emptyText}>{t("workspace.git.diff.commits.empty")}</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={query.data.commits}
      renderItem={renderCommit}
      keyExtractor={commitKeyExtractor}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      onEndReached={query.hasNextPage ? query.loadMore : undefined}
      onEndReachedThreshold={0.35}
      ListFooterComponent={renderFooter}
    />
  );
}

export function CommitsSection({
  serverId,
  cwd,
  gitActions,
  fetchSupported,
  hasRemote,
  isFetching,
  onFetch,
  refreshSupported,
  isRefreshing,
  onRefresh,
  currentBranchName,
  onCommitPress,
}: CommitsSectionProps) {
  const { t } = useTranslation();
  const { height: viewportHeight } = useWindowDimensions();
  const { preferences, updatePreferences } = useChangesPreferences();
  const isPanelActive = useRetainedPanelActive();
  const collapsed = preferences.commitsCollapsed;
  const resolvedHeight = resolveGraphHeight(preferences.commitsHeight, viewportHeight);
  const startHeightRef = useRef(resolvedHeight);
  const resizeHeight = useSharedValue(resolvedHeight);
  const [now, setNow] = useState(() => new Date());
  const displayNow = useMemo(() => (isPanelActive ? new Date() : now), [isPanelActive, now]);
  const query = useCheckoutCommitsQuery({
    serverId,
    cwd,
    enabled: !collapsed,
  });

  useEffect(() => {
    resizeHeight.value = resolvedHeight;
  }, [resizeHeight, resolvedHeight]);

  const handleToggleSection = useCallback(() => {
    if (collapsed) {
      setNow(new Date());
    }
    void updatePreferences({ commitsCollapsed: !collapsed });
  }, [collapsed, updatePreferences]);

  const persistGraphHeight = useCallback(
    (height: number) => {
      void updatePreferences({ commitsHeight: height });
    },
    [updatePreferences],
  );

  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!collapsed)
        .hitSlop({ top: 8, bottom: 8, left: 0, right: 0 })
        .onStart(() => {
          startHeightRef.current = resolvedHeight;
          resizeHeight.value = resolvedHeight;
        })
        .onUpdate((event) => {
          resizeHeight.value = resolveGraphHeight(
            startHeightRef.current - event.translationY,
            viewportHeight,
          );
        })
        .onEnd(() => {
          runOnJS(persistGraphHeight)(resizeHeight.value);
        }),
    [collapsed, persistGraphHeight, resizeHeight, resolvedHeight, viewportHeight],
  );

  const expandedHeightStyle = useAnimatedStyle(() => ({ height: resizeHeight.value }));

  useEffect(() => {
    if (collapsed || !isPanelActive) {
      return;
    }
    const interval = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(interval);
  }, [collapsed, isPanelActive]);

  const headerChevronStyle = useMemo(
    () => [styles.headerChevron, !collapsed && styles.headerChevronExpanded],
    [collapsed],
  );

  if (query.status === "unsupported") {
    return null;
  }
  const commitCount = query.status === "loaded" ? query.data.commits.length : null;

  return (
    <View style={styles.container}>
      <Animated.View style={[animatedStaticStyles.container, !collapsed && expandedHeightStyle]}>
        {collapsed ? null : <GraphResizeHandle gesture={resizeGesture} />}
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            testID="commits-section-header"
            onPress={handleToggleSection}
            style={styles.headerToggle}
          >
            <View style={headerChevronStyle}>
              <ThemedChevron size={14} uniProps={chevronColorMapping} />
            </View>
            <Text style={styles.title}>{t("workspace.git.diff.commits.title")}</Text>
            {commitCount === null ? (
              <View style={styles.countSpacer} />
            ) : (
              <Text
                style={styles.count}
                accessibilityLabel={t("workspace.git.diff.commits.countLabel", {
                  count: commitCount,
                })}
              >
                {commitCount}
              </Text>
            )}
          </Pressable>
          <GraphActions
            gitActions={gitActions}
            fetchSupported={fetchSupported}
            hasRemote={hasRemote}
            isFetching={isFetching}
            onFetch={onFetch}
            refreshSupported={refreshSupported}
            isRefreshing={isRefreshing}
            onRefresh={onRefresh}
          />
        </View>
        {collapsed ? null : (
          <View style={styles.body}>
            <CommitsSectionContent
              query={query}
              now={displayNow}
              currentBranchName={currentBranchName}
              onCommitPress={onCommitPress}
            />
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const animatedStaticStyles = RNStyleSheet.create({
  container: {
    position: "relative",
  },
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flexShrink: 0,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  header: {
    height: 22,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: theme.spacing[2],
    flexShrink: 0,
  },
  headerToggle: {
    height: 22,
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
  },
  headerChevron: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  headerChevronExpanded: {
    transform: [{ rotate: "90deg" }],
  },
  title: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  count: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    flex: 1,
  },
  countSpacer: {
    flex: 1,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: theme.spacing[1],
  },
  loadingMore: {
    marginVertical: theme.spacing[2],
  },
  emptyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  emptyText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  errorRow: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.statusDanger,
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  skeleton: {
    paddingBottom: theme.spacing[1],
    gap: theme.spacing[2],
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    minHeight: 20,
  },
  skeletonDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  skeletonSubject: {
    flex: 1,
    minWidth: 0,
    height: 12,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
  },
  skeletonTimestamp: {
    width: 40,
    height: 10,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
    flexShrink: 0,
  },
  skeletonCaret: {
    width: 16,
    height: 16,
    flexShrink: 0,
  },
}));
