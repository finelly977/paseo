import { ModelLibraryList } from "@/model-library/model-list";
import { useModelLibrary, type ModelLibrary } from "@/model-library/use-model-library";
import { ModelProviderGlyph } from "./model-provider-glyph";
import { createContext, useCallback, useContext, useMemo, useReducer, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AlertTriangle, Check, ChevronRight, Search, Star } from "lucide-react-native";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import type { SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { isWeb } from "@/constants/platform";
import {
  buildSelectedTriggerLabel,
  filterAndRankModelRows,
  getAllProviderModelRows,
  getProviderModelRows,
  resolveSelectedModelLabel,
  type ProviderSelectionModelRow,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { ModelBrowserHeaderActions } from "@/components/model-browser-actions";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import {
  resolveCompactModelMenuHeight,
  resolveInitialModelBrowserView,
  resolveModelBrowserAllView,
  type ModelBrowserView,
} from "@/components/model-browser-view";

const DESKTOP_PROVIDER_VIEW_MIN_HEIGHT = 220;
const DESKTOP_PROVIDER_VIEW_MAX_HEIGHT = 400;
const DESKTOP_PROVIDER_VIEW_BASE_HEIGHT = 80;
const DESKTOP_MODEL_ROW_HEIGHT = 40;

const ThemedAlertTriangle = withUnistyles(AlertTriangle);
const ThemedCheck = withUnistyles(Check);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedSearch = withUnistyles(Search);
const IndependentScrollGestureContext = createContext<ReturnType<typeof Gesture.Native> | null>(
  null,
);

const foregroundMutedMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

interface ModelBrowserInput {
  onRefreshProvider?: (provider: AgentProvider) => void;
  isRefreshingProvider?: boolean;
  compactMenu?: boolean;
  providerLocked?: boolean;
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  isLoading: boolean;
  serverId?: string | null;
}

export interface ModelBrowserState {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  view: ModelBrowserView;
  searchQuery: string;
  library: ModelLibrary;
  showFavorites: () => void;
  header: SheetHeader;
  selectedModelLabel: string;
  triggerLabel: string;
  desktopFixedHeight: number | undefined;
  prepareToOpen: () => void;
  reset: () => void;
  drillDown: (providerId: string, providerLabel: string) => void;
}

interface ModelBrowserProps {
  state: ModelBrowserState;
  onSelect: (provider: string, modelId: string) => void;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider?: boolean;
  scrolling?: "sheet" | "independent";
}

interface ModelBrowserContentProps extends Omit<ModelBrowserProps, "state" | "scrolling"> {
  library: ModelLibrary;
  onShowFavorites: () => void;
  view: ModelBrowserView;
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  searchQuery: string;
  onDrillDown: (providerId: string, providerLabel: string) => void;
  scrolling: "sheet" | "independent";
}

export { ModelProviderGlyph } from "./model-provider-glyph";

function countModelsInView(
  view: ModelBrowserView,
  providers: ProviderSelectorProvider[],
  query = "",
): number {
  if (view.kind !== "provider")
    return filterAndRankModelRows(getAllProviderModelRows(providers), query).length;
  const provider = providers.find((entry) => entry.id === view.providerId);
  const rows = provider?.modelSelection.kind === "models" ? getProviderModelRows(provider) : [];
  return filterAndRankModelRows(rows, query).length;
}

function resolveDesktopFixedHeight(
  view: ModelBrowserView,
  providers: ProviderSelectorProvider[],
): number {
  const modelCount = countModelsInView(view, providers);
  return Math.min(
    Math.max(
      DESKTOP_PROVIDER_VIEW_MIN_HEIGHT,
      DESKTOP_PROVIDER_VIEW_BASE_HEIGHT + modelCount * DESKTOP_MODEL_ROW_HEIGHT,
    ),
    DESKTOP_PROVIDER_VIEW_MAX_HEIGHT,
  );
}

export function useModelBrowser({
  onRefreshProvider,
  isRefreshingProvider = false,
  compactMenu = false,
  providerLocked = false,
  providers,
  selectedProvider,
  selectedModel,
  isLoading,
  serverId = null,
}: ModelBrowserInput): ModelBrowserState {
  const { t } = useTranslation();
  // 紧凑浮层会挂载到独立根；查询与错误提示留在调用者上下文中，通过值传入列表。
  const library = useModelLibrary(serverId);
  const [view, setView] = useState<ModelBrowserView>({ kind: "all" });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResetKey, bumpSearchResetKey] = useReducer((key: number) => key + 1, 0);

  const initialView = useMemo(
    () =>
      resolveInitialModelBrowserView({
        providers,
        selectedProvider,
        selectedModel,
        providerLocked,
      }),
    [providers, selectedProvider, selectedModel, providerLocked],
  );

  const prepareToOpen = useCallback(() => {
    setView(initialView);
  }, [initialView]);

  const reset = useCallback(() => {
    setSearchQuery("");
    bumpSearchResetKey();
  }, []);

  const handleBackToAll = useCallback(() => {
    setView({ kind: "all" });
    reset();
  }, [reset]);

  const drillDown = useCallback(
    (providerId: string, providerLabel: string) => {
      setView({ kind: "provider", providerId, providerLabel });
      reset();
    },
    [reset],
  );

  const showFavorites = useCallback(() => {
    setView({ kind: "favorites" });
    reset();
  }, [reset]);

  const handleSearchQueryChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  // 只有一个提供方时直接进入模型列表，收藏仍可从标题栏进入。
  const singleProviderView = providerLocked || providers.length === 1;
  const header = useMemo<SheetHeader>(() => {
    if (view.kind !== "provider") {
      return {
        title: view.kind === "favorites" ? "收藏模型" : t("modelSelector.title"),
        back: view.kind === "favorites" ? { onPress: handleBackToAll } : undefined,
        actions: (
          <Button
            size="xs"
            variant="ghost"
            leftIcon={Star}
            onPress={showFavorites}
            accessibilityLabel="收藏模型"
          />
        ),
        search: {
          onChange: handleSearchQueryChange,
          resetKey: `all:${searchResetKey}`,
          placeholder: t("modelSelector.searchAllPlaceholder"),
          autoFocus: isWeb,
          testID: "model-search-all-input",
        },
      };
    }
    return {
      title: view.providerLabel,
      leading: (
        <ModelProviderGlyph provider={view.providerId} size={ICON_SIZE.md} tone="foreground" />
      ),
      back: singleProviderView ? undefined : { onPress: handleBackToAll },
      actions: (
        <View style={styles.headerActions}>
          <Button
            size="xs"
            variant="ghost"
            leftIcon={Star}
            onPress={showFavorites}
            accessibilityLabel="收藏模型"
          />
          <ModelBrowserHeaderActions
            provider={view.providerId}
            providerLabel={view.providerLabel}
            serverId={serverId}
            onRefresh={onRefreshProvider}
            pending={isRefreshingProvider}
          />
        </View>
      ),
      search: {
        onChange: handleSearchQueryChange,
        resetKey: `${view.providerId}:${searchResetKey}`,
        placeholder: t("modelSelector.searchPlaceholder"),
        autoFocus: isWeb,
        testID: "model-search-input",
      },
    };
  }, [
    handleBackToAll,
    handleSearchQueryChange,
    searchResetKey,
    serverId,
    singleProviderView,
    showFavorites,
    t,
    view,
    onRefreshProvider,
    isRefreshingProvider,
  ]);

  const selectedModelLabel = useMemo(
    () =>
      resolveSelectedModelLabel({
        providers,
        selectedProvider,
        selectedModel,
        isLoading,
      }),
    [isLoading, providers, selectedModel, selectedProvider],
  );

  const triggerLabel = useMemo(() => {
    const isPlaceholder =
      selectedModelLabel === t("modelSelector.loading") ||
      selectedModelLabel === t("modelSelector.selectModel");
    return isPlaceholder ? selectedModelLabel : buildSelectedTriggerLabel(selectedModelLabel);
  }, [selectedModelLabel, t]);

  const desktopFixedHeight = useMemo(
    () =>
      compactMenu
        ? resolveCompactModelMenuHeight(
            countModelsInView(view, providers, normalizeSearchQuery(searchQuery)),
          )
        : resolveDesktopFixedHeight(view, providers),
    [providers, view, compactMenu, searchQuery],
  );

  return {
    providers,
    selectedProvider,
    selectedModel,
    library,
    showFavorites,
    view,
    searchQuery,
    header,
    selectedModelLabel,
    triggerLabel,
    desktopFixedHeight,
    prepareToOpen,
    reset,
    drillDown,
  };
}

function normalizeSearchQuery(value: string): string {
  return value.trim().toLowerCase();
}

interface ModelBrowserPressableProps {
  children: React.ReactNode | ((state: PressableStateCallbackType) => React.ReactNode);
  style?:
    | StyleProp<ViewStyle>
    | ((state: PressableStateCallbackType & { hovered?: boolean }) => StyleProp<ViewStyle>);
  onPress: () => void;
  hitSlop?: number;
  accessibilityLabel?: string;
  /** Only rows that can express selection pass this; the rest stay unannotated. */
  accessibilitySelected?: boolean;
  testID?: string;
}

function ModelBrowserPressable({
  children,
  style,
  onPress,
  hitSlop,
  accessibilityLabel,
  accessibilitySelected,
  testID,
}: ModelBrowserPressableProps) {
  const independentScrollGesture = useContext(IndependentScrollGestureContext);
  const [pressed, setPressed] = useState(false);
  // Android's scroll handler must keep the pointer stream until release so a
  // fling survives leaving the short viewport. A simultaneous Tap keeps rows
  // interactive, while maxDistance makes a real scroll fail instead of select.
  const tapGesture = useMemo(() => {
    const gesture = Gesture.Tap()
      .maxDistance(8)
      .shouldCancelWhenOutside(true)
      .runOnJS(true)
      .onBegin(() => setPressed(true))
      .onEnd((_event, success) => {
        if (success) onPress();
      })
      .onFinalize(() => setPressed(false));
    if (hitSlop !== undefined) gesture.hitSlop(hitSlop);
    if (independentScrollGesture) {
      gesture.simultaneousWithExternalGesture(independentScrollGesture);
    }
    return gesture;
  }, [hitSlop, independentScrollGesture, onPress]);
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onPress();
    },
    [onPress],
  );
  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === "activate") onPress();
    },
    [onPress],
  );
  const accessibilityState = useMemo(
    () => (accessibilitySelected === undefined ? undefined : { selected: accessibilitySelected }),
    [accessibilitySelected],
  );

  if (!independentScrollGesture) {
    return (
      <Pressable
        onPress={handlePress}
        hitSlop={hitSlop}
        style={style}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
        aria-selected={accessibilitySelected}
        testID={testID}
      >
        {children}
      </Pressable>
    );
  }

  const state = { pressed };
  const resolvedStyle = typeof style === "function" ? style(state) : style;
  const resolvedChildren = typeof children === "function" ? children(state) : children;
  return (
    <GestureDetector gesture={tapGesture}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
        aria-selected={accessibilitySelected}
        accessibilityActions={[{ name: "activate" }]}
        onAccessibilityAction={handleAccessibilityAction}
        style={resolvedStyle}
        testID={testID}
      >
        {resolvedChildren}
      </View>
    </GestureDetector>
  );
}

type ModelBrowserRowTone = "default" | "elevated" | "drillDown";

function ModelBrowserRow({
  label,
  description,
  leadingSlot,
  trailingSlot,
  selected = false,
  selectionIndicator = false,
  tone = "default",
  labelMuted = false,
  spacing = "model",
  onPress,
  testID,
}: {
  label: string;
  description?: string;
  leadingSlot: React.ReactNode;
  trailingSlot?: React.ReactNode;
  selected?: boolean;
  selectionIndicator?: boolean;
  tone?: ModelBrowserRowTone;
  /** For rows that offer an action rather than name a thing you can pick. */
  labelMuted?: boolean;
  spacing?: "model" | "provider";
  onPress: () => void;
  testID?: string;
}) {
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.browserRow,
      selected && styles.browserRowSelected,
      spacing === "model" && styles.browserModelRow,
      Boolean(hovered) &&
        (tone === "elevated" ? styles.browserRowHoveredElevated : styles.browserRowHovered),
      pressed && (tone === "default" ? styles.browserRowPressed : styles.browserRowPressedElevated),
    ],
    [spacing, tone, selected],
  );
  const contentStyle = useMemo(
    () => [styles.browserRowText, description && styles.browserRowTextInline],
    [description],
  );
  const hasTrailing = selected || trailingSlot;

  return (
    <ModelBrowserPressable
      onPress={onPress}
      style={pressableStyle}
      // 只有显示勾选的模型行声明选中状态。
      accessibilitySelected={selectionIndicator ? selected : undefined}
      testID={testID}
    >
      <View style={styles.browserRowContent}>
        <View style={styles.browserRowLeading}>{leadingSlot}</View>
        <View style={contentStyle}>
          <Text
            numberOfLines={1}
            style={labelMuted ? styles.browserRowLabelMuted : styles.browserRowLabel}
          >
            {label}
          </Text>
          {description ? (
            <Text numberOfLines={1} style={styles.browserRowDescription}>
              {description}
            </Text>
          ) : null}
        </View>
        {hasTrailing ? (
          <View style={styles.browserRowTrailing}>
            {selectionIndicator ? (
              <View style={styles.browserRowSelection}>
                {selected ? (
                  <ThemedCheck size={ICON_SIZE.sm} uniProps={foregroundMutedMapping} />
                ) : null}
              </View>
            ) : null}
            {trailingSlot}
          </View>
        ) : null}
      </View>
    </ModelBrowserPressable>
  );
}

function GroupProviderButton({
  provider,
  onDrillDown,
}: {
  provider: ProviderSelectorProvider;
  onDrillDown: (providerId: string, providerLabel: string) => void;
}) {
  const { t } = useTranslation();
  const selection = provider.modelSelection;
  const handlePress = useCallback(() => {
    onDrillDown(provider.id, provider.label);
  }, [onDrillDown, provider.id, provider.label]);

  const stateNode = useMemo(() => {
    if (selection.kind === "models") {
      const count = selection.rows.length;
      return (
        <Text style={styles.drillDownCount}>
          {t(count === 1 ? "modelSelector.modelCount" : "modelSelector.modelCountPlural", {
            count,
          })}
        </Text>
      );
    }
    if (selection.kind === "loading") {
      return (
        <View style={styles.rowStateInline}>
          <View style={styles.rowSpinner}>
            <ThemedLoadingSpinner size={ICON_SIZE.sm} uniProps={foregroundMutedMapping} />
          </View>
          <Text style={styles.drillDownCount}>{t("modelSelector.loadingShort")}</Text>
        </View>
      );
    }
    return (
      <View style={styles.rowStateInline}>
        <ThemedAlertTriangle size={ICON_SIZE.sm} uniProps={foregroundMutedMapping} />
        <Text style={styles.drillDownCount}>{t("modelSelector.error")}</Text>
      </View>
    );
  }, [selection, t]);
  const leadingSlot = useMemo(
    () => <ModelProviderGlyph provider={provider.id} size={ICON_SIZE.sm} />,
    [provider.id],
  );
  const trailingSlot = useMemo(
    () => (
      <View style={styles.drillDownTrailing}>
        {stateNode}
        <ThemedChevronRight size={ICON_SIZE.sm} uniProps={foregroundMutedMapping} />
      </View>
    ),
    [stateNode],
  );

  return (
    <ModelBrowserRow
      label={provider.label}
      leadingSlot={leadingSlot}
      trailingSlot={trailingSlot}
      tone="drillDown"
      spacing="provider"
      onPress={handlePress}
      testID={`model-provider-${provider.id}`}
    />
  );
}

function GroupedProviderRows({
  providers,
  onDrillDown,
}: {
  providers: ProviderSelectorProvider[];
  onDrillDown: (providerId: string, providerLabel: string) => void;
}) {
  return (
    <View>
      {providers.map((provider, index) => (
        <View key={provider.id}>
          {index > 0 ? <View style={styles.separator} /> : null}
          <GroupProviderButton provider={provider} onDrillDown={onDrillDown} />
        </View>
      ))}
    </View>
  );
}

function IndependentScrollBoundary({ children }: { children: React.ReactElement }) {
  // Prevent the parent sheet from cancelling Android's native scroll when the
  // finger crosses this viewport; receiving ACTION_UP is what preserves fling.
  const nativeScrollGesture = useMemo(
    () =>
      Gesture.Native()
        .shouldActivateOnStart(true)
        .shouldCancelWhenOutside(false)
        .disallowInterruption(true),
    [],
  );

  if (Platform.OS !== "android") {
    return children;
  }

  return (
    <IndependentScrollGestureContext.Provider value={nativeScrollGesture}>
      <GestureDetector gesture={nativeScrollGesture}>{children}</GestureDetector>
    </IndependentScrollGestureContext.Provider>
  );
}

function IndependentProviderList({ children }: { children: React.ReactNode }) {
  return (
    <IndependentScrollBoundary>
      <ScrollView
        style={styles.virtualizedModelList}
        contentContainerStyle={[
          styles.virtualizedModelListContent,
          styles.virtualizedProviderListContent,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        testID="compact-provider-list"
      >
        {children}
      </ScrollView>
    </IndependentScrollBoundary>
  );
}

function ProviderErrorEmptyState({
  providerId,
  message,
  onRetryProvider,
  isRetryingProvider,
}: {
  providerId: string;
  message: string;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider: boolean;
}) {
  const { t } = useTranslation();
  const handleRetry = useCallback(() => {
    onRetryProvider?.(providerId);
  }, [onRetryProvider, providerId]);
  return (
    <View style={styles.emptyState}>
      <ThemedAlertTriangle size={ICON_SIZE.md} uniProps={foregroundMutedMapping} />
      <Text style={styles.emptyStateText}>{message}</Text>
      {onRetryProvider ? (
        <Button variant="default" size="sm" onPress={handleRetry} disabled={isRetryingProvider}>
          {isRetryingProvider ? t("modelSelector.retrying") : t("modelSelector.retry")}
        </Button>
      ) : null}
    </View>
  );
}

function ModelSearchEmptyState() {
  const { t } = useTranslation();
  return (
    <View style={styles.emptyState}>
      <ThemedSearch size={ICON_SIZE.md} uniProps={foregroundMutedMapping} />
      <Text style={styles.emptyStateText}>{t("modelSelector.noMatches")}</Text>
    </View>
  );
}

function ProviderModelBrowserContent({
  view,
  catalogRows,
  library,
  provider,
  selectedProvider,
  selectedModel,
  normalizedQuery,
  onSelect,
  onRetryProvider,
  isRetryingProvider,
}: {
  library: ModelLibrary;
  catalogRows: ProviderSelectionModelRow[];
  view: Extract<ModelBrowserView, { kind: "provider" }>;
  provider: ProviderSelectorProvider | null;
  selectedProvider: string;
  selectedModel: string;
  normalizedQuery: string;
  onSelect: (provider: string, modelId: string) => void;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider: boolean;
}) {
  const { t } = useTranslation();
  const visibleRows = useMemo(
    () => (provider ? filterAndRankModelRows(getProviderModelRows(provider), normalizedQuery) : []),
    [normalizedQuery, provider],
  );
  if (!provider) return <ModelSearchEmptyState />;
  const selection = provider.modelSelection;
  if (selection.kind === "loading") {
    return (
      <View style={styles.emptyState}>
        <View style={styles.rowSpinner}>
          <ThemedLoadingSpinner size={ICON_SIZE.sm} uniProps={foregroundMutedMapping} />
        </View>
        <Text style={styles.emptyStateText}>{t("modelSelector.loadingShort")}</Text>
      </View>
    );
  }
  if (selection.kind === "error") {
    return (
      <ProviderErrorEmptyState
        providerId={view.providerId}
        message={selection.message}
        onRetryProvider={onRetryProvider}
        isRetryingProvider={isRetryingProvider}
      />
    );
  }
  if (visibleRows.length === 0) {
    return <ModelSearchEmptyState />;
  }
  return (
    <ModelLibraryList
      rows={visibleRows}
      catalogRows={catalogRows}
      library={library}
      selectedProvider={selectedProvider}
      selectedModel={selectedModel}
      onSelect={onSelect}
    />
  );
}

function ModelBrowserContent({
  view,
  library,
  onShowFavorites,
  providers,
  selectedProvider,
  selectedModel,
  searchQuery,
  onSelect,
  onDrillDown,
  onRetryProvider,
  isRetryingProvider = false,
  scrolling,
}: ModelBrowserContentProps) {
  const { t } = useTranslation();
  const normalizedQuery = useMemo(() => normalizeSearchQuery(searchQuery), [searchQuery]);
  const selectedViewProvider = useMemo(
    () =>
      view.kind === "provider"
        ? (providers.find((provider) => provider.id === view.providerId) ?? null)
        : null,
    [providers, view],
  );
  const allView = useMemo(
    () => resolveModelBrowserAllView({ providers, normalizedQuery }),
    [normalizedQuery, providers],
  );
  const hasResults = providers.length > 0;
  const catalogRows = useMemo(() => getAllProviderModelRows(providers), [providers]);

  if (view.kind === "favorites")
    return (
      <ModelLibraryList
        rows={filterAndRankModelRows(catalogRows, normalizedQuery)}
        catalogRows={catalogRows}
        library={library}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        onSelect={onSelect}
        favoritesOnly
      />
    );

  if (view.kind === "provider") {
    return (
      <ProviderModelBrowserContent
        view={view}
        catalogRows={catalogRows}
        library={library}
        provider={selectedViewProvider}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        normalizedQuery={normalizedQuery}
        onSelect={onSelect}
        onRetryProvider={onRetryProvider}
        isRetryingProvider={isRetryingProvider}
      />
    );
  }

  if (allView.kind === "noSearchMatches") {
    return (
      <View style={styles.emptyState} testID="model-search-empty">
        <ThemedSearch size={ICON_SIZE.md} uniProps={foregroundMutedMapping} />
        <Text style={styles.emptyStateText}>
          {t("modelSelector.noMatchesForQuery", { query: searchQuery.trim() })}
        </Text>
      </View>
    );
  }

  if (allView.kind === "searchResults") {
    return (
      <ModelLibraryList
        rows={allView.rows}
        catalogRows={catalogRows}
        library={library}
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        onSelect={onSelect}
      />
    );
  }

  const allProvidersContent = (
    <View>
      <Button size="sm" variant="ghost" leftIcon={Star} onPress={onShowFavorites}>
        收藏模型
      </Button>
      {providers.length > 0 ? (
        <GroupedProviderRows providers={providers} onDrillDown={onDrillDown} />
      ) : null}
      {!hasResults ? <ModelSearchEmptyState /> : null}
    </View>
  );

  return scrolling === "independent" ? (
    <IndependentProviderList>{allProvidersContent}</IndependentProviderList>
  ) : (
    <BottomSheetScrollView
      style={styles.virtualizedModelList}
      contentContainerStyle={[
        styles.virtualizedModelListContent,
        styles.virtualizedProviderListContent,
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      testID="compact-provider-list"
    >
      {allProvidersContent}
    </BottomSheetScrollView>
  );
}

export function ModelBrowser({
  state,
  onSelect,
  onRetryProvider,
  isRetryingProvider = false,
  scrolling = "sheet",
}: ModelBrowserProps) {
  return (
    <ModelBrowserContent
      view={state.view}
      library={state.library}
      onShowFavorites={state.showFavorites}
      providers={state.providers}
      selectedProvider={state.selectedProvider}
      selectedModel={state.selectedModel}
      searchQuery={state.searchQuery}
      onSelect={onSelect}
      onDrillDown={state.drillDown}
      onRetryProvider={onRetryProvider}
      isRetryingProvider={isRetryingProvider}
      scrolling={scrolling}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  separator: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: isWeb ? theme.spacing[3] : theme.spacing[6],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  sectionHeadingText: {
    flex: 1,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  browserRow: {
    marginHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    flexDirection: "row",
    paddingVertical: theme.spacing[2],
    minHeight: 36,
  },
  browserModelRow: isWeb ? {} : { marginBottom: theme.spacing[1] },
  browserRowSelected: {
    backgroundColor: theme.colors.surface3,
  },
  browserRowHovered: {
    backgroundColor: theme.colors.surface3,
  },
  browserRowHoveredElevated: {
    backgroundColor: theme.colors.surface3,
  },
  browserRowPressed: {
    backgroundColor: theme.colors.surface3,
  },
  browserRowPressedElevated: {
    backgroundColor: theme.colors.surface3,
  },
  browserRowContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: isWeb ? theme.spacing[3] : theme.spacing[6],
  },
  browserRowLeading: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  browserRowText: {
    flex: 1,
    flexShrink: 1,
  },
  browserRowTextInline: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing[2],
  },
  browserRowLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    flexShrink: 0,
  },
  browserRowLabelMuted: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
  browserRowDescription: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  browserRowTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginLeft: "auto",
  },
  browserRowSelection: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  drillDownTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  drillDownCount: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  rowStateInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
    minWidth: 0,
  },
  rowIconButton: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  rowSpinner: {
    transform: [{ scale: 0.7 }],
  },
  rowIconButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowIconButtonPressed: {
    backgroundColor: theme.colors.surface1,
  },
  emptyState: {
    paddingVertical: theme.spacing[4],
    alignItems: "center",
    gap: theme.spacing[2],
  },
  emptyStateText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  tooltipText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  virtualizedModelList: {
    flex: 1,
  },
  virtualizedModelListContent: {
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[8],
  },
  virtualizedProviderListContent: {
    paddingTop: 0,
  },
  providerIconMuted: {
    color: theme.colors.foregroundMuted,
  },
  providerIconForeground: {
    color: theme.colors.foreground,
  },
}));
