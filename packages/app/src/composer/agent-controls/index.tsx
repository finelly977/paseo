import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { router } from "expo-router";
import { View, Text, Keyboard, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { Brain, ChevronRight, ListTodo, Settings2, ShieldCheck, Zap } from "lucide-react-native";
import { ModelProviderGlyph } from "@/components/model-browser";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import {
  buildSelectedTriggerLabel,
  resolveSelectedModelLabel,
  buildProviderSelectorProviders,
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { useSessionStore } from "@/stores/session-store";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { resolveProviderDefinition } from "@/utils/provider-definitions";
import { mergeProviderPreferences, useFormPreferences } from "@/hooks/use-form-preferences";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import {
  AgentModeControl,
  useLiveAgentModeControl,
  type AgentModeControlValue,
} from "@/composer/agent-controls/mode-control";
import { type SheetHeader } from "@/components/adaptive-modal-sheet";
import type {
  AgentFeature,
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
} from "@getpaseo/protocol/agent-types";
import type { AgentProviderDefinition } from "@getpaseo/protocol/provider-manifest";
import type { CodexProviderInjection } from "@getpaseo/protocol/messages";
import {
  getFeatureHighlightColor,
  getFeatureTooltip,
  formatThinkingOptionLabel,
  resolveAgentModelSelection,
} from "@/composer/agent-controls/utils";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import { showProviderNoticeToast } from "@/utils/provider-notice-toast";
import { useCommandCenterActions } from "@/command-center/provider";
import { buildModelChoiceContributions } from "@/command-center/model-contributions";
import { getCommandCenterProviderIcon } from "@/command-center/provider-icon";
import { isNative } from "@/constants/platform";
import {
  resolveComposerControlDensity,
  resolveComposerControlPresentation,
  resolveComposerToolbarGlyphSize,
  type ComposerControlDensity,
} from "@/composer/agent-controls/layout";
import { ComposerControlLayoutProvider } from "@/composer/agent-controls/layout-context";
import {
  AgentControlIconGlyph,
  AgentControlTrigger,
  type AgentControlIconTone,
} from "@/composer/agent-controls/control";
import { CompactModelSheet } from "@/composer/agent-controls/model-sheet";
import { FastModeIndicator } from "./fast-mode-indicator";
import {
  useAgentProfilePicker,
  type AgentProfileApplyTarget,
  type AgentProfilePicker,
} from "@/agent-profiles";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { CodexProviderInjectionControl } from "@/composer/agent-controls/codex-provider-injection-control";

interface AgentControlOption {
  id: string;
  label: string;
}

type AgentControlSelector = "provider" | "mode" | "model" | "thinking" | `feature-${string}`;

interface ControlledAgentControlsProps {
  providerLocked: boolean;
  provider: string;
  providerOptions?: AgentControlOption[];
  selectedProviderId?: string;
  onSelectProvider?: (providerId: string) => void;
  modelOptions?: AgentControlOption[];
  selectedModelId?: string;
  onSelectModel?: (modelId: string) => void;
  onSelectProviderAndModel?: (provider: string, modelId: string) => void;
  thinkingOptions?: AgentControlOption[];
  selectedThinkingOptionId?: string;
  onSelectThinkingOption?: (thinkingOptionId: string) => void;
  disabled?: boolean;
  isModelLoading?: boolean;
  modelSelectorProviders?: ProviderSelectorProvider[];
  agentProfiles?: AgentProfilePicker | null;
  onApplyAgentProfile?: (profileId: string) => void;
  onEditAgentProfiles?: () => void;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider?: boolean;
  modeControl?: AgentModeControlValue | null;
  modelSelectorServerId?: string | null;
  isCompactLayout?: boolean;
  codexProviderInjections?: readonly CodexProviderInjection[];
  selectedCodexProviderInjectionId?: string | null;
  onSelectCodexProviderInjection?: (injectionId: string, model?: string) => void;
}

export interface DraftAgentControlsProps {
  providerDefinitions: AgentProviderDefinition[];
  selectedProvider: AgentProvider | null;
  onSelectProvider: (provider: AgentProvider) => void;
  modeOptions: AgentMode[];
  selectedMode: string;
  onSelectMode: (modeId: string) => void;
  models: AgentModelDefinition[];
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  isModelLoading: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  isAllModelsLoading: boolean;
  onSelectProviderAndModel: (provider: AgentProvider, modelId: string) => void;
  thinkingOptions: NonNullable<AgentModelDefinition["thinkingOptions"]>;
  selectedThinkingOptionId: string;
  onSelectThinkingOption: (thinkingOptionId: string) => void;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider?: boolean;
  disabled?: boolean;
  modelSelectorServerId?: string | null;
  isCompactLayout?: boolean;
  codexProviderInjections?: readonly CodexProviderInjection[];
  selectedCodexProviderInjectionId?: string | null;
  onSelectCodexProviderInjection?: (injectionId: string, model?: string) => void;
}

interface AgentControlsProps {
  agentId: string;
  serverId: string;
  isPaneFocused: boolean;
  onDropdownClose?: () => void;
  isCompactLayout?: boolean;
}

function findOptionLabel(
  options: AgentControlOption[] | undefined,
  selectedId: string | undefined,
  fallback: string,
) {
  if (!options || options.length === 0) {
    return fallback;
  }
  const selected = options.find((option) => option.id === selectedId);
  return selected?.label ?? fallback;
}

const FEATURE_ICONS: Record<string, typeof Zap> = {
  "list-todo": ListTodo,
  "shield-check": ShieldCheck,
  zap: Zap,
};

function getFeatureIcon(icon?: string) {
  return (icon && FEATURE_ICONS[icon]) || Settings2;
}

function getFeatureIconTone(featureId: string, enabled: boolean): AgentControlIconTone {
  if (!enabled) {
    return "muted";
  }

  const highlight = getFeatureHighlightColor(featureId);
  return highlight === "default" ? "muted" : highlight;
}

type ActiveSheet = "thinking" | "features" | null;

function resolveHasAnyControl({
  providerOptions,
  canSelectModel,
  thinkingOptions,
  features,
  hasMode,
}: {
  providerOptions: AgentControlOption[] | undefined;
  canSelectModel: boolean;
  thinkingOptions: AgentControlOption[] | undefined;
  features: AgentFeature[] | undefined;
  hasMode: boolean;
}) {
  return (
    Boolean(providerOptions?.length) ||
    canSelectModel ||
    Boolean(thinkingOptions?.length) ||
    Boolean(features?.length) ||
    hasMode
  );
}

function toComboboxOptions(options: AgentControlOption[] | undefined): ComboboxOption[] {
  return (options ?? []).map((o) => ({ id: o.id, label: o.label }));
}

function toThinkingControlOptions(options: AgentControlOption[] | undefined): AgentControlOption[] {
  return (options ?? []).map((option) => ({
    id: option.id,
    label: formatThinkingOptionLabel(option),
  }));
}

/**
 * The picker's edit shortcut. Agent profiles are host config, so it lands on the
 * host settings section that owns the list.
 */
function useEditAgentProfilesNavigation(
  serverId: string | null,
  isSupported: boolean,
): (() => void) | undefined {
  const handleEdit = useCallback(() => {
    if (!serverId) return;
    router.push(buildSettingsHostSectionRoute(serverId, "agents"));
  }, [serverId]);
  return serverId && isSupported ? handleEdit : undefined;
}

function buildFallbackModelSelectorProviders(
  provider: string,
  modelOptions: AgentControlOption[] | undefined,
): ProviderSelectorProvider[] {
  if (!modelOptions || modelOptions.length === 0) {
    return [];
  }
  return [
    {
      id: provider,
      label: provider,
      modelSelection: {
        kind: "models",
        rows: modelOptions.map((option) => ({
          favoriteKey: `${provider}:${option.id}`,
          provider,
          providerLabel: provider,
          modelId: option.id,
          modelLabel: option.label,
        })),
      },
    },
  ];
}

function pickSheetModel({
  nextProviderId,
  modelId,
  currentProvider,
  onSelectProviderAndModel,
  onSelectProvider,
  onSelectModel,
}: {
  nextProviderId: string;
  modelId: string;
  currentProvider: string;
  onSelectProviderAndModel?: (provider: string, modelId: string) => void;
  onSelectProvider?: (providerId: string) => void;
  onSelectModel?: (modelId: string) => void;
}) {
  if (onSelectProviderAndModel) {
    onSelectProviderAndModel(nextProviderId, modelId);
    return;
  }
  if (nextProviderId !== currentProvider) {
    onSelectProvider?.(nextProviderId);
  }
  onSelectModel?.(modelId);
}

function pickDesktopModel({
  nextProviderId,
  modelId,
  currentProvider,
  onSelectModel,
  onSelectProviderAndModel,
}: {
  nextProviderId: string;
  modelId: string;
  currentProvider: string;
  onSelectModel?: (modelId: string) => void;
  onSelectProviderAndModel?: (provider: string, modelId: string) => void;
}) {
  if (onSelectProviderAndModel) {
    onSelectProviderAndModel(nextProviderId, modelId);
    return;
  }
  if (nextProviderId === currentProvider) {
    onSelectModel?.(modelId);
  }
}

type AgentControlsSlice = {
  provider: string;
  cwd: string | null;
  runtimeModelId: string | null;
  model: string | null | undefined;
  features: AgentFeature[] | undefined;
  thinkingOptionId: string | null | undefined;
  lastUsage: unknown;
} | null;

function selectAgentControlsSlice(
  state: ReturnType<typeof useSessionStore.getState>,
  serverId: string,
  agentId: string,
): AgentControlsSlice {
  const currentAgent = state.sessions[serverId]?.agents?.get(agentId) ?? null;
  if (!currentAgent) {
    return null;
  }
  return {
    provider: currentAgent.provider,
    cwd: currentAgent.cwd,
    runtimeModelId: currentAgent.runtimeInfo?.model ?? null,
    model: currentAgent.model,
    features: currentAgent.features,
    thinkingOptionId: currentAgent.thinkingOptionId,
    lastUsage: currentAgent.lastUsage,
  };
}

function resolveSnapshotSelectedEntry(
  snapshotEntries: ReturnType<typeof useProvidersSnapshot>["entries"],
  agentProvider: string | undefined,
) {
  if (!snapshotEntries || !agentProvider) {
    return null;
  }
  return snapshotEntries.find((e) => e.provider === agentProvider) ?? null;
}

function buildAgentProviderDefinitions(
  agentProvider: string | undefined,
  snapshotEntries: ReturnType<typeof useProvidersSnapshot>["entries"],
): AgentProviderDefinition[] {
  const definition = agentProvider
    ? resolveProviderDefinition(agentProvider, snapshotEntries)
    : undefined;
  return definition ? [definition] : [];
}

function buildAgentProviderModels(
  agentProvider: string | undefined,
  models: AgentModelDefinition[] | null,
): Map<string, AgentModelDefinition[]> {
  const map = new Map<string, AgentModelDefinition[]>();
  if (agentProvider && models) {
    map.set(agentProvider, models);
  }
  return map;
}

function supportsCodexProviderInjectionControl(input: {
  provider: string;
  injections?: readonly CodexProviderInjection[];
  onSelect?: (injectionId: string, model?: string) => void;
}): boolean {
  if (input.provider !== "codex") return false;
  if (!input.injections || input.injections.length === 0) return false;
  return input.onSelect !== undefined;
}

function ControlledAgentControls({
  providerLocked,
  provider,
  providerOptions,
  selectedProviderId,
  onSelectProvider,
  modelOptions,
  selectedModelId,
  onSelectModel,
  onSelectProviderAndModel,
  thinkingOptions,
  selectedThinkingOptionId,
  onSelectThinkingOption,
  disabled = false,
  isModelLoading = false,
  modelSelectorProviders,
  agentProfiles = null,
  onApplyAgentProfile,
  onEditAgentProfiles,
  features,
  onSetFeature,
  onDropdownClose,
  onModelSelectorOpen,
  onRetryModelProvider,
  isRetryingModelProvider = false,
  modeControl,
  modelSelectorServerId = null,
  isCompactLayout,
  codexProviderInjections,
  selectedCodexProviderInjectionId = null,
  onSelectCodexProviderInjection,
}: ControlledAgentControlsProps) {
  const { t } = useTranslation();
  const isCompactFormFactor = useIsCompactFormFactor();
  const isCompact = isCompactLayout ?? isCompactFormFactor;
  const { fontScale } = useWindowDimensions();
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [openSelector, setOpenSelector] = useState<AgentControlSelector | null>(null);
  const initialDensity: ComposerControlDensity = isCompact ? "tight" : "full";
  const [density, setDensity] = useState<ComposerControlDensity>(initialDensity);
  const densityRef = useRef<ComposerControlDensity>(initialDensity);
  const availableWidthRef = useRef(0);

  const canSelectProvider = Boolean(
    onSelectProvider && providerOptions && providerOptions.length > 0,
  );
  const canSelectModel = Boolean(onSelectModel);
  const canSelectThinking = Boolean(
    onSelectThinkingOption && thinkingOptions && thinkingOptions.length > 0,
  );
  const canSelectCodexProviderInjection = supportsCodexProviderInjectionControl({
    provider,
    injections: codexProviderInjections,
    onSelect: onSelectCodexProviderInjection,
  });

  const displayProvider = findOptionLabel(
    providerOptions,
    selectedProviderId,
    t("agentControls.provider.fallback"),
  );
  const formattedThinkingOptions = useMemo(
    () => toThinkingControlOptions(thinkingOptions),
    [thinkingOptions],
  );
  const displayThinking = findOptionLabel(
    formattedThinkingOptions,
    selectedThinkingOptionId,
    formattedThinkingOptions[0]?.label ?? t("agentControls.thinking.unknown"),
  );

  const hasAnyControl = resolveHasAnyControl({
    providerOptions,
    canSelectModel,
    thinkingOptions,
    features,
    hasMode: modeControl !== null && modeControl !== undefined,
  });
  const featureControls = useMemo(
    () =>
      (features ?? []).map((feature) => {
        if (feature.type === "toggle") return { type: "toggle" as const };
        const selectedOption = feature.options.find((option) => option.id === feature.value);
        return {
          type: "select" as const,
          label: selectedOption?.label ?? feature.label,
        };
      }),
    [features],
  );
  const controlPresence = useMemo(
    () => ({
      hasModel: canSelectModel,
      hasThinking: canSelectThinking,
      hasMode: modeControl !== null && modeControl !== undefined,
      hasInjection: canSelectCodexProviderInjection,
      features: featureControls,
      fontScale,
    }),
    [
      canSelectCodexProviderInjection,
      canSelectModel,
      canSelectThinking,
      featureControls,
      fontScale,
      modeControl,
    ],
  );
  const presentation = useMemo(() => resolveComposerControlPresentation(density), [density]);
  const layoutContextValue = useMemo(
    () => ({
      glyphSize: resolveComposerToolbarGlyphSize(isNative ? "native" : "web"),
      presentation,
    }),
    [presentation],
  );

  const updateDensityForWidth = useCallback(
    (availableWidth: number) => {
      const nextDensity = resolveComposerControlDensity({
        availableWidth,
        currentDensity: densityRef.current,
        controls: controlPresence,
      });
      if (nextDensity === densityRef.current) return;
      densityRef.current = nextDensity;
      setDensity(nextDensity);
    },
    [controlPresence],
  );

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const availableWidth = event.nativeEvent.layout.width;
      availableWidthRef.current = availableWidth;
      updateDensityForWidth(availableWidth);
    },
    [updateDensityForWidth],
  );

  useEffect(() => {
    if (availableWidthRef.current > 0) {
      updateDensityForWidth(availableWidthRef.current);
    }
  }, [updateDensityForWidth]);

  const modelDisabled = disabled;

  const fallbackModelSelectorProviders = useMemo(
    () => buildFallbackModelSelectorProviders(provider, modelOptions),
    [modelOptions, provider],
  );
  const effectiveModelSelectorProviders = modelSelectorProviders ?? fallbackModelSelectorProviders;
  const comboboxThinkingOptions = useMemo<ComboboxOption[]>(
    () => toComboboxOptions(formattedThinkingOptions),
    [formattedThinkingOptions],
  );

  const renderThinkingOption = useCallback(
    (args: { option: ComboboxOption; selected: boolean; active: boolean; onPress: () => void }) => (
      <ThinkingComboboxOption
        option={args.option}
        selected={args.selected}
        active={args.active}
        onPress={args.onPress}
      />
    ),
    [],
  );

  const handleSheetOpenChange = useCallback(
    (selector: AgentControlSelector) => (nextOpen: boolean) => {
      setOpenSelector(nextOpen ? selector : null);
    },
    [],
  );

  const handleProviderSelect = useCallback(
    (id: string) => onSelectProvider?.(id),
    [onSelectProvider],
  );
  const handleThinkingSelect = useCallback(
    (id: string) => onSelectThinkingOption?.(id),
    [onSelectThinkingOption],
  );

  const handleDesktopModelSelect = useCallback(
    (nextProviderId: string, modelId: string) => {
      pickDesktopModel({
        nextProviderId,
        modelId,
        currentProvider: provider,
        onSelectModel,
        onSelectProviderAndModel,
      });
    },
    [onSelectModel, onSelectProviderAndModel, provider],
  );

  const handleOpenSheet = useCallback((sheet: Exclude<ActiveSheet, null>) => {
    Keyboard.dismiss();
    setActiveSheet(sheet);
  }, []);

  const handleCloseSheet = useCallback(() => {
    setActiveSheet(null);
    if (!isCompact) onDropdownClose?.();
  }, [isCompact, onDropdownClose]);

  const handleSelectThinkingAndClose = useCallback(
    (thinkingOptionId: string) => {
      onSelectThinkingOption?.(thinkingOptionId);
      setActiveSheet(null);
    },
    [onSelectThinkingOption],
  );

  const handleSheetModelSelect = useCallback(
    (nextProviderId: string, modelId: string) => {
      pickSheetModel({
        nextProviderId,
        modelId,
        currentProvider: provider,
        onSelectProviderAndModel,
        onSelectProvider,
        onSelectModel,
      });
    },
    [onSelectModel, onSelectProvider, onSelectProviderAndModel, provider],
  );

  if (!hasAnyControl) {
    return null;
  }

  return (
    <ComposerControlLayoutProvider value={layoutContextValue}>
      <View style={styles.container} onLayout={isCompact ? handleLayout : undefined}>
        {!isCompact ? (
          <DesktopAgentControlsContent
            providerLocked={providerLocked}
            provider={provider}
            providerOptions={providerOptions}
            selectedProviderId={selectedProviderId}
            selectedModelId={selectedModelId}
            thinkingOptions={formattedThinkingOptions}
            selectedThinkingOptionId={selectedThinkingOptionId}
            features={features}
            onSetFeature={onSetFeature}
            onApplyAgentProfile={onApplyAgentProfile}
            onEditAgentProfiles={onEditAgentProfiles}
            onDropdownClose={onDropdownClose}
            onModelSelectorOpen={onModelSelectorOpen}
            onRetryModelProvider={onRetryModelProvider}
            isRetryingModelProvider={isRetryingModelProvider}
            agentProfiles={agentProfiles}
            disabled={disabled}
            isModelLoading={isModelLoading}
            canSelectProvider={canSelectProvider}
            canSelectModel={canSelectModel}
            canSelectThinking={canSelectThinking}
            modelSelectorProviders={effectiveModelSelectorProviders}
            modelDisabled={modelDisabled}
            displayProvider={displayProvider}
            displayThinking={displayThinking}
            handleProviderSelect={handleProviderSelect}
            handleThinkingSelect={handleThinkingSelect}
            handleDesktopModelSelect={handleDesktopModelSelect}
            modeControl={modeControl}
            glyphSize={layoutContextValue.glyphSize}
            modelSelectorServerId={modelSelectorServerId}
            codexProviderInjections={codexProviderInjections}
            selectedCodexProviderInjectionId={selectedCodexProviderInjectionId}
            onSelectCodexProviderInjection={onSelectCodexProviderInjection}
            canSelectCodexProviderInjection={canSelectCodexProviderInjection}
          />
        ) : (
          <SheetAgentControlsContent
            providerLocked={providerLocked}
            provider={provider}
            selectedModelId={selectedModelId}
            selectedThinkingOptionId={selectedThinkingOptionId}
            features={features}
            onSetFeature={onSetFeature}
            onApplyAgentProfile={onApplyAgentProfile}
            onEditAgentProfiles={onEditAgentProfiles}
            onDropdownClose={onDropdownClose}
            onModelSelectorOpen={onModelSelectorOpen}
            onRetryModelProvider={onRetryModelProvider}
            isRetryingModelProvider={isRetryingModelProvider}
            agentProfiles={agentProfiles}
            disabled={disabled}
            isModelLoading={isModelLoading}
            canSelectModel={canSelectModel}
            canSelectThinking={canSelectThinking}
            modelSelectorProviders={effectiveModelSelectorProviders}
            modelDisabled={modelDisabled}
            comboboxThinkingOptions={comboboxThinkingOptions}
            openSelector={openSelector}
            displayThinking={displayThinking}
            activeSheet={activeSheet}
            handleOpenSheet={handleOpenSheet}
            handleCloseSheet={handleCloseSheet}
            handleSheetModelSelect={handleSheetModelSelect}
            handleSelectThinkingAndClose={handleSelectThinkingAndClose}
            handleOpenChange={handleSheetOpenChange}
            renderThinkingOption={renderThinkingOption}
            modeControl={modeControl}
            glyphSize={layoutContextValue.glyphSize}
            modelSelectorServerId={modelSelectorServerId}
            codexProviderInjections={codexProviderInjections}
            selectedCodexProviderInjectionId={selectedCodexProviderInjectionId}
            onSelectCodexProviderInjection={onSelectCodexProviderInjection}
            canSelectCodexProviderInjection={canSelectCodexProviderInjection}
          />
        )}
      </View>
    </ComposerControlLayoutProvider>
  );
}

interface DesktopAgentControlsContentProps {
  providerLocked: boolean;
  provider: string;
  providerOptions?: AgentControlOption[];
  selectedProviderId?: string;
  selectedModelId?: string;
  thinkingOptions?: AgentControlOption[];
  selectedThinkingOptionId?: string;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onApplyAgentProfile?: (profileId: string) => void;
  onEditAgentProfiles?: () => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider: boolean;
  agentProfiles: AgentProfilePicker | null;
  disabled: boolean;
  isModelLoading: boolean;
  canSelectProvider: boolean;
  canSelectModel: boolean;
  canSelectThinking: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  modelDisabled: boolean;
  displayProvider: string;
  displayThinking: string;
  handleProviderSelect: (id: string) => void;
  handleThinkingSelect: (id: string) => void;
  handleDesktopModelSelect: (providerId: string, modelId: string) => void;
  modeControl?: AgentModeControlValue | null;
  glyphSize: number;
  modelSelectorServerId: string | null;
  codexProviderInjections?: readonly CodexProviderInjection[];
  selectedCodexProviderInjectionId: string | null;
  onSelectCodexProviderInjection?: (injectionId: string, model?: string) => void;
  canSelectCodexProviderInjection: boolean;
}

function DesktopAgentControlsContent(props: DesktopAgentControlsContentProps) {
  const { t } = useTranslation();
  const {
    onDropdownClose,
    disabled,
    displayProvider,
    provider,
    handleDesktopModelSelect,
    onApplyAgentProfile,
    onEditAgentProfiles,
  } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const modelLabel = resolveSelectedModelLabel({
    providers: props.modelSelectorProviders,
    selectedProvider: props.provider,
    selectedModel: props.selectedModelId ?? "",
    isLoading: props.isModelLoading,
  });
  const label = buildSelectedTriggerLabel(modelLabel);
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    onDropdownClose?.();
  }, [onDropdownClose]);
  const handleModelSelect = useCallback(
    (providerId: string, modelId: string) => {
      handleDesktopModelSelect(providerId, modelId);
      closeMenu();
    },
    [handleDesktopModelSelect, closeMenu],
  );
  const handleApplyProfile = useCallback(
    (profileId: string) => {
      onApplyAgentProfile?.(profileId);
      closeMenu();
    },
    [onApplyAgentProfile, closeMenu],
  );
  const handleEditProfiles = useCallback(() => {
    closeMenu();
    onEditAgentProfiles?.();
  }, [closeMenu, onEditAgentProfiles]);
  const editProfilesAction = useMemo(
    () => (onEditAgentProfiles ? handleEditProfiles : undefined),
    [onEditAgentProfiles, handleEditProfiles],
  );
  const handleMenuOpenChange = useCallback(
    (open: boolean) => {
      setMenuOpen(open);
      if (!open) onDropdownClose?.();
    },
    [onDropdownClose],
  );
  const chipStyle = useCallback(
    ({ hovered, pressed, open }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      styles.roleChip,
      (hovered || pressed || open) && styles.roleChipActive,
      disabled && styles.disabledBadge,
    ],
    [disabled],
  );
  const providerValue = useMemo(
    () => (
      <Text style={styles.roleMenuValue}>
        {displayProvider === t("agentControls.provider.fallback") ? provider : displayProvider}
      </Text>
    ),
    [displayProvider, provider, t],
  );
  const renderModelRow = useCallback(
    ({
      selectedModelLabel,
      hovered,
      pressed,
      isOpen,
    }: {
      selectedModelLabel: string;
      hovered: boolean;
      pressed: boolean;
      isOpen: boolean;
    }) => (
      <View
        style={[styles.roleMenuRow, (hovered || pressed || isOpen) && styles.roleMenuRowActive]}
      >
        <Text numberOfLines={1} style={styles.roleMenuLabel}>
          {t("agentControls.model.title")}
        </Text>
        <Text numberOfLines={1} style={styles.roleMenuValue}>
          {selectedModelLabel}
        </Text>
        <AgentControlIconGlyph icon={ChevronRight} size={16} />
      </View>
    ),
    [t],
  );

  return (
    <>
      <DropdownMenu compact open={menuOpen} onOpenChange={handleMenuOpenChange}>
        <DropdownMenuTrigger
          disabled={props.disabled}
          accessibilityRole="button"
          accessibilityLabel={`${t("agentControls.model.title")}：${label}${props.canSelectThinking ? ` · ${props.displayThinking}` : ""}`}
          testID="agent-role-selector"
          style={chipStyle}
        >
          <ModelProviderGlyph provider={props.provider} size={props.glyphSize} />
          <FastModeIndicator features={props.features} />
          <Text numberOfLines={1} style={styles.roleChipText}>
            {label}
          </Text>
          {props.canSelectThinking ? (
            <Text
              numberOfLines={1}
              style={styles.roleThinkingText}
            >{`· ${props.displayThinking}`}</Text>
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          width={240}
          maxHeight={420}
          scrollable
          testID="agent-role-menu"
        >
          {props.providerOptions && props.providerOptions.length > 0 ? (
            <DropdownMenuSub openOnHover={!props.disabled}>
              <DropdownMenuSubTrigger
                disabled={props.disabled || !props.canSelectProvider}
                testID="agent-provider-selector"
              >
                {findOptionLabel(props.providerOptions, props.selectedProviderId, "Agent")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {props.providerOptions.map((option) => (
                  <RoleMenuOption
                    key={option.id}
                    option={option}
                    selected={option.id === props.selectedProviderId}
                    onSelect={props.handleProviderSelect}
                  />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <DropdownMenuItem disabled trailing={providerValue}>
              Agent
            </DropdownMenuItem>
          )}
          {props.canSelectModel ? (
            <CombinedModelSelector
              providerLocked={props.providerLocked}
              providers={props.modelSelectorProviders}
              selectedProvider={props.provider}
              selectedModel={props.selectedModelId ?? ""}
              onSelect={handleModelSelect}
              profiles={props.agentProfiles}
              onApplyProfile={props.onApplyAgentProfile ? handleApplyProfile : undefined}
              onEditProfiles={editProfilesAction}
              isLoading={props.isModelLoading}
              disabled={props.modelDisabled}
              onOpen={props.onModelSelectorOpen}
              onRetryProvider={props.onRetryModelProvider}
              isRetryingProvider={props.isRetryingModelProvider}
              serverId={props.modelSelectorServerId}
              desktopPlacement="right-start"
              desktopMinWidth={300}
              openOnHover
              compactMenu
              triggerFill
              renderTrigger={renderModelRow}
            />
          ) : null}
          {props.canSelectThinking && props.thinkingOptions ? (
            <DropdownMenuSub openOnHover={!props.disabled}>
              <DropdownMenuSubTrigger disabled={props.disabled} testID="agent-thinking-selector">
                {t("agentControls.role.thinking")} · {props.displayThinking}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent width={200} testID="agent-thinking-menu">
                {props.thinkingOptions.map((option) => (
                  <RoleMenuOption
                    key={option.id}
                    option={option}
                    selected={option.id === props.selectedThinkingOptionId}
                    onSelect={props.handleThinkingSelect}
                  />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          {props.canSelectCodexProviderInjection &&
          props.codexProviderInjections &&
          props.onSelectCodexProviderInjection ? (
            <CodexProviderInjectionControl
              injections={props.codexProviderInjections}
              selectedInjectionId={props.selectedCodexProviderInjectionId}
              selectedModelId={props.selectedModelId ?? ""}
              onSelect={props.onSelectCodexProviderInjection}
              onClose={closeMenu}
              disabled={props.disabled}
              surface="sheet"
            />
          ) : null}
          {props.features && props.features.length > 0 ? <DropdownMenuSeparator /> : null}
          {props.features?.map((feature) => (
            <RoleMenuFeature
              key={feature.id}
              feature={feature}
              disabled={props.disabled}
              onSetFeature={props.onSetFeature}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {props.modeControl ? (
        <AgentModeControl {...props.modeControl} iconOnly onClose={props.onDropdownClose} />
      ) : null}
    </>
  );
}

interface SheetAgentControlsContentProps {
  providerLocked: boolean;
  provider: string;
  selectedModelId?: string;
  selectedThinkingOptionId?: string;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onApplyAgentProfile?: (profileId: string) => void;
  onEditAgentProfiles?: () => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider: boolean;
  agentProfiles: AgentProfilePicker | null;
  disabled: boolean;
  isModelLoading: boolean;
  canSelectModel: boolean;
  canSelectThinking: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  modelDisabled: boolean;
  comboboxThinkingOptions: ComboboxOption[];
  openSelector: AgentControlSelector | null;
  displayThinking: string;
  activeSheet: ActiveSheet;
  handleOpenSheet: (sheet: Exclude<ActiveSheet, null>) => void;
  handleCloseSheet: () => void;
  handleSheetModelSelect: (providerId: string, modelId: string) => void;
  handleSelectThinkingAndClose: (thinkingOptionId: string) => void;
  handleOpenChange: (selector: AgentControlSelector) => (nextOpen: boolean) => void;
  renderThinkingOption: (args: {
    option: ComboboxOption;
    selected: boolean;
    active: boolean;
    onPress: () => void;
  }) => ReactElement;
  modeControl?: AgentModeControlValue | null;
  glyphSize: number;
  modelSelectorServerId: string | null;
  codexProviderInjections?: readonly CodexProviderInjection[];
  selectedCodexProviderInjectionId: string | null;
  onSelectCodexProviderInjection?: (injectionId: string, model?: string) => void;
  canSelectCodexProviderInjection: boolean;
}

function SheetAgentControlsContent(props: SheetAgentControlsContentProps) {
  const { t } = useTranslation();
  const {
    providerLocked,
    provider,
    selectedModelId,
    selectedThinkingOptionId,
    features,
    onSetFeature,
    onApplyAgentProfile,
    onEditAgentProfiles,
    onDropdownClose,
    onModelSelectorOpen,
    onRetryModelProvider,
    isRetryingModelProvider,
    agentProfiles,
    disabled,
    isModelLoading,
    canSelectModel,
    canSelectThinking,
    modelSelectorProviders,
    modelDisabled,
    comboboxThinkingOptions,
    openSelector,
    displayThinking,
    activeSheet,
    handleOpenSheet,
    handleCloseSheet,
    handleSheetModelSelect,
    handleSelectThinkingAndClose,
    handleOpenChange,
    renderThinkingOption,
    modeControl,
    glyphSize,
    modelSelectorServerId,
    codexProviderInjections,
    selectedCodexProviderInjectionId,
    onSelectCodexProviderInjection,
    canSelectCodexProviderInjection,
  } = props;

  const thinkingAnchorRef = useRef<View | null>(null);

  const hasThinking = comboboxThinkingOptions.length > 0;

  const handleOpenThinking = useCallback(() => handleOpenSheet("thinking"), [handleOpenSheet]);
  const handleThinkingSheetOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        handleOpenSheet("thinking");
      } else {
        handleCloseSheet();
      }
    },
    [handleCloseSheet, handleOpenSheet],
  );

  const sheetControls = (
    <View style={styles.combinedSheetControls} testID="agent-controls-combined-sheet-controls">
      {hasThinking ? (
        <>
          <AgentControlTrigger
            ref={thinkingAnchorRef}
            icon={Brain}
            surface="sheet"
            label={t("agentControls.thinking.title")}
            value={displayThinking}
            open={activeSheet === "thinking"}
            onPress={handleOpenThinking}
            disabled={disabled || !canSelectThinking}
            accessibilityLabel={t("agentControls.thinking.selectWithValue", {
              value: displayThinking,
            })}
            testID="agent-controls-thinking"
          />
          <Combobox
            options={comboboxThinkingOptions}
            value={selectedThinkingOptionId ?? ""}
            onSelect={handleSelectThinkingAndClose}
            searchable={false}
            title={t("agentControls.thinking.title")}
            open={activeSheet === "thinking"}
            onOpenChange={handleThinkingSheetOpenChange}
            anchorRef={thinkingAnchorRef}
            renderOption={renderThinkingOption}
            presentation="push"
          />
        </>
      ) : null}

      {modeControl ? <AgentModeControl {...modeControl} surface="sheet" /> : null}

      {canSelectCodexProviderInjection &&
      codexProviderInjections &&
      onSelectCodexProviderInjection ? (
        <CodexProviderInjectionControl
          injections={codexProviderInjections}
          selectedInjectionId={selectedCodexProviderInjectionId}
          selectedModelId={selectedModelId ?? ""}
          onSelect={onSelectCodexProviderInjection}
          onClose={onDropdownClose}
          disabled={disabled}
          surface="sheet"
        />
      ) : null}

      {(features ?? []).map((feature) => (
        <SheetFeatureItem
          key={`feature-${feature.id}`}
          feature={feature}
          disabled={disabled}
          openSelector={openSelector}
          handleOpenChange={handleOpenChange}
          onSetFeature={onSetFeature}
        />
      ))}
    </View>
  );

  return canSelectModel ? (
    <CompactModelSheet
      features={features}
      providerLocked={providerLocked}
      providers={modelSelectorProviders}
      selectedProvider={provider}
      selectedModel={selectedModelId ?? ""}
      onSelect={handleSheetModelSelect}
      profiles={agentProfiles}
      onApplyProfile={onApplyAgentProfile}
      onEditProfiles={onEditAgentProfiles}
      isLoading={isModelLoading}
      disabled={modelDisabled}
      onOpen={onModelSelectorOpen}
      onClose={onDropdownClose}
      onRetryProvider={onRetryModelProvider}
      isRetryingProvider={isRetryingModelProvider}
      serverId={modelSelectorServerId}
      glyphSize={glyphSize}
    >
      {sheetControls}
    </CompactModelSheet>
  ) : null;
}

function RoleMenuOption({
  option,
  selected,
  onSelect,
}: {
  option: AgentControlOption;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const handleSelect = useCallback(() => onSelect(option.id), [onSelect, option.id]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {option.label}
    </DropdownMenuItem>
  );
}

function RoleMenuFeature({
  feature,
  disabled,
  onSetFeature,
}: {
  feature: AgentFeature;
  disabled: boolean;
  onSetFeature?: (featureId: string, value: unknown) => void;
}) {
  const handleToggle = useCallback(() => {
    if (feature.type === "toggle") onSetFeature?.(feature.id, !feature.value);
  }, [feature, onSetFeature]);
  const handleSelect = useCallback(
    (id: string) => onSetFeature?.(feature.id, id),
    [feature.id, onSetFeature],
  );
  const leading = useMemo(
    () => <AgentControlIconGlyph icon={getFeatureIcon(feature.icon)} size={16} />,
    [feature.icon],
  );
  const trailing = useMemo(
    () => (
      <View
        pointerEvents="none"
        aria-hidden
        style={[styles.roleSwitch, Boolean(feature.value) && styles.roleSwitchOn]}
      >
        <View
          style={[styles.roleSwitchThumb, Boolean(feature.value) && styles.roleSwitchThumbOn]}
        />
      </View>
    ),
    [feature.value],
  );
  if (feature.type === "toggle")
    return (
      <DropdownMenuItem
        disabled={disabled || !onSetFeature}
        closeOnSelect={false}
        leading={leading}
        trailing={trailing}
        onSelect={handleToggle}
        tooltip={getFeatureTooltip(feature)}
        testID={`agent-feature-${feature.id}`}
      >
        {feature.label}
      </DropdownMenuItem>
    );
  return (
    <DropdownMenuSub openOnHover={!disabled}>
      <DropdownMenuSubTrigger
        disabled={disabled || !onSetFeature}
        testID={`agent-feature-${feature.id}`}
      >
        {feature.label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {feature.options.map((option) => (
          <RoleMenuOption
            key={option.id}
            option={option}
            selected={option.id === feature.value}
            onSelect={handleSelect}
          />
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function SheetFeatureItem({
  feature,
  disabled,
  openSelector,
  handleOpenChange,
  onSetFeature,
}: {
  feature: AgentFeature;
  disabled: boolean;
  openSelector: AgentControlSelector | null;
  handleOpenChange: (selector: AgentControlSelector) => (nextOpen: boolean) => void;
  onSetFeature?: (featureId: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const featureSelector: AgentControlSelector = `feature-${feature.id}`;
  const featureAnchorRef = useRef<View>(null);

  const handleFeatureOpenChange = useMemo(
    () => handleOpenChange(featureSelector),
    [handleOpenChange, featureSelector],
  );
  const handleSelectPress = useCallback(
    () => handleFeatureOpenChange(openSelector !== featureSelector),
    [featureSelector, handleFeatureOpenChange, openSelector],
  );
  const sheetHeader = useMemo<SheetHeader>(() => ({ title: feature.label }), [feature.label]);

  const handleTogglePress = useCallback(() => {
    if (feature.type === "toggle") {
      onSetFeature?.(feature.id, !feature.value);
    }
  }, [feature, onSetFeature]);

  const handleSelectOption = useCallback(
    (optionId: string) => {
      onSetFeature?.(feature.id, optionId);
    },
    [feature.id, onSetFeature],
  );
  const comboboxOptions = useMemo<ComboboxOption[]>(
    () =>
      feature.type === "select"
        ? feature.options.map((option) => ({
            id: option.id,
            label: option.label,
          }))
        : [],
    [feature],
  );

  if (feature.type === "toggle") {
    const FeatureIcon = getFeatureIcon(feature.icon);
    return (
      <AgentControlTrigger
        icon={FeatureIcon}
        iconTone={getFeatureIconTone(feature.id, feature.value)}
        surface="sheet"
        label={feature.label}
        value={feature.value ? t("agentControls.features.on") : t("agentControls.features.off")}
        disabled={disabled}
        onPress={handleTogglePress}
        accessibilityLabel={getFeatureTooltip(feature)}
        testID={`agent-feature-${feature.id}`}
      />
    );
  }

  if (feature.type === "select") {
    const FeatureIcon = getFeatureIcon(feature.icon);
    const selectedOption = feature.options.find((o) => o.id === feature.value);
    return (
      <>
        <AgentControlTrigger
          ref={featureAnchorRef}
          icon={FeatureIcon}
          surface="sheet"
          label={feature.label}
          value={selectedOption?.label ?? feature.label}
          open={openSelector === featureSelector}
          disabled={disabled}
          onPress={handleSelectPress}
          accessibilityLabel={getFeatureTooltip(feature)}
          testID={`agent-feature-${feature.id}`}
        />
        <Combobox
          options={comboboxOptions}
          value={String(feature.value)}
          onSelect={handleSelectOption}
          open={openSelector === featureSelector}
          onOpenChange={handleFeatureOpenChange}
          anchorRef={featureAnchorRef}
          presentation="push"
          header={sheetHeader}
        />
      </>
    );
  }

  return null;
}

function ThinkingComboboxOption({
  option,
  selected,
  active,
  onPress,
}: {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const leadingSlot = useMemo(
    () => <AgentControlIconGlyph icon={Brain} size={16} tone="foreground" />,
    [],
  );
  return (
    <ComboboxItem
      label={option.label}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

export const AgentControls = memo(function AgentControls({
  agentId,
  serverId,
  isPaneFocused,
  onDropdownClose,
  isCompactLayout,
}: AgentControlsProps) {
  const { t } = useTranslation();
  const { updatePreferences } = useFormPreferences();
  const agent = useSessionStore(
    useShallow((state) => selectAgentControlsSlice(state, serverId, agentId)),
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const toast = useToast();

  const {
    entries: snapshotEntries,
    isRefreshing: snapshotIsRefreshing,
    refresh: refreshSnapshot,
  } = useProvidersSnapshot(serverId, {
    cwd: agent?.cwd,
    enabled: isPaneFocused && Boolean(agent),
  });

  const snapshotSelectedEntry = useMemo(
    () => resolveSnapshotSelectedEntry(snapshotEntries, agent?.provider),
    [snapshotEntries, agent?.provider],
  );
  const modeControl = useLiveAgentModeControl(serverId, agentId, snapshotSelectedEntry);

  const models = snapshotSelectedEntry?.models ?? null;
  const selectedProviderIsLoading = snapshotSelectedEntry?.status === "loading";

  const agentProviderDefinitions = useMemo(
    () => buildAgentProviderDefinitions(agent?.provider, snapshotEntries),
    [agent?.provider, snapshotEntries],
  );

  const agentProviderModels = useMemo(
    () => buildAgentProviderModels(agent?.provider, models),
    [agent?.provider, models],
  );
  const agentModelSelectorProviders = useMemo(() => {
    if (snapshotSelectedEntry) {
      return buildSelectableProviderSelectorProviders([snapshotSelectedEntry]);
    }
    return buildProviderSelectorProviders({
      providerDefinitions: agentProviderDefinitions,
      modelsByProvider: agentProviderModels,
    });
  }, [agentProviderDefinitions, agentProviderModels, snapshotSelectedEntry]);

  const modelSelection = resolveAgentModelSelection({
    models,
    runtimeModelId: agent?.runtimeModelId,
    configuredModelId: agent?.model,
    explicitThinkingOptionId: agent?.thinkingOptionId,
  });

  const modelOptions = useMemo<AgentControlOption[]>(() => {
    return (models ?? []).map((model) => ({
      id: model.id,
      label: model.label,
    }));
  }, [models]);

  const thinkingOptions = useMemo<AgentControlOption[]>(() => {
    return (modelSelection.thinkingOptions ?? []).map((option) => ({
      id: option.id,
      label: formatThinkingOptionLabel(option),
    }));
  }, [modelSelection.thinkingOptions]);

  const agentProvider = agent?.provider;
  const activeModelId = modelSelection.activeModelId;

  const handleSelectModel = useCallback(
    async (modelId: string) => {
      if (!client || !agentProvider) {
        return;
      }
      try {
        await client.setAgentModel(agentId, modelId);
        await updatePreferences((current) =>
          mergeProviderPreferences({
            preferences: current,
            provider: agentProvider,
            updates: {
              model: modelId,
            },
          }),
        );
      } catch (error) {
        console.warn("[AgentControls] setAgentModel or persist preference failed", error);
        toast.error(toErrorMessage(error));
      }
    },
    [agentId, agentProvider, client, toast, updatePreferences],
  );

  const commandCenterModelActions = useMemo(
    () =>
      buildModelChoiceContributions({
        serverId,
        providers: agentModelSelectorProviders,
        selectedProvider: agentProvider ?? null,
        selectedModelId: activeModelId,
        groupLabel: t("shell.commandCenter.modelGroupLabel"),
        searchKeywords: t("shell.commandCenter.modelSearchKeywords"),
        getIcon: getCommandCenterProviderIcon,
        select: (_provider, modelId) => handleSelectModel(modelId),
      }),
    [activeModelId, agentModelSelectorProviders, agentProvider, handleSelectModel, serverId, t],
  );
  useCommandCenterActions({
    sourceId: `agent:${serverId}:${agentId}`,
    enabled: isPaneFocused && Boolean(client),
    actions: commandCenterModelActions,
  });

  // A running agent is one provider's process, so only that provider's profiles
  // can apply to it.
  const profileProviders = useMemo(() => (agentProvider ? [agentProvider] : []), [agentProvider]);
  const profileTarget = useMemo<AgentProfileApplyTarget>(
    () => ({ kind: "agent", agentId }),
    [agentId],
  );
  const agentProfiles = useAgentProfilePicker({
    serverId,
    availableProviders: profileProviders,
    target: profileTarget,
  });
  const handleEditAgentProfiles = useEditAgentProfilesNavigation(serverId, agentProfiles !== null);

  const handleSelectThinkingOption = useCallback(
    (thinkingOptionId: string) => {
      if (!client || !agentProvider) {
        return;
      }
      if (activeModelId) {
        void updatePreferences((current) =>
          mergeProviderPreferences({
            preferences: current,
            provider: agentProvider,
            updates: {
              model: activeModelId,
              thinkingByModel: {
                [activeModelId]: thinkingOptionId,
              },
            },
          }),
        ).catch((error) => {
          console.warn("[AgentControls] persist thinking preference failed", error);
        });
      }
      void client
        .setAgentThinkingOption(agentId, thinkingOptionId)
        .then((notice) => showProviderNoticeToast(toast, notice))
        .catch((error) => {
          console.warn("[AgentControls] setAgentThinkingOption failed", error);
          toast.error(toErrorMessage(error));
        });
    },
    [activeModelId, agentId, agentProvider, client, toast, updatePreferences],
  );

  const handleSetFeature = useCallback(
    (featureId: string, value: unknown) => {
      if (!client || !agentProvider) {
        return;
      }
      void updatePreferences((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider: agentProvider,
          updates: {
            featureValues: {
              [featureId]: value,
            },
          },
        }),
      ).catch((error) => {
        console.warn("[AgentControls] persist feature preference failed", error);
      });
      void client.setAgentFeature(agentId, featureId, value).catch((error) => {
        console.warn("[AgentControls] setAgentFeature failed", error);
        toast.error(toErrorMessage(error));
      });
    },
    [agentId, agentProvider, client, toast, updatePreferences],
  );

  const handleModelSelectorOpen = useCallback(() => {
    if (!agentProvider || (snapshotSelectedEntry && snapshotSelectedEntry.status !== "loading")) {
      return;
    }
    void refreshSnapshot([agentProvider]).catch((error) => {
      console.warn("[智能体控制栏] 刷新提供方模型失败", error);
      toast.error(toErrorMessage(error));
    });
  }, [agentProvider, refreshSnapshot, snapshotSelectedEntry, toast]);

  const handleRetryModelProvider = useCallback(
    (provider: AgentProvider) => {
      void refreshSnapshot([provider]).catch((error) => {
        console.warn("[智能体控制栏] 重试刷新提供方模型失败", error);
        toast.error(toErrorMessage(error));
      });
    },
    [refreshSnapshot, toast],
  );

  if (!agent) {
    return null;
  }

  return (
    <ControlledAgentControls
      providerLocked
      provider={agent.provider}
      modelSelectorProviders={agentModelSelectorProviders}
      modelOptions={modelOptions}
      selectedModelId={modelSelection.activeModelId ?? undefined}
      onSelectModel={handleSelectModel}
      agentProfiles={agentProfiles}
      onApplyAgentProfile={agentProfiles?.applyProfile}
      onEditAgentProfiles={handleEditAgentProfiles}
      thinkingOptions={thinkingOptions.length > 1 ? thinkingOptions : undefined}
      selectedThinkingOptionId={modelSelection.selectedThinkingId ?? undefined}
      onSelectThinkingOption={handleSelectThinkingOption}
      features={agent.features}
      onSetFeature={handleSetFeature}
      isModelLoading={snapshotIsRefreshing || selectedProviderIsLoading}
      onModelSelectorOpen={handleModelSelectorOpen}
      onRetryModelProvider={handleRetryModelProvider}
      isRetryingModelProvider={snapshotIsRefreshing}
      onDropdownClose={onDropdownClose}
      disabled={!client}
      modeControl={modeControl}
      modelSelectorServerId={serverId}
      isCompactLayout={isCompactLayout}
    />
  );
});

export function DraftAgentControls({
  providerDefinitions,
  selectedProvider,
  onSelectProvider,
  modeOptions,
  selectedMode,
  onSelectMode,
  models,
  selectedModel,
  onSelectModel,
  isModelLoading: _isModelLoading,
  modelSelectorProviders,
  isAllModelsLoading,
  onSelectProviderAndModel,
  thinkingOptions,
  selectedThinkingOptionId,
  onSelectThinkingOption,
  features,
  onSetFeature,
  onDropdownClose,
  onModelSelectorOpen,
  onRetryModelProvider,
  isRetryingModelProvider = false,
  disabled = false,
  modelSelectorServerId = null,
  isCompactLayout,
  codexProviderInjections,
  selectedCodexProviderInjectionId = null,
  onSelectCodexProviderInjection,
}: DraftAgentControlsProps) {
  const providerOptions = useMemo<AgentControlOption[]>(
    () => modelSelectorProviders.map(({ id, label }) => ({ id, label })),
    [modelSelectorProviders],
  );
  const mappedThinkingOptions = useMemo<AgentControlOption[]>(() => {
    return toThinkingControlOptions(thinkingOptions);
  }, [thinkingOptions]);

  const effectiveSelectedThinkingOption =
    selectedThinkingOptionId || mappedThinkingOptions[0]?.id || undefined;

  const modelOptions = useMemo<AgentControlOption[]>(
    () =>
      models.map((model) => ({
        id: model.id,
        label: model.label,
      })),
    [models],
  );

  // The draft form is the one surface that can switch provider, so every profile
  // the host can actually run is offered here.
  const profileProviders = useMemo(
    () => modelSelectorProviders.map((entry) => entry.id),
    [modelSelectorProviders],
  );
  const profileTarget = useMemo<AgentProfileApplyTarget>(
    () => ({
      kind: "draft",
      controls: {
        selectProvider: onSelectProvider,
        selectProviderAndModel: onSelectProviderAndModel,
        selectMode: onSelectMode,
        selectThinkingOption: onSelectThinkingOption,
        setFeature: onSetFeature,
      },
    }),
    [
      onSelectMode,
      onSelectProvider,
      onSelectProviderAndModel,
      onSelectThinkingOption,
      onSetFeature,
    ],
  );
  const agentProfiles = useAgentProfilePicker({
    serverId: modelSelectorServerId,
    availableProviders: profileProviders,
    target: profileTarget,
  });
  const handleEditAgentProfiles = useEditAgentProfilesNavigation(
    modelSelectorServerId,
    agentProfiles !== null,
  );

  const modeControl = useMemo<AgentModeControlValue | null>(
    () =>
      selectedProvider && modeOptions.length > 0
        ? {
            provider: selectedProvider,
            providerDefinitions,
            modeOptions,
            selectedModeId: selectedMode,
            onSelectMode,
            disabled,
          }
        : null,
    [selectedProvider, providerDefinitions, modeOptions, selectedMode, onSelectMode, disabled],
  );

  return (
    <ControlledAgentControls
      providerLocked={false}
      provider={selectedProvider ?? ""}
      providerOptions={providerOptions}
      selectedProviderId={selectedProvider ?? undefined}
      onSelectProvider={onSelectProvider}
      modelSelectorProviders={modelSelectorProviders}
      modelOptions={modelOptions}
      selectedModelId={selectedModel}
      onSelectModel={onSelectModel}
      onSelectProviderAndModel={onSelectProviderAndModel}
      isModelLoading={isAllModelsLoading}
      agentProfiles={agentProfiles}
      onApplyAgentProfile={agentProfiles?.applyProfile}
      onEditAgentProfiles={handleEditAgentProfiles}
      thinkingOptions={mappedThinkingOptions.length > 0 ? mappedThinkingOptions : undefined}
      selectedThinkingOptionId={effectiveSelectedThinkingOption}
      onSelectThinkingOption={onSelectThinkingOption}
      features={features}
      onSetFeature={onSetFeature}
      onDropdownClose={onDropdownClose}
      onModelSelectorOpen={onModelSelectorOpen}
      onRetryModelProvider={onRetryModelProvider}
      isRetryingModelProvider={isRetryingModelProvider}
      disabled={disabled}
      modeControl={modeControl}
      modelSelectorServerId={modelSelectorServerId}
      isCompactLayout={isCompactLayout}
      codexProviderInjections={codexProviderInjections}
      selectedCodexProviderInjectionId={selectedCodexProviderInjectionId}
      onSelectCodexProviderInjection={onSelectCodexProviderInjection}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  roleSwitch: {
    width: 30,
    height: 18,
    padding: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface0,
  },
  roleSwitchOn: { backgroundColor: theme.colors.accent },
  roleSwitchThumb: {
    width: 14,
    height: 14,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundMuted,
  },
  roleSwitchThumbOn: { alignSelf: "flex-end", backgroundColor: theme.colors.accentForeground },
  roleChip: {
    minWidth: 0,
    flexShrink: 1,
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  roleChipActive: { backgroundColor: theme.colors.surface3 },
  roleChipText: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  roleThinkingText: {
    flexShrink: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  roleMenuRow: {
    marginHorizontal: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  roleMenuRowActive: { backgroundColor: theme.colors.surface3 },
  roleMenuLabel: { flexShrink: 0, fontSize: theme.fontSize.sm, color: theme.colors.foreground },
  roleMenuValue: {
    minWidth: 0,
    flex: 1,
    flexShrink: 1,
    textAlign: "right",
    marginLeft: "auto",
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  container: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    overflow: "hidden",
  },
  disabledBadge: {
    opacity: 0.5,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  combinedSheetControls: {
    gap: theme.spacing[1],
  },
}));
