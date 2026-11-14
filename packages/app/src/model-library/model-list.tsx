import { useCallback, useMemo } from "react";
import {
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type AccessibilityActionEvent,
} from "react-native";
import { GripVertical, Star, Check } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ModelProviderGlyph } from "@/components/model-provider-glyph";
import { AgentControlIconGlyph } from "@/composer/agent-controls/control";
import type { ProviderSelectionModelRow } from "@/provider-selection/provider-selection";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { COMPACT_LABEL_DATASET } from "@/styles/compact-label";
import { orderModelRows, reorderVisibleModels, toggleFavoriteModel } from "./preferences";
import type { ModelLibrary } from "./use-model-library";
import type { Theme } from "@/styles/theme";

const ThemedStar = withUnistyles(Star);
const favoriteColors = (theme: Theme) => ({
  color: theme.colors.foreground,
  fill: theme.colors.foreground,
});
const normalColors = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  fill: "transparent",
});
const modelKey = (row: ProviderSelectionModelRow) => row.favoriteKey;

function FavoriteModelRow({
  info,
  library,
  selected,
  disabled,
  onSelect,
  onMove,
}: {
  info: DraggableRenderItemInfo<ProviderSelectionModelRow>;
  library: ModelLibrary;
  selected: boolean;
  disabled: boolean;
  onSelect: (provider: string, model: string) => void;
  onMove: (key: string, offset: number) => void;
}) {
  const { item: row, dragHandleProps, drag, isActive } = info;
  const compact = useIsCompactFormFactor();
  const touch = isNative || compact;
  const favorite = library.preferences.favorites.includes(row.favoriteKey);
  const state = useMemo(() => ({ selected }), [selected]);
  const favoriteState = useMemo(() => ({ selected: favorite }), [favorite]);
  const select = useCallback(
    () => onSelect(row.provider, row.modelId),
    [onSelect, row.modelId, row.provider],
  );
  const toggle = useCallback(
    () => library.save((current) => toggleFavoriteModel(current, row.favoriteKey)),
    [library, row.favoriteKey],
  );
  const move = useCallback(
    (event: AccessibilityActionEvent) => {
      onMove(row.favoriteKey, event.nativeEvent.actionName === "increment" ? 1 : -1);
    },
    [onMove, row.favoriteKey],
  );
  const startDrag = useCallback(() => {
    if (library.ready && !library.busy) drag();
  }, [drag, library.busy, library.ready]);
  const rowStyle = useMemo(() => [styles.row(touch), isActive && styles.active], [touch, isActive]);
  const selectStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType) => [
      styles.select(touch),
      (hovered || pressed) && styles.active,
    ],
    [touch],
  );
  const editable = library.ready && !library.busy;
  return (
    <View style={rowStyle} testID={`model-library-row-${row.favoriteKey}`}>
      <Tooltip delayDuration={350} enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <Pressable
            style={selectStyle}
            onPress={select}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={row.modelLabel}
            accessibilityState={state}
            testID={`model-row-${row.provider}-${row.modelId}`}
          >
            <ModelProviderGlyph provider={row.provider} size={15} />
            <Text numberOfLines={1} style={styles.label}>
              {row.modelLabel}
            </Text>
            {selected ? <AgentControlIconGlyph icon={Check} size={12} /> : null}
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" maxWidth={420}>
          <Text style={styles.tooltip}>
            {row.modelLabel === row.modelId ? row.modelLabel : `${row.modelLabel}\n${row.modelId}`}
          </Text>
        </TooltipContent>
      </Tooltip>
      <Pressable
        style={styles.action(touch)}
        onPress={toggle}
        disabled={!editable}
        accessibilityRole="button"
        accessibilityLabel={`${favorite ? "取消收藏" : "收藏"} ${row.modelLabel}`}
        accessibilityState={favoriteState}
        testID={`model-favorite-${row.favoriteKey}`}
      >
        <ThemedStar size={13} uniProps={favorite ? favoriteColors : normalColors} />
      </Pressable>
      {isWeb ? (
        // Pressable 会拦截确认键，dnd-kit 需要该事件到达 document 才能完成键盘排序。
        <View
          {...dragHandleProps?.attributes}
          {...(editable ? dragHandleProps?.listeners : undefined)}
          ref={dragHandleProps?.setActivatorNodeRef}
          style={styles.action(touch)}
          accessibilityRole="button"
          accessibilityLabel={`拖动排序 ${row.modelLabel}`}
          aria-disabled={!editable}
          tabIndex={editable ? 0 : -1}
          testID={`model-reorder-${row.favoriteKey}`}
        >
          <AgentControlIconGlyph icon={GripVertical} size={12} />
        </View>
      ) : (
        <Pressable
          style={styles.action(touch)}
          disabled={!editable}
          onLongPress={startDrag}
          delayLongPress={180}
          accessibilityRole="button"
          accessibilityLabel={`拖动排序 ${row.modelLabel}`}
          accessibilityActions={REORDER_ACTIONS}
          onAccessibilityAction={move}
          testID={`model-reorder-${row.favoriteKey}`}
        >
          <AgentControlIconGlyph icon={GripVertical} size={12} />
        </Pressable>
      )}
    </View>
  );
}

const REORDER_ACTIONS = [
  { name: "decrement", label: "上移" },
  { name: "increment", label: "下移" },
];

export function ModelLibraryList({
  rows,
  catalogRows,
  library,
  selectedProvider,
  selectedModel,
  onSelect,
  disabled = false,
  favoritesOnly = false,
}: {
  rows: ProviderSelectionModelRow[];
  catalogRows: ProviderSelectionModelRow[];
  library: ModelLibrary;
  selectedProvider: string;
  selectedModel: string;
  onSelect: (provider: string, model: string) => void;
  disabled?: boolean;
  favoritesOnly?: boolean;
}) {
  const ordered = useMemo(
    () =>
      orderModelRows(rows, library.preferences).filter(
        (row) => !favoritesOnly || library.preferences.favorites.includes(row.favoriteKey),
      ),
    [favoritesOnly, library.preferences, rows],
  );
  const reorder = useCallback(
    (next: ProviderSelectionModelRow[]) =>
      library.save((current) => reorderVisibleModels(current, catalogRows, next)),
    [library, catalogRows],
  );
  const move = useCallback(
    (key: string, offset: number) => {
      const from = ordered.findIndex((row) => row.favoriteKey === key);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= ordered.length) return;
      const next = [...ordered];
      const [entry] = next.splice(from, 1);
      next.splice(to, 0, entry);
      reorder(next);
    },
    [ordered, reorder],
  );
  const render = useCallback(
    (info: DraggableRenderItemInfo<ProviderSelectionModelRow>) => (
      <FavoriteModelRow
        info={info}
        library={library}
        selected={info.item.provider === selectedProvider && info.item.modelId === selectedModel}
        disabled={disabled}
        onSelect={onSelect}
        onMove={move}
      />
    ),
    [disabled, library, move, onSelect, selectedModel, selectedProvider],
  );
  const empty = useMemo(() => {
    let message = "没有匹配的模型";
    if (!library.ready && !library.error) message = "正在读取模型偏好…";
    else if (favoritesOnly) {
      message = "没有匹配的收藏模型";
      if (library.preferences.favorites.length === 0)
        message = "还没有收藏模型，点击模型右侧的星标即可收藏";
    }
    return <Text style={styles.empty}>{message}</Text>;
  }, [favoritesOnly, library.ready, library.error, library.preferences.favorites.length]);
  const retry = useCallback(() => {
    void library.retry();
  }, [library]);
  return (
    <View style={styles.list} dataSet={COMPACT_LABEL_DATASET}>
      {library.error ? (
        <Pressable onPress={retry} accessibilityRole="button">
          <Text style={styles.error}>模型偏好读取失败，点击重试</Text>
        </Pressable>
      ) : null}
      <DraggableList
        data={ordered}
        keyExtractor={modelKey}
        renderItem={render}
        onDragEnd={reorder}
        useDragHandle
        contentContainerStyle={styles.content}
        ListEmptyComponent={empty}
        extraData={library}
        testID="model-library-list"
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: { flex: 1, minHeight: 0 },
  content: { padding: 4 },
  row: (touch: boolean) => ({
    flexDirection: "row",
    alignItems: "center",
    minHeight: touch ? 44 : 30,
    borderRadius: theme.borderRadius.md,
  }),
  select: (touch: boolean) => ({
    flex: 1,
    minWidth: 0,
    minHeight: touch ? 44 : 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 5,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.md,
  }),
  label: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base * 0.875,
    lineHeight: 20,
  },
  tooltip: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  action: (touch: boolean) => ({
    width: touch ? 44 : 22,
    minHeight: touch ? 44 : 28,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  }),
  active: { backgroundColor: theme.colors.surface2 },
  empty: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, padding: 12 },
  error: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm, padding: 8 },
}));
