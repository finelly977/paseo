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
  type CheckoutCommitRefFilter,
  type CheckoutCommitsData,
  type CheckoutCommitsQueryResult,
} from "@/git/use-commits-query";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { CommitRow } from "./commit-row";
import {
  buildCommitGraphViewModels,
  getCommitGraphWidth,
  resolveCommitGraphHeight,
  type CommitGraphViewModel,
} from "./graph-model";
import { GraphActions } from "./graph-actions";
import { GraphResizeHandle } from "./graph-resize-handle";

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const AUTO_REF_FILTER: CheckoutCommitRefFilter = { mode: "auto" };

const activityIndicatorColorMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});

const commitKeyExtractor = (viewModel: CommitGraphViewModel) => viewModel.commit.sha;

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
  onCommitPress: (sha: string, path?: string) => void;
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
      {Array.from({ length: 6 }, (_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <View style={styles.skeletonGraph} />
          <View style={styles.skeletonSubject} />
          <View style={styles.skeletonRef} />
        </View>
      ))}
    </View>
  );
}

function CommitsSectionContent({
  query,
  viewModels,
  now,
  selectedSha,
  expandedSha,
  listRef,
  onToggleExpanded,
  onCommitPress,
}: {
  query: Exclude<CheckoutCommitsQueryResult, { status: "unsupported" }>;
  viewModels: CommitGraphViewModel[];
  now: Date;
  selectedSha: string | null;
  expandedSha: string | null;
  listRef: React.RefObject<FlatList<CommitGraphViewModel> | null>;
  onToggleExpanded: (sha: string) => void;
  onCommitPress: (sha: string, path?: string) => void;
}) {
  const { t } = useTranslation();
  const isFetchingNextPage = query.status === "loaded" && query.isFetchingNextPage;
  const renderCommit = useCallback(
    ({ item }: { item: CommitGraphViewModel }) => (
      <CommitRow
        viewModel={item}
        graphWidth={getCommitGraphWidth(item)}
        now={now}
        isSelected={selectedSha === item.commit.sha}
        isExpanded={expandedSha === item.commit.sha}
        onToggleExpanded={onToggleExpanded}
        onOpenCommitDiff={onCommitPress}
      />
    ),
    [expandedSha, now, onCommitPress, onToggleExpanded, selectedSha],
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
  const handleScrollToIndexFailed = useCallback(
    ({ index, averageItemLength }: { index: number; averageItemLength: number }) => {
      listRef.current?.scrollToOffset({
        offset: Math.max(0, index * averageItemLength),
        animated: true,
      });
    },
    [listRef],
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
  if (viewModels.length === 0) {
    return (
      <View style={styles.emptyRow} testID="commits-section-empty">
        <Text style={styles.emptyText}>{t("workspace.git.diff.commits.empty")}</Text>
      </View>
    );
  }

  return (
    <FlatList
      ref={listRef}
      data={viewModels}
      renderItem={renderCommit}
      keyExtractor={commitKeyExtractor}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      keyboardShouldPersistTaps="handled"
      onEndReached={query.hasNextPage ? query.loadMore : undefined}
      onEndReachedThreshold={0.35}
      onScrollToIndexFailed={handleScrollToIndexFailed}
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
  onCommitPress,
}: CommitsSectionProps) {
  const { t } = useTranslation();
  const { height: viewportHeight } = useWindowDimensions();
  const { preferences, updatePreferences } = useChangesPreferences();
  const isPanelActive = useRetainedPanelActive();
  const collapsed = preferences.commitsCollapsed;
  const resolvedHeight = resolveCommitGraphHeight(preferences.commitsHeight, viewportHeight);
  const resizeHeight = useSharedValue(resolvedHeight);
  const startResizeHeight = useSharedValue(resolvedHeight);
  const [now, setNow] = useState(() => new Date());
  const filterIdentity = `${serverId}\u0000${cwd}`;
  const [filterState, setFilterState] = useState<{
    identity: string;
    filter: CheckoutCommitRefFilter;
  }>({ identity: filterIdentity, filter: AUTO_REF_FILTER });
  const filter = filterState.identity === filterIdentity ? filterState.filter : AUTO_REF_FILTER;
  const [selectedState, setSelectedState] = useState<{ identity: string; sha: string | null }>({
    identity: filterIdentity,
    sha: null,
  });
  const [expandedState, setExpandedState] = useState<{ identity: string; sha: string | null }>({
    identity: filterIdentity,
    sha: null,
  });
  const selectedSha = selectedState.identity === filterIdentity ? selectedState.sha : null;
  const expandedSha = expandedState.identity === filterIdentity ? expandedState.sha : null;
  const [availableRefsCache, setAvailableRefsCache] = useState<{
    identity: string;
    refs: CheckoutCommitsData["availableRefs"];
  }>({ identity: filterIdentity, refs: [] });
  const listRef = useRef<FlatList<CommitGraphViewModel>>(null);
  const displayNow = useMemo(() => (isPanelActive ? new Date() : now), [isPanelActive, now]);
  const query = useCheckoutCommitsQuery({
    serverId,
    cwd,
    enabled: !collapsed,
    filter,
  });
  const loadedData = query.status === "loaded" ? query.data : null;
  useEffect(() => {
    resizeHeight.value = resolvedHeight;
  }, [resizeHeight, resolvedHeight]);

  useEffect(() => {
    if (
      loadedData &&
      (availableRefsCache.identity !== filterIdentity ||
        availableRefsCache.refs !== loadedData.availableRefs)
    ) {
      setAvailableRefsCache({ identity: filterIdentity, refs: loadedData.availableRefs });
    }
  }, [availableRefsCache, filterIdentity, loadedData]);
  const viewModels = useMemo(
    () =>
      loadedData
        ? buildCommitGraphViewModels({
            commits: loadedData.commits,
            headSha: loadedData.headSha,
            currentRef: loadedData.currentRef,
            upstreamRef: loadedData.upstreamRef,
            baseRef: loadedData.baseRef,
          })
        : [],
    [loadedData],
  );
  const headIndex =
    query.status === "loaded" && query.data.headSha
      ? viewModels.findIndex((viewModel) => viewModel.commit.sha === query.data.headSha)
      : -1;
  const availableRefs =
    loadedData?.availableRefs ??
    (availableRefsCache.identity === filterIdentity ? availableRefsCache.refs : []);

  useEffect(() => {
    if (collapsed || !isPanelActive) {
      return;
    }
    const interval = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(interval);
  }, [collapsed, isPanelActive]);

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
          startResizeHeight.value = resizeHeight.value;
        })
        .onUpdate((event) => {
          resizeHeight.value = resolveCommitGraphHeight(
            startResizeHeight.value - event.translationY,
            viewportHeight,
          );
        })
        .onEnd(() => {
          runOnJS(persistGraphHeight)(resizeHeight.value);
        }),
    [collapsed, persistGraphHeight, resizeHeight, startResizeHeight, viewportHeight],
  );
  const expandedHeightStyle = useAnimatedStyle(() => ({ height: resizeHeight.value }));
  const handleFilterChange = useCallback(
    (nextFilter: CheckoutCommitRefFilter) => {
      setFilterState({ identity: filterIdentity, filter: nextFilter });
      setSelectedState({ identity: filterIdentity, sha: null });
      setExpandedState({ identity: filterIdentity, sha: null });
    },
    [filterIdentity],
  );
  const handleToggleExpanded = useCallback(
    (sha: string) => {
      setSelectedState({ identity: filterIdentity, sha });
      setExpandedState((current) => ({
        identity: filterIdentity,
        sha: current.identity === filterIdentity && current.sha === sha ? null : sha,
      }));
    },
    [filterIdentity],
  );
  const handleLocateHead = useCallback(() => {
    if (headIndex === -1) {
      return;
    }
    setSelectedState({ identity: filterIdentity, sha: viewModels[headIndex].commit.sha });
    listRef.current?.scrollToIndex({ index: headIndex, animated: true, viewPosition: 0.35 });
  }, [filterIdentity, headIndex, viewModels]);
  const headerChevronStyle = useMemo(
    () => [styles.headerChevron, !collapsed && styles.headerChevronExpanded],
    [collapsed],
  );

  if (query.status === "unsupported") {
    return (
      <View style={[styles.container, styles.containerUnsupported]}>
        <View style={styles.header}>
          <Text style={styles.title}>{t("workspace.git.diff.commits.title")}</Text>
        </View>
        <Text style={styles.unsupportedText}>{t("workspace.git.diff.commits.updateHost")}</Text>
      </View>
    );
  }
  const commitCount = query.status === "loaded" ? query.data.commits.length : null;

  return (
    <View style={styles.container}>
      <Animated.View
        style={[animatedStaticStyles.resizableContainer, !collapsed && expandedHeightStyle]}
      >
        {collapsed ? null : (
          <GraphResizeHandle
            accessibilityLabel={t("workspace.git.diff.commits.resize")}
            gesture={resizeGesture}
          />
        )}
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
            {commitCount === null ? null : (
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
            availableRefs={availableRefs}
            filter={filter}
            onFilterChange={handleFilterChange}
            onLocateHead={handleLocateHead}
            canLocateHead={headIndex !== -1}
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
              viewModels={viewModels}
              now={displayNow}
              selectedSha={selectedSha}
              expandedSha={expandedSha}
              listRef={listRef}
              onToggleExpanded={handleToggleExpanded}
              onCommitPress={onCommitPress}
            />
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const animatedStaticStyles = RNStyleSheet.create({
  resizableContainer: {
    position: "relative",
  },
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flexShrink: 0,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  containerUnsupported: {
    flex: 0,
    minHeight: 68,
  },
  header: {
    height: 22,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: theme.spacing[1],
    flexShrink: 0,
  },
  headerToggle: {
    height: 22,
    flexShrink: 1,
    minWidth: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[1],
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
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  emptyText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  errorRow: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.statusDanger,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  unsupportedText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  skeleton: {
    paddingBottom: theme.spacing[1],
  },
  skeletonRow: {
    height: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
  },
  skeletonGraph: {
    width: 28,
    height: 10,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
  },
  skeletonSubject: {
    flex: 1,
    minWidth: 0,
    height: 10,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
  },
  skeletonRef: {
    width: 56,
    height: 14,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
  },
}));
