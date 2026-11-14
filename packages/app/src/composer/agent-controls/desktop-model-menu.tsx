import { ModelLibraryList } from "@/model-library/model-list";
import { useModelLibrary, type ModelLibrary } from "@/model-library/use-model-library";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type PressableStateCallbackType,
} from "react-native";
import { Check, RefreshCw, Search, Settings2, Star, Zap } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { ModelProviderGlyph } from "@/components/model-browser";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  filterAndRankModelRows,
  getAllProviderModelRows,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { COMPACT_LABEL_DATASET } from "@/styles/compact-label";
import { AgentControlIconGlyph } from "./control";
import type { DesktopAgentControlsContentProps } from "./index";
import { resolveDesktopModelMenuHeight } from "./layout";

type Controls = DesktopAgentControlsContentProps;
interface ChoiceProps {
  id: string;
  label: string;
  tooltip?: string;
  provider?: string;
  selected?: boolean;
  disabled?: boolean;
  iconOnly?: boolean;
  segmented?: boolean;
  onSelect: (id: string) => void;
  testID?: string;
  icon?: typeof Settings2;
}

function MenuChoice({
  id,
  label,
  tooltip = label,
  provider,
  selected = false,
  disabled = false,
  iconOnly = false,
  segmented = false,
  onSelect,
  testID,
  icon,
}: ChoiceProps) {
  const select = useCallback(() => onSelect(id), [id, onSelect]);
  const state = useMemo(() => ({ selected }), [selected]);
  const style = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType) => [
      iconOnly && styles.railButton,
      !iconOnly && styles.row,
      segmented && styles.segmentButton,
      (hovered || pressed || ((iconOnly || segmented) && selected)) && styles.active,
      disabled && styles.disabled,
    ],
    [disabled, iconOnly, segmented, selected],
  );
  const glyphSize = segmented ? 12 : 16;
  return (
    <Tooltip delayDuration={400} enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={state}
          disabled={disabled}
          onPress={select}
          style={style}
          testID={testID}
        >
          {provider ? (
            <ModelProviderGlyph provider={provider} size={iconOnly ? 18 : glyphSize} />
          ) : null}
          {icon ? <AgentControlIconGlyph icon={icon} size={glyphSize} /> : null}
          {!iconOnly ? (
            <Text numberOfLines={1} style={segmented ? styles.segmentLabel : styles.label}>
              {label}
            </Text>
          ) : null}
          {!iconOnly && !segmented && selected ? (
            <AgentControlIconGlyph icon={Check} size={14} />
          ) : null}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" maxWidth={420}>
        <Text style={styles.tooltip}>{tooltip}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function ModelChoices({
  active,
  providers,
  query,
  favoritesOnly,
  controls,
  library,
}: {
  active: ProviderSelectorProvider | undefined;
  providers: ProviderSelectorProvider[];
  query: string;
  favoritesOnly: boolean;
  controls: Controls;
  library: ModelLibrary;
}) {
  const { onRetryModelProvider } = controls;
  const catalogRows = useMemo(() => getAllProviderModelRows(providers), [providers]);
  const rows = useMemo(() => {
    let entries = providers;
    if (!favoritesOnly) entries = active ? [active] : [];
    return filterAndRankModelRows(getAllProviderModelRows(entries), query.trim().toLowerCase());
  }, [active, favoritesOnly, providers, query]);
  const retry = useCallback(() => {
    if (active) onRetryModelProvider?.(active.id);
  }, [active, onRetryModelProvider]);
  if (!favoritesOnly && !active) return <Text style={styles.empty}>当前主机没有可选模型</Text>;
  if (!favoritesOnly && active?.modelSelection.kind === "loading")
    return (
      <View style={styles.state}>
        <ActivityIndicator size="small" />
        <Text style={styles.muted}>正在读取模型…</Text>
      </View>
    );
  if (!favoritesOnly && active?.modelSelection.kind === "error")
    return (
      <View style={styles.state}>
        <Text style={styles.muted}>{active.modelSelection.message}</Text>
        {onRetryModelProvider ? (
          <MenuChoice
            id="retry"
            label={controls.isRetryingModelProvider ? "重试中…" : "重新加载"}
            onSelect={retry}
            disabled={controls.isRetryingModelProvider}
          />
        ) : null}
      </View>
    );
  return (
    <ModelLibraryList
      rows={rows}
      catalogRows={catalogRows}
      library={library}
      favoritesOnly={favoritesOnly}
      selectedProvider={controls.provider}
      selectedModel={controls.selectedModelId ?? ""}
      onSelect={controls.handleDesktopModelSelect}
      disabled={controls.modelDisabled}
    />
  );
}

function ThinkingChoices({ controls, visible }: { controls: Controls; visible: boolean }) {
  if (!controls.canSelectThinking) return null;
  return (
    <View style={styles.thinking} testID="agent-thinking-menu">
      <View style={styles.thinkingHeader}>
        <Text style={styles.muted}>思考强度</Text>
      </View>
      <ScrollView contentContainerStyle={styles.listContent}>
        {visible ? (
          controls.thinkingOptions?.map((option) => (
            <MenuChoice
              key={option.id}
              id={option.id}
              label={option.label}
              selected={option.id === controls.selectedThinkingOptionId}
              disabled={controls.disabled}
              onSelect={controls.handleThinkingSelect}
            />
          ))
        ) : (
          <Text style={styles.empty}>选择模型后调整</Text>
        )}
      </ScrollView>
    </View>
  );
}

function MenuFooter({ controls, advanced }: { controls: Controls; advanced: ReactNode }) {
  const { onSetFeature } = controls;
  const fast = controls.features?.find(
    (feature) => feature.id === "fast_mode" && feature.type === "toggle",
  );
  const setFast = useCallback(
    (id: string) => onSetFeature?.("fast_mode", id === "fast"),
    [onSetFeature],
  );
  if (!fast && !advanced) return null;
  return (
    <View style={styles.footer}>
      {fast ? (
        <View style={styles.segment}>
          <MenuChoice
            id="standard"
            label="标准"
            segmented
            selected={!fast.value}
            disabled={controls.disabled || !onSetFeature}
            onSelect={setFast}
          />
          <MenuChoice
            id="fast"
            label="快速"
            segmented
            icon={Zap}
            selected={Boolean(fast.value)}
            disabled={controls.disabled || !onSetFeature}
            onSelect={setFast}
          />
        </View>
      ) : null}
      {advanced ? (
        <DropdownMenu compact selectionCloseScope="current">
          <DropdownMenuTrigger accessibilityLabel="更多模型选项" style={styles.more}>
            <AgentControlIconGlyph icon={Settings2} size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" width={250} maxHeight={300} scrollable>
            {advanced}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </View>
  );
}

/** 模型、收藏与思考强度共用一个浮层，选择后保留主面板。 */
export function DesktopModelMenuContent({
  controls,
  advanced,
}: {
  controls: Controls;
  advanced: ReactNode;
}) {
  const { height } = useWindowDimensions();
  const [providerId, setProviderId] = useState(controls.provider);
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const library = useModelLibrary(controls.modelSelectorServerId);
  const providers = useMemo(
    () =>
      controls.providerLocked
        ? controls.modelSelectorProviders.filter((entry) => entry.id === controls.provider)
        : controls.modelSelectorProviders,
    [controls.modelSelectorProviders, controls.provider, controls.providerLocked],
  );
  const active = providers.find((entry) => entry.id === providerId) ?? providers[0];
  const selectProvider = useCallback((id: string) => {
    setProviderId(id);
    setFavoritesOnly(false);
    setQuery("");
  }, []);
  const showFavorites = useCallback(() => {
    setFavoritesOnly(true);
    setQuery("");
  }, []);
  const { onRetryModelProvider } = controls;
  const retryActive = useCallback(() => {
    if (active) onRetryModelProvider?.(active.id);
  }, [active, onRetryModelProvider]);
  const modelCount = favoritesOnly
    ? getAllProviderModelRows(providers).filter((row) =>
        library.preferences.favorites.includes(row.favoriteKey),
      ).length
    : getMenuModelCount(active);
  const menuHeight = resolveDesktopModelMenuHeight(
    height,
    modelCount,
    controls.thinkingOptions?.length ?? 0,
  );
  return (
    <View dataSet={COMPACT_LABEL_DATASET} style={styles.menu}>
      <View style={styles.columns(menuHeight)}>
        <ScrollView style={styles.rail} contentContainerStyle={styles.railContent}>
          <MenuChoice
            id="favorites"
            label="收藏模型"
            icon={Star}
            iconOnly
            selected={favoritesOnly}
            onSelect={showFavorites}
          />
          {providers.map((entry) => (
            <MenuChoice
              key={entry.id}
              id={entry.id}
              label={entry.label}
              provider={entry.id}
              iconOnly
              selected={!favoritesOnly && entry.id === active?.id}
              disabled={controls.disabled}
              onSelect={selectProvider}
            />
          ))}
        </ScrollView>
        <View style={styles.models}>
          <View style={styles.search}>
            <AgentControlIconGlyph icon={Search} size={14} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder={favoritesOnly ? "搜索收藏模型…" : "搜索模型…"}
              accessibilityLabel="搜索模型"
              testID="agent-model-search"
              style={styles.input}
            />
            {!favoritesOnly && onRetryModelProvider ? (
              <MenuChoice
                id="refresh"
                label="刷新模型目录"
                icon={RefreshCw}
                iconOnly
                onSelect={retryActive}
                disabled={controls.isRetryingModelProvider || !active}
              />
            ) : null}
          </View>
          <ModelChoices
            active={active}
            providers={providers}
            controls={controls}
            library={library}
            query={query}
            favoritesOnly={favoritesOnly}
          />
        </View>
        <ThinkingChoices
          controls={controls}
          visible={favoritesOnly || active?.id === controls.provider}
        />
      </View>
      <MenuFooter controls={controls} advanced={advanced} />
    </View>
  );
}

function getMenuModelCount(active: ProviderSelectorProvider | undefined): number | null {
  if (!active || active.modelSelection.kind !== "models") return null;
  return active.modelSelection.rows.length;
}

const styles = StyleSheet.create((theme) => ({
  menu: { minHeight: 0 },
  columns: (height: number) => ({ flexDirection: "row", height }),
  rail: {
    width: 38,
    flexGrow: 0,
    flexShrink: 0,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  railContent: { padding: 4, gap: 4 },
  railButton: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  models: { flex: 1, minWidth: 0 },
  search: {
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: 30,
    padding: 0,
    fontSize: theme.fontSize.base * 0.875,
    color: theme.colors.foreground,
    outlineWidth: 0,
  },
  list: { flex: 1, minHeight: 0 },
  listContent: { padding: 4, gap: 1 },
  row: {
    minHeight: 28,
    paddingVertical: 3,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: theme.borderRadius.md,
  },
  label: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base * 0.875,
    lineHeight: 18,
  },
  segmentLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  disabled: { opacity: 0.5 },
  active: { backgroundColor: theme.colors.surface2 },
  thinking: { width: 144, borderLeftWidth: 1, borderLeftColor: theme.colors.border },
  thinkingHeader: { height: 36, justifyContent: "center", paddingHorizontal: 10 },
  empty: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base * 0.875, padding: 8 },
  state: { padding: 8, gap: 6, alignItems: "flex-start" },
  footer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 6,
    flexDirection: "row",
    alignItems: "center",
  },
  segment: {
    flexDirection: "row",
    padding: 2,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.md,
  },
  segmentButton: {
    minHeight: 22,
    paddingVertical: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    height: 22,
    borderRadius: theme.borderRadius.sm,
  },
  more: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  tooltip: { maxWidth: 420, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));
