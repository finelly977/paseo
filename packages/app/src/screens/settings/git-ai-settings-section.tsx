import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DEFAULT_GIT_AI_COMMIT_MESSAGE_PROMPT,
  DEFAULT_GIT_AI_COMMIT_REVIEW_PROMPT,
  type GitAiTaskProfile,
} from "@getpaseo/protocol/messages";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { SettingsTextArea } from "@/components/settings-textarea";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { buildSelectableProviderSelectorProviders } from "@/provider-selection/provider-selection";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";

type GitAiProfileKey = "commitMessage" | "commitReview";

const EMPTY_PROFILE = {
  provider: null,
  model: null,
  modeId: null,
  thinkingOptionId: null,
} as const;
const FLEX_STYLE = { flex: 1 } as const;
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedSparkles = withUnistyles(Sparkles);

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function defaultPromptForProfile(profileKey: GitAiProfileKey): string {
  return profileKey === "commitMessage"
    ? DEFAULT_GIT_AI_COMMIT_MESSAGE_PROMPT
    : DEFAULT_GIT_AI_COMMIT_REVIEW_PROMPT;
}

function withDefaultPrompt(
  profileKey: GitAiProfileKey,
  profile: GitAiTaskProfile | undefined,
): GitAiTaskProfile {
  const resolved = profile ?? { ...EMPTY_PROFILE, prompt: defaultPromptForProfile(profileKey) };
  return resolved.prompt.trim()
    ? resolved
    : { ...resolved, prompt: defaultPromptForProfile(profileKey) };
}

function fieldTriggerStyle({
  hovered,
  pressed,
  open,
}: PressableStateCallbackType & { hovered?: boolean; open?: boolean }) {
  return [
    styles.fieldTrigger,
    (Boolean(hovered) || pressed || Boolean(open)) && styles.fieldTriggerActive,
  ];
}

function profileSummary(
  profile: GitAiTaskProfile,
  entries: ReturnType<typeof useProvidersSnapshot>["entries"],
  unconfigured: string,
): string {
  if (!profile.provider) {
    return unconfigured;
  }
  const provider = entries?.find((entry) => entry.provider === profile.provider);
  const providerLabel = provider?.label ?? profile.provider;
  const modelLabel = provider?.models?.find((model) => model.id === profile.model)?.label;
  return modelLabel ? `${providerLabel} · ${modelLabel}` : providerLabel;
}

function GitAiProfileRow({
  profileKey,
  profile,
  entries,
  first,
  onEdit,
}: {
  profileKey: GitAiProfileKey;
  profile: GitAiTaskProfile;
  entries: ReturnType<typeof useProvidersSnapshot>["entries"];
  first: boolean;
  onEdit: (profileKey: GitAiProfileKey) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onEdit(profileKey), [onEdit, profileKey]);
  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.row,
      !first && settingsStyles.rowBorder,
      styles.profileRow,
      (Boolean(hovered) || pressed) && styles.profileRowActive,
    ],
    [first],
  );
  const title = t(`settings.host.gitAi.${profileKey}.title`);
  const summary = profileSummary(profile, entries, t("settings.host.gitAi.unconfigured"));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={handlePress}
      style={rowStyle}
      testID={`git-ai-profile-${profileKey}`}
    >
      <View style={settingsStyles.rowContent}>
        <View style={styles.profileIdentity}>
          <ThemedSparkles size={14} uniProps={mutedIconMapping} />
          <View style={styles.profileText}>
            <Text style={settingsStyles.rowTitle}>{title}</Text>
            <Text style={settingsStyles.rowHint} numberOfLines={1}>
              {summary}
            </Text>
          </View>
        </View>
      </View>
      <ThemedChevronRight size={14} uniProps={mutedIconMapping} />
    </Pressable>
  );
}

interface GitAiSelectOption {
  id: string;
  label: string;
}

function GitAiOptionItem({
  option,
  selected,
  onSelect,
}: {
  option: GitAiSelectOption;
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

function GitAiOptionField({
  label,
  value,
  options,
  defaultLabel,
  onChange,
}: {
  label: string;
  value: string | null;
  options: GitAiSelectOption[];
  defaultLabel: string;
  onChange: (id: string | null) => void;
}) {
  const selectedLabel = options.find((option) => option.id === value)?.label ?? defaultLabel;
  const handleSelectDefault = useCallback(() => onChange(null), [onChange]);
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <DropdownMenu>
        <DropdownMenuTrigger style={fieldTriggerStyle} disabled={options.length === 0}>
          <Text style={styles.fieldValue} numberOfLines={1}>
            {selectedLabel}
          </Text>
          <ThemedChevronDown size={14} uniProps={mutedIconMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" width={260}>
          <DropdownMenuItem selected={value === null} onSelect={handleSelectDefault}>
            {defaultLabel}
          </DropdownMenuItem>
          {options.map((option) => (
            <GitAiOptionItem
              key={option.id}
              option={option}
              selected={value === option.id}
              onSelect={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

function GitAiProfileEditor({
  serverId,
  profileKey,
  initialProfile,
  onClose,
  onSave,
}: {
  serverId: string;
  profileKey: GitAiProfileKey;
  initialProfile: GitAiTaskProfile;
  onClose: () => void;
  onSave: (profile: GitAiTaskProfile) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialProfile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snapshot = useProvidersSnapshot(serverId);
  const refetchModelsIfStale = snapshot.refetchIfStale;
  const providers = useMemo(
    () => buildSelectableProviderSelectorProviders(snapshot.entries),
    [snapshot.entries],
  );
  const selectedEntry = snapshot.entries?.find((entry) => entry.provider === draft.provider);
  const selectedModel =
    selectedEntry?.models?.find((model) => model.id === draft.model) ??
    selectedEntry?.models?.find((model) => model.isDefault) ??
    selectedEntry?.models?.[0];
  const modeOptions = selectedEntry?.modes ?? [];
  const thinkingOptions = selectedModel?.thinkingOptions ?? [];
  const defaultOptionLabel = t("settings.host.gitAi.defaultOption");
  const header = useMemo<SheetHeader>(
    () => ({ title: t(`settings.host.gitAi.${profileKey}.editTitle`) }),
    [profileKey, t],
  );

  const handleSelectModel = useCallback(
    (provider: string, modelId: string) => {
      const entry = snapshot.entries?.find((candidate) => candidate.provider === provider);
      const model = entry?.models?.find((candidate) => candidate.id === modelId);
      setDraft((current) => ({
        ...current,
        provider,
        model: modelId || null,
        modeId: entry?.defaultModeId ?? null,
        thinkingOptionId: model?.defaultThinkingOptionId ?? null,
      }));
      setError(null);
    },
    [snapshot.entries],
  );
  const handlePromptChange = useCallback((prompt: string) => {
    setDraft((current) => ({ ...current, prompt }));
  }, []);
  const handleModeChange = useCallback((modeId: string | null) => {
    setDraft((current) => ({ ...current, modeId }));
  }, []);
  const handleThinkingChange = useCallback((thinkingOptionId: string | null) => {
    setDraft((current) => ({ ...current, thinkingOptionId }));
  }, []);
  const handleModelOpen = useCallback(() => {
    refetchModelsIfStale(draft.provider);
  }, [draft.provider, refetchModelsIfStale]);
  const renderModelTrigger = useCallback(
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
      <View style={fieldTriggerStyle({ hovered, pressed, open: isOpen })}>
        <Text style={styles.fieldValue} numberOfLines={1}>
          {selectedModelLabel}
        </Text>
        <ThemedChevronDown size={14} uniProps={mutedIconMapping} />
      </View>
    ),
    [],
  );
  const handleClose = useCallback(() => {
    if (!saving) {
      onClose();
    }
  }, [onClose, saving]);
  const handleSave = useCallback(() => {
    if (!draft.provider) {
      setError(t("settings.host.gitAi.errors.providerRequired"));
      return;
    }
    const normalizedDraft = withDefaultPrompt(profileKey, draft);
    setSaving(true);
    setError(null);
    void onSave(normalizedDraft)
      .then(() => {
        setSaving(false);
        onClose();
        return undefined;
      })
      .catch((saveError) => {
        console.error("[Git AI 设置] 保存失败", saveError);
        setSaving(false);
        setError(
          saveError instanceof Error
            ? saveError.message
            : t("settings.host.gitAi.errors.saveFailed"),
        );
        return undefined;
      });
  }, [draft, onClose, onSave, profileKey, t]);

  return (
    <AdaptiveModalSheet
      visible
      header={header}
      onClose={handleClose}
      testID="git-ai-profile-editor"
    >
      <View style={styles.editorContent}>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t("settings.host.gitAi.fields.agentModel")}</Text>
          <CombinedModelSelector
            providers={providers}
            selectedProvider={draft.provider ?? ""}
            selectedModel={draft.model ?? ""}
            onSelect={handleSelectModel}
            isLoading={snapshot.isLoading || snapshot.isFetching}
            onOpen={handleModelOpen}
            serverId={serverId}
            triggerFill
            renderTrigger={renderModelTrigger}
          />
        </View>

        <GitAiOptionField
          label={t("settings.host.gitAi.fields.mode")}
          value={draft.modeId}
          options={modeOptions}
          defaultLabel={defaultOptionLabel}
          onChange={handleModeChange}
        />

        <GitAiOptionField
          label={t("settings.host.gitAi.fields.thinking")}
          value={draft.thinkingOptionId}
          options={thinkingOptions}
          defaultLabel={defaultOptionLabel}
          onChange={handleThinkingChange}
        />

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t("settings.host.gitAi.fields.prompt")}</Text>
          <View style={settingsStyles.card}>
            <SettingsTextArea
              accessibilityLabel={t("settings.host.gitAi.fields.prompt")}
              value={draft.prompt}
              onChangeText={handlePromptChange}
              placeholder={t(`settings.host.gitAi.${profileKey}.promptPlaceholder`)}
              testID="git-ai-profile-prompt"
            />
          </View>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <View style={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            style={FLEX_STYLE}
            disabled={saving}
            onPress={handleClose}
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            style={FLEX_STYLE}
            disabled={saving}
            onPress={handleSave}
          >
            {saving ? t("settings.host.gitAi.saving") : t("common.actions.save")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

function GitAiSettingsContent({
  serverInfoReady,
  supported,
  commitMessage,
  commitReview,
  entries,
  onEdit,
}: {
  serverInfoReady: boolean;
  supported: boolean;
  commitMessage: GitAiTaskProfile;
  commitReview: GitAiTaskProfile;
  entries: ReturnType<typeof useProvidersSnapshot>["entries"];
  onEdit: (profileKey: GitAiProfileKey) => void;
}) {
  const { t } = useTranslation();
  if (!serverInfoReady) {
    return (
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <Text style={settingsStyles.rowHint}>{t("common.states.loading")}</Text>
        </View>
      </View>
    );
  }
  if (!supported) {
    return (
      <Alert
        variant="warning"
        title={t("settings.host.gitAi.unsupported.title")}
        description={t("settings.host.gitAi.unsupported.description")}
      />
    );
  }
  return (
    <View style={settingsStyles.card}>
      <GitAiProfileRow
        profileKey="commitMessage"
        profile={commitMessage}
        entries={entries}
        first
        onEdit={onEdit}
      />
      <GitAiProfileRow
        profileKey="commitReview"
        profile={commitReview}
        entries={entries}
        first={false}
        onEdit={onEdit}
      />
    </View>
  );
}

export function GitAiSettingsSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const snapshot = useProvidersSnapshot(serverId);
  const serverInfo = useSessionStore((state) => state.sessions[serverId]?.serverInfo ?? null);
  const supported = serverInfo?.features?.gitAi === true;
  const [editing, setEditing] = useState<GitAiProfileKey | null>(null);
  const handleEdit = useCallback((profileKey: GitAiProfileKey) => setEditing(profileKey), []);
  const handleClose = useCallback(() => setEditing(null), []);
  const commitMessage = withDefaultPrompt("commitMessage", config?.gitAi?.commitMessage);
  const commitReview = withDefaultPrompt("commitReview", config?.gitAi?.commitReview);
  const activeProfile = editing === "commitMessage" ? commitMessage : commitReview;
  const handleSave = useCallback(
    async (profile: GitAiTaskProfile) => {
      if (!editing) {
        throw new Error(t("settings.host.gitAi.errors.editorClosed"));
      }
      const savedConfig = await patchConfig({
        gitAi: editing === "commitMessage" ? { commitMessage: profile } : { commitReview: profile },
      });
      if (!savedConfig) {
        throw new Error(t("settings.host.gitAi.errors.hostDisconnected"));
      }
    },
    [editing, patchConfig, t],
  );

  return (
    <SettingsSection title={t("settings.host.gitAi.title")} testID="git-ai-settings-section">
      <GitAiSettingsContent
        serverInfoReady={serverInfo !== null}
        supported={supported}
        commitMessage={commitMessage}
        commitReview={commitReview}
        entries={snapshot.entries}
        onEdit={handleEdit}
      />
      {editing ? (
        <GitAiProfileEditor
          key={editing}
          serverId={serverId}
          profileKey={editing}
          initialProfile={activeProfile}
          onClose={handleClose}
          onSave={handleSave}
        />
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  profileRow: {
    minHeight: 64,
  },
  profileRowActive: {
    backgroundColor: theme.colors.surface2,
  },
  profileIdentity: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  profileText: {
    flex: 1,
    minWidth: 0,
  },
  editorContent: {
    gap: theme.spacing[4],
  },
  fieldGroup: {
    gap: theme.spacing[2],
  },
  fieldLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  fieldTrigger: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  fieldTriggerActive: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  fieldValue: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.xs,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
}));
