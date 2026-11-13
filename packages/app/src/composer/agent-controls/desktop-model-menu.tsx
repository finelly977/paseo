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
import { Check, RefreshCw, Search, Settings2, Zap } from "lucide-react-native";
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
  type ProviderSelectionModelRow,
} from "@/provider-selection/provider-selection";
import { AgentProfileGlyph, type AgentProfilePickerRow } from "@/agent-profiles";
import { COMPACT_LABEL_DATASET } from "@/styles/compact-label";
import { AgentControlIconGlyph } from "./control";
import { AgentModeControl } from "./mode-control";
import type { DesktopAgentControlsContentProps } from "./index";
import { resolveDesktopModelMenuHeight } from "./layout";

type Controls = DesktopAgentControlsContentProps;
interface ChoiceProps {
  id: string;
  label: string;
  tooltip?: string;
  provider?: string;
  profile?: AgentProfilePickerRow;
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
  profile,
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
          {profile ? (
            <AgentProfileGlyph icon={profile.icon} color={profile.color} size={16} />
          ) : null}
          {!profile && provider ? (
            <ModelProviderGlyph provider={provider} size={iconOnly ? 20 : 16} />
          ) : null}
          {icon ? <AgentControlIconGlyph icon={icon} size={16} /> : null}
          {!iconOnly ? (
            <Text numberOfLines={1} style={styles.label}>
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

function ModelChoice({ row, controls }: { row: ProviderSelectionModelRow; controls: Controls }) {
  const { handleDesktopModelSelect } = controls;
  const select = useCallback(
    (id: string) => handleDesktopModelSelect(row.provider, id),
    [handleDesktopModelSelect, row.provider],
  );
  return (
    <MenuChoice
      id={row.modelId}
      label={row.modelLabel}
      provider={row.provider}
      tooltip={
        row.modelLabel === row.modelId ? row.modelLabel : `${row.modelLabel}\n${row.modelId}`
      }
      selected={row.provider === controls.provider && row.modelId === controls.selectedModelId}
      disabled={controls.modelDisabled}
      onSelect={select}
      testID={`model-row-${row.provider}-${row.modelId}`}
    />
  );
}

function ModelChoices({
  active,
  query,
  controls,
}: {
  active: ProviderSelectorProvider | undefined;
  query: string;
  controls: Controls;
}) {
  const { onRetryModelProvider } = controls;
  const rows = useMemo(
    () =>
      filterAndRankModelRows(
        getAllProviderModelRows(active ? [active] : []),
        query.trim().toLowerCase(),
      ),
    [active, query],
  );
  const retry = useCallback(() => {
    if (active) onRetryModelProvider?.(active.id);
  }, [active, onRetryModelProvider]);
  if (!active) return <Text style={styles.empty}>当前主机没有可选模型</Text>;
  if (active.modelSelection.kind === "loading")
    return (
      <View style={styles.state}>
        <ActivityIndicator size="small" />
        <Text style={styles.muted}>正在读取模型…</Text>
      </View>
    );
  if (active.modelSelection.kind === "error")
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
  if (rows.length === 0) return <Text style={styles.empty}>没有匹配的模型</Text>;
  return (
    <>
      {rows.map((row) => (
        <ModelChoice key={row.favoriteKey} row={row} controls={controls} />
      ))}
    </>
  );
}

function ProfileChoices({
  controls,
  query,
  onEdit,
}: {
  controls: Controls;
  query: string;
  onEdit: (() => void) | undefined;
}) {
  const profiles = controls.agentProfiles?.rows ?? [];
  const apply = controls.onApplyAgentProfile ?? controls.agentProfiles?.applyProfile;
  const matching = profiles.filter((profile) =>
    `${profile.name} ${profile.summary}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      {matching.map((profile) => (
        <MenuChoice
          key={profile.id}
          id={profile.id}
          label={profile.name}
          tooltip={`${profile.name}\n${profile.summary}`}
          profile={profile}
          disabled={controls.disabled || !apply}
          onSelect={apply ?? unavailableProfile}
        />
      ))}
      {matching.length === 0 ? <Text style={styles.empty}>没有匹配的配置档案</Text> : null}
      {onEdit ? (
        <MenuChoice id="edit" label="管理配置档案" icon={Settings2} onSelect={onEdit} />
      ) : null}
    </>
  );
}

function unavailableProfile(): never {
  throw new Error("Profile application is unavailable");
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
            <AgentControlIconGlyph icon={Settings2} size={15} />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" width={250} maxHeight={300} scrollable>
            {advanced}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <View style={styles.spacer} />
      {controls.modeControl ? <AgentModeControl {...controls.modeControl} menuFooter /> : null}
    </View>
  );
}

/** 三个区域共用一个浮层，选择模型后仍可继续调整思考与权限。 */
export function DesktopModelMenuContent({
  controls,
  advanced,
  onEditProfiles,
}: {
  controls: Controls;
  advanced: ReactNode;
  onEditProfiles: (() => void) | undefined;
}) {
  const { height } = useWindowDimensions();
  const [providerId, setProviderId] = useState(controls.provider);
  const [query, setQuery] = useState("");
  const [profilesOpen, setProfilesOpen] = useState(false);
  const providers = controls.providerLocked
    ? controls.modelSelectorProviders.filter((entry) => entry.id === controls.provider)
    : controls.modelSelectorProviders;
  const active = providers.find((entry) => entry.id === providerId) ?? providers[0];
  const selectProvider = useCallback((id: string) => {
    setProviderId(id);
    setProfilesOpen(false);
    setQuery("");
  }, []);
  const showProfiles = useCallback(() => {
    setProfilesOpen(true);
    setQuery("");
  }, []);
  const { onRetryModelProvider } = controls;
  const retryActive = useCallback(() => {
    if (active) onRetryModelProvider?.(active.id);
  }, [active, onRetryModelProvider]);
  const hasProfiles = (controls.agentProfiles?.rows.length ?? 0) > 0 || Boolean(onEditProfiles);
  const modelCount = profilesOpen
    ? (controls.agentProfiles?.rows.length ?? 0) + Number(Boolean(onEditProfiles))
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
          {providers.map((entry) => (
            <MenuChoice
              key={entry.id}
              id={entry.id}
              label={entry.label}
              provider={entry.id}
              iconOnly
              selected={!profilesOpen && entry.id === active?.id}
              disabled={controls.disabled}
              onSelect={selectProvider}
            />
          ))}
          {hasProfiles ? (
            <MenuChoice
              id="profiles"
              label="配置档案"
              icon={Settings2}
              iconOnly
              selected={profilesOpen}
              onSelect={showProfiles}
            />
          ) : null}
        </ScrollView>
        <View style={styles.models}>
          <View style={styles.search}>
            <AgentControlIconGlyph icon={Search} size={16} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder={profilesOpen ? "搜索配置档案" : "搜索模型…"}
              accessibilityLabel={profilesOpen ? "搜索配置档案" : "搜索模型"}
              testID="agent-model-search"
              style={styles.input}
            />
            {!profilesOpen && onRetryModelProvider ? (
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
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          >
            {profilesOpen ? (
              <ProfileChoices controls={controls} query={query} onEdit={onEditProfiles} />
            ) : (
              <ModelChoices active={active} query={query} controls={controls} />
            )}
          </ScrollView>
        </View>
        <ThinkingChoices
          controls={controls}
          visible={active?.id === controls.provider && !profilesOpen}
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
    width: 44,
    flexGrow: 0,
    flexShrink: 0,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  railContent: { padding: 4, gap: 6 },
  railButton: {
    width: 34,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  models: { flex: 1, minWidth: 0 },
  search: {
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: 36,
    padding: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    outlineWidth: 0,
  },
  list: { flex: 1, minHeight: 0 },
  listContent: { padding: 6, gap: 2 },
  row: {
    minHeight: 34,
    paddingVertical: 6,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: theme.borderRadius.md,
  },
  label: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  disabled: { opacity: 0.5 },
  active: { backgroundColor: theme.colors.surface2 },
  thinking: { width: 180, borderLeftWidth: 1, borderLeftColor: theme.colors.border },
  thinkingHeader: { height: 42, justifyContent: "center", paddingHorizontal: 14 },
  empty: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, padding: 12 },
  state: { padding: 12, gap: 8, alignItems: "flex-start" },
  footer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 6,
    flexDirection: "row",
    alignItems: "center",
  },
  segment: {
    flexDirection: "row",
    padding: 2,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
  },
  segmentButton: {
    minHeight: 26,
    paddingVertical: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    height: 26,
    borderRadius: theme.borderRadius.md,
  },
  more: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  spacer: { flex: 1 },
  tooltip: { maxWidth: 420, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
}));
