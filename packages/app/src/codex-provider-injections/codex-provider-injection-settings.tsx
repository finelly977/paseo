import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Alert, Pressable, Text, View, type AccessibilityActionEvent } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, GripVertical, Pencil, Plus, Trash2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  getCodexProviderInjectionModels,
  type CodexProviderInjection,
} from "@getpaseo/protocol/messages";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import {
  buildCodexProviderDefinition,
  buildEnvironmentVariables,
  openCodexProviderInjectionForm,
  type OptionalBooleanDraft,
} from "./codex-provider-injection-form";
import { useCodexProviderInjections } from "./use-codex-provider-injections";

const ThemedPlus = withUnistyles(Plus);
const ThemedGrip = withUnistyles(GripVertical);
const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash = withUnistyles(Trash2);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const addIcon = <ThemedPlus size={ICON_SIZE.sm} uniProps={mutedColor} />;
const dragIcon = <ThemedGrip size={ICON_SIZE.sm} uniProps={mutedColor} />;
const editIcon = <ThemedPencil size={ICON_SIZE.sm} uniProps={mutedColor} />;
const removeIcon = <ThemedTrash size={ICON_SIZE.sm} uniProps={mutedColor} />;

type EditTarget = { mode: "create" } | { mode: "edit"; injection: CodexProviderInjection };

interface ModelDraft {
  id: number;
  value: string;
}

interface EnvironmentVariableDraft {
  id: number;
  key: string;
  value: string;
}

let nextModelDraftId = 0;
let nextEnvironmentVariableDraftId = 0;

function createModelDraft(value = ""): ModelDraft {
  nextModelDraftId += 1;
  return { id: nextModelDraftId, value };
}

function createEnvironmentVariableDraft(key = "", value = ""): EnvironmentVariableDraft {
  nextEnvironmentVariableDraftId += 1;
  return { id: nextEnvironmentVariableDraftId, key, value };
}

function generateId(): string {
  return `codex_provider_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function sameOrder(a: readonly CodexProviderInjection[], b: readonly CodexProviderInjection[]) {
  return a.length === b.length && a.every((entry, index) => entry.id === b[index]?.id);
}

function injectionKey(entry: CodexProviderInjection): string {
  return entry.id;
}

export function CodexProviderInjectionSettings({ serverId }: { serverId: string }): ReactElement {
  const { t } = useTranslation();
  const connected = useHostRuntimeIsConnected(serverId);
  const { injections, isSupported, saveInjections } = useCodexProviderInjections(serverId);
  const [ordered, setOrdered] = useState<CodexProviderInjection[]>(injections ?? []);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [reordering, setReordering] = useState(false);

  useEffect(() => setOrdered(injections ?? []), [injections]);
  const openCreate = useCallback(() => setEditTarget({ mode: "create" }), []);
  const closeEditor = useCallback(() => setEditTarget(null), []);
  const openEdit = useCallback(
    (entry: CodexProviderInjection) => setEditTarget({ mode: "edit", injection: entry }),
    [],
  );

  const persistOrder = useCallback(
    async (next: CodexProviderInjection[]) => {
      if (reordering || sameOrder(ordered, next)) return;
      const previous = ordered;
      setOrdered(next);
      setReordering(true);
      try {
        await saveInjections(next);
      } catch (error) {
        setOrdered(previous);
        Alert.alert(t("common.errors.unableToSave"), toErrorMessage(error));
      } finally {
        setReordering(false);
      }
    },
    [ordered, reordering, saveInjections, t],
  );
  const move = useCallback(
    (id: string, offset: -1 | 1) => {
      const index = ordered.findIndex((entry) => entry.id === id);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= ordered.length) return;
      const next = [...ordered];
      const [entry] = next.splice(index, 1);
      next.splice(target, 0, entry);
      void persistOrder(next);
    },
    [ordered, persistOrder],
  );
  const remove = useCallback(
    async (id: string) => {
      const entry = ordered.find((item) => item.id === id);
      if (!entry) return;
      if (
        !(await confirmDialog({
          title: t("settings.host.codexProviderInjections.removeConfirmTitle"),
          message: t("settings.host.codexProviderInjections.removeConfirmMessage", {
            name: entry.name,
          }),
          confirmLabel: t("common.actions.remove"),
          cancelLabel: t("common.actions.cancel"),
          destructive: true,
        }))
      ) {
        return;
      }
      try {
        const next = ordered.filter((item) => item.id !== id);
        await saveInjections(next);
        setOrdered(next);
      } catch (error) {
        Alert.alert(t("common.errors.unableToSave"), toErrorMessage(error));
      }
    },
    [ordered, saveInjections, t],
  );
  const requestRemove = useCallback((id: string) => void remove(id), [remove]);
  const save = useCallback(
    async (value: Omit<CodexProviderInjection, "id">) => {
      const editing = editTarget?.mode === "edit" ? editTarget.injection : undefined;
      const next = editing
        ? ordered.map((entry) => (entry.id === editing.id ? { id: entry.id, ...value } : entry))
        : [...ordered, { id: generateId(), ...value }];
      await saveInjections(next);
      setOrdered(next);
    },
    [editTarget, ordered, saveInjections],
  );
  const renderItem = useCallback(
    (info: DraggableRenderItemInfo<CodexProviderInjection>) => (
      <InjectionRow
        {...info}
        first={info.index === 0}
        last={info.index === ordered.length - 1}
        disabled={reordering}
        onEdit={openEdit}
        onRemove={requestRemove}
        onMove={move}
      />
    ),
    [move, openEdit, ordered.length, reordering, requestRemove],
  );
  const handleDragEnd = useCallback(
    (next: CodexProviderInjection[]) => void persistOrder(next),
    [persistOrder],
  );
  const trailing = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={addIcon}
        onPress={openCreate}
        disabled={!injections || reordering}
        accessibilityLabel={t("settings.host.codexProviderInjections.add")}
      >
        {t("settings.host.codexProviderInjections.add")}
      </Button>
    ),
    [injections, openCreate, reordering, t],
  );

  if (!connected || !isSupported) {
    return (
      <View>
        <Text style={styles.pageDescription}>
          {t("settings.host.codexProviderInjections.description")}
        </Text>
        <SettingsSection title={t("settings.host.codexProviderInjections.configuredTitle")}>
          <View style={settingsStyles.card}>
            <View style={styles.empty}>
              <Text style={styles.muted}>
                {connected
                  ? t("settings.host.codexProviderInjections.unsupported")
                  : t("settings.host.codexProviderInjections.unavailable")}
              </Text>
            </View>
          </View>
        </SettingsSection>
      </View>
    );
  }

  return (
    <>
      <Text style={styles.pageDescription}>
        {t("settings.host.codexProviderInjections.description")}
      </Text>
      <SettingsSection
        title={t("settings.host.codexProviderInjections.configuredTitle")}
        trailing={trailing}
      >
        <View style={settingsStyles.card}>
          {ordered.length ? (
            <DraggableList
              data={ordered}
              keyExtractor={injectionKey}
              renderItem={renderItem}
              onDragEnd={handleDragEnd}
              scrollEnabled={false}
              useDragHandle
              extraData={reordering}
            />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.muted}>{t("settings.host.codexProviderInjections.empty")}</Text>
              <Button size="sm" leftIcon={addIcon} onPress={openCreate}>
                {t("settings.host.codexProviderInjections.add")}
              </Button>
            </View>
          )}
        </View>
      </SettingsSection>
      {editTarget ? (
        <InjectionEditModal
          key={editTarget.mode === "edit" ? `edit:${editTarget.injection.id}` : "create"}
          target={editTarget}
          onClose={closeEditor}
          onSave={save}
        />
      ) : null}
    </>
  );
}

function InjectionRow({
  item,
  drag,
  isActive,
  dragHandleProps,
  first,
  last,
  disabled,
  onEdit,
  onRemove,
  onMove,
}: DraggableRenderItemInfo<CodexProviderInjection> & {
  first: boolean;
  last: boolean;
  disabled: boolean;
  onEdit: (entry: CodexProviderInjection) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, offset: -1 | 1) => void;
}): ReactElement {
  const { t } = useTranslation();
  const models = getCodexProviderInjectionModels(item);
  const actions = useMemo(
    () => [
      ...(!first
        ? [{ name: "decrement" as const, label: t("settings.host.agentProfiles.moveUp") }]
        : []),
      ...(!last
        ? [{ name: "increment" as const, label: t("settings.host.agentProfiles.moveDown") }]
        : []),
    ],
    [first, last, t],
  );
  const accessibilityMove = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === "decrement" && !first) onMove(item.id, -1);
      if (event.nativeEvent.actionName === "increment" && !last) onMove(item.id, 1);
    },
    [first, item.id, last, onMove],
  );
  const handleDrag = useCallback(() => {
    if (!disabled) drag();
  }, [disabled, drag]);
  const handleEdit = useCallback(() => onEdit(item), [item, onEdit]);
  const handleRemove = useCallback(() => onRemove(item.id), [item.id, onRemove]);
  return (
    <View
      style={[
        settingsStyles.row,
        first ? null : settingsStyles.rowBorder,
        styles.row,
        isActive ? styles.dragging : null,
      ]}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {item.modelProvider}
        </Text>
        <Text style={styles.modelSummary} numberOfLines={1}>
          {models.length
            ? t("settings.host.codexProviderInjections.modelSummary", {
                count: models.length,
                models: models.join(" · "),
              })
            : t("settings.host.codexProviderInjections.keepCurrentModelSummary")}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button
          {...(disabled ? {} : (dragHandleProps?.attributes as object | undefined))}
          {...(disabled ? {} : (dragHandleProps?.listeners as object | undefined))}
          variant="ghost"
          size="sm"
          leftIcon={dragIcon}
          onLongPress={handleDrag}
          disabled={disabled}
          accessibilityLabel={t("settings.host.codexProviderInjections.reorder")}
          accessibilityActions={actions}
          onAccessibilityAction={accessibilityMove}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={editIcon}
          onPress={handleEdit}
          accessibilityLabel={t("common.actions.edit")}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={removeIcon}
          onPress={handleRemove}
          accessibilityLabel={t("common.actions.remove")}
        />
      </View>
    </View>
  );
}

function parseObject(value: string, fieldName: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`${fieldName}不是有效 JSON：${toErrorMessage(error)}`, { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${fieldName}必须是 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

function ModelInputRow({
  model,
  index,
  canRemove,
  first,
  size,
  disabled,
  onChange,
  onRemove,
}: {
  model: ModelDraft;
  index: number;
  canRemove: boolean;
  first: boolean;
  size: FieldControlSize;
  disabled: boolean;
  onChange: (id: number, value: string) => void;
  onRemove: (id: number) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handleChange = useCallback(
    (value: string) => onChange(model.id, value),
    [model.id, onChange],
  );
  const handleRemove = useCallback(() => onRemove(model.id), [model.id, onRemove]);

  return (
    <View style={[styles.repeaterRow, first ? null : styles.repeaterRowBorder]}>
      <Text style={styles.rowIndex}>{index + 1}</Text>
      <FormTextInput
        initialValue={model.value}
        onChangeText={handleChange}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        placeholder={t("settings.host.codexProviderInjections.modelPlaceholder")}
        accessibilityLabel={t("settings.host.codexProviderInjections.modelAccessibilityLabel", {
          index: index + 1,
        })}
        size={size}
        style={styles.repeaterInput}
      />
      <Button
        variant="ghost"
        size="sm"
        leftIcon={removeIcon}
        onPress={handleRemove}
        disabled={disabled || !canRemove}
        accessibilityLabel={t("settings.host.codexProviderInjections.removeModel", {
          index: index + 1,
        })}
      />
    </View>
  );
}

function EnvironmentVariableInputRow({
  variable,
  first,
  size,
  disabled,
  onChange,
  onRemove,
}: {
  variable: EnvironmentVariableDraft;
  first: boolean;
  size: FieldControlSize;
  disabled: boolean;
  onChange: (id: number, patch: Partial<Pick<EnvironmentVariableDraft, "key" | "value">>) => void;
  onRemove: (id: number) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handleKeyChange = useCallback(
    (key: string) => onChange(variable.id, { key }),
    [onChange, variable.id],
  );
  const handleValueChange = useCallback(
    (value: string) => onChange(variable.id, { value }),
    [onChange, variable.id],
  );
  const handleRemove = useCallback(() => onRemove(variable.id), [onRemove, variable.id]);

  return (
    <View style={[styles.repeaterRow, first ? null : styles.repeaterRowBorder]}>
      <FormTextInput
        initialValue={variable.key}
        onChangeText={handleKeyChange}
        placeholder={t("settings.host.codexProviderInjections.envNamePlaceholder")}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!disabled}
        size={size}
        style={styles.envNameInput}
      />
      <FormTextInput
        initialValue={variable.value}
        onChangeText={handleValueChange}
        placeholder={t("settings.host.codexProviderInjections.envValuePlaceholder")}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        size={size}
        style={styles.envValueInput}
      />
      <Button
        variant="ghost"
        size="sm"
        leftIcon={removeIcon}
        onPress={handleRemove}
        disabled={disabled}
        accessibilityLabel={t("settings.host.codexProviderInjections.removeEnvironmentVariable")}
      />
    </View>
  );
}

function FormSectionHeading({ title, hint }: { title: string; hint?: string }): ReactElement {
  return (
    <View style={styles.sectionHeading}>
      <View style={styles.sectionHeadingText}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

function InjectionEditModal({
  target,
  onClose,
  onSave,
}: {
  target: EditTarget;
  onClose: () => void;
  onSave: (value: Omit<CodexProviderInjection, "id">) => Promise<void>;
}): ReactElement {
  const { t } = useTranslation();
  const entry = target.mode === "edit" ? target.injection : undefined;
  const [initialization] = useState(() => openCodexProviderInjectionForm(entry));
  const initialDraft = initialization.draft;
  const [name, setName] = useState(initialDraft.name);
  const [modelProvider, setModelProvider] = useState(initialDraft.modelProvider);
  const [models, setModels] = useState<ModelDraft[]>(() =>
    initialDraft.models.map((model) => createModelDraft(model)),
  );
  const [providerName, setProviderName] = useState(initialDraft.providerName);
  const [baseUrl, setBaseUrl] = useState(initialDraft.baseUrl);
  const [envKey, setEnvKey] = useState(initialDraft.envKey);
  const [requiresOpenAiAuth, setRequiresOpenAiAuth] = useState<OptionalBooleanDraft>(
    initialDraft.requiresOpenAiAuth,
  );
  const [supportsWebsockets, setSupportsWebsockets] = useState<OptionalBooleanDraft>(
    initialDraft.supportsWebsockets,
  );
  const [environmentVariables, setEnvironmentVariables] = useState<EnvironmentVariableDraft[]>(() =>
    initialDraft.environmentVariables.map(({ key, value }) =>
      createEnvironmentVariableDraft(key, value),
    ),
  );
  const [additionalDefinition, setAdditionalDefinition] = useState(
    initialDraft.additionalDefinition,
  );
  const [advancedOpen, setAdvancedOpen] = useState(initialDraft.advancedOpen);
  const [error, setError] = useState<string | null>(() => {
    if (!initialization.error) return null;
    console.error(
      "[codex-provider-injection] failed to read provider definition",
      initialization.error,
    );
    return toErrorMessage(initialization.error);
  });
  const [saving, setSaving] = useState(false);
  const isCompact = useIsCompactFormFactor();
  const addModel = useCallback(() => {
    setModels((current) => [...current, createModelDraft()]);
  }, []);
  const updateModel = useCallback((id: number, value: string) => {
    setModels((current) => current.map((model) => (model.id === id ? { ...model, value } : model)));
  }, []);
  const removeModel = useCallback((id: number) => {
    setModels((current) =>
      current.length === 1 ? current : current.filter((model) => model.id !== id),
    );
  }, []);
  const addEnvironmentVariable = useCallback(() => {
    setEnvironmentVariables((current) => [...current, createEnvironmentVariableDraft()]);
  }, []);
  const updateEnvironmentVariable = useCallback(
    (id: number, patch: Partial<Pick<EnvironmentVariableDraft, "key" | "value">>) => {
      setEnvironmentVariables((current) =>
        current.map((variable) => (variable.id === id ? { ...variable, ...patch } : variable)),
      );
    },
    [],
  );
  const removeEnvironmentVariable = useCallback((id: number) => {
    setEnvironmentVariables((current) => {
      const next = current.filter((variable) => variable.id !== id);
      return next.length ? next : [createEnvironmentVariableDraft()];
    });
  }, []);
  const toggleAdvanced = useCallback(() => setAdvancedOpen((current) => !current), []);
  const submit = useCallback(async () => {
    const normalizedName = name.trim();
    const normalizedProvider = modelProvider.trim();
    if (!normalizedName || !normalizedProvider) {
      setError(t("settings.host.codexProviderInjections.required"));
      return;
    }
    const normalizedModels = models.map((model) => model.value.trim());
    if (normalizedModels.some((model) => !model)) {
      setError(t("settings.host.codexProviderInjections.modelsRequired"));
      return;
    }
    if (new Set(normalizedModels).size !== normalizedModels.length) {
      setError(t("settings.host.codexProviderInjections.duplicateModel"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const parsedAdditionalDefinition = parseObject(additionalDefinition, "其他服务商参数");
      const definition = buildCodexProviderDefinition({
        displayName: normalizedName,
        providerName,
        baseUrl,
        envKey,
        requiresOpenAiAuth,
        supportsWebsockets,
        additionalDefinition: parsedAdditionalDefinition,
      });
      const env = buildEnvironmentVariables(environmentVariables);
      await onSave({
        name: normalizedName,
        modelProvider: normalizedProvider,
        models: normalizedModels,
        definition,
        ...(env ? { env } : {}),
      });
      onClose();
    } catch (submitError) {
      setError(toErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  }, [
    additionalDefinition,
    baseUrl,
    envKey,
    environmentVariables,
    modelProvider,
    models,
    name,
    onClose,
    onSave,
    providerName,
    requiresOpenAiAuth,
    supportsWebsockets,
    t,
  ]);
  const header = useMemo(
    () => ({
      title: t(
        target.mode === "edit"
          ? "settings.host.codexProviderInjections.editTitle"
          : "settings.host.codexProviderInjections.addTitle",
      ),
    }),
    [t, target.mode],
  );
  const handleClose = useCallback(() => {
    if (!saving) onClose();
  }, [onClose, saving]);
  const handleSubmit = useCallback(() => void submit(), [submit]);
  const optionalBooleanOptions = useMemo(
    () => [
      {
        value: "default" as const,
        label: t("settings.host.codexProviderInjections.optionDefault"),
      },
      {
        value: "enabled" as const,
        label: t("settings.host.codexProviderInjections.optionEnabled"),
      },
      {
        value: "disabled" as const,
        label: t("settings.host.codexProviderInjections.optionDisabled"),
      },
    ],
    [t],
  );
  const controlSize = isCompact ? "md" : "sm";
  const optionSize = isCompact ? "sm" : "xs";
  const AdvancedIcon = advancedOpen ? ThemedChevronDown : ThemedChevronRight;
  const advancedAccessibilityState = useMemo(() => ({ expanded: advancedOpen }), [advancedOpen]);
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          variant="secondary"
          onPress={handleClose}
          disabled={saving}
          style={styles.footerButton}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button onPress={handleSubmit} disabled={saving} style={styles.footerButton}>
          {saving ? t("settings.host.codexProviderInjections.saving") : t("common.actions.save")}
        </Button>
      </View>
    ),
    [handleClose, handleSubmit, saving, t],
  );

  return (
    <AdaptiveModalSheet
      visible
      header={header}
      onClose={handleClose}
      desktopMaxWidth={620}
      footer={footer}
      testID="codex-provider-injection-editor"
    >
      <View style={styles.form}>
        <View style={styles.fieldRow}>
          <View style={styles.flexField}>
            <Field label={t("settings.host.codexProviderInjections.nameLabel")}>
              <FormTextInput
                initialValue={name}
                onChangeText={setName}
                placeholder={t("settings.host.codexProviderInjections.namePlaceholder")}
                editable={!saving}
                size={controlSize}
              />
            </Field>
          </View>
          <View style={styles.flexField}>
            <Field label={t("settings.host.codexProviderInjections.providerIdLabel")}>
              <FormTextInput
                initialValue={modelProvider}
                onChangeText={setModelProvider}
                placeholder={t("settings.host.codexProviderInjections.providerIdPlaceholder")}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!saving}
                size={controlSize}
              />
            </Field>
          </View>
        </View>

        <Field label={t("settings.host.codexProviderInjections.baseUrlLabel")}>
          <FormTextInput
            initialValue={baseUrl}
            onChangeText={setBaseUrl}
            placeholder="https://api.example.com/v1"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!saving}
            size={controlSize}
          />
        </Field>

        <View style={styles.formSection}>
          <FormSectionHeading
            title={t("settings.host.codexProviderInjections.modelsSection")}
            hint={t("settings.host.codexProviderInjections.modelsHint")}
          />
          <View style={styles.repeater}>
            {models.map((model, index) => (
              <ModelInputRow
                key={model.id}
                model={model}
                index={index}
                first={index === 0}
                size={controlSize}
                canRemove={models.length > 1}
                disabled={saving}
                onChange={updateModel}
                onRemove={removeModel}
              />
            ))}
            <Button
              variant="ghost"
              size="sm"
              leftIcon={addIcon}
              onPress={addModel}
              disabled={saving}
              style={styles.addRepeaterButton}
            >
              {t("settings.host.codexProviderInjections.addModel")}
            </Button>
          </View>
        </View>

        <View style={styles.formSection}>
          <FormSectionHeading
            title={t("settings.host.codexProviderInjections.credentialsSection")}
            hint={t("settings.host.codexProviderInjections.credentialsHint")}
          />
          <Field label={t("settings.host.codexProviderInjections.envKeyLabel")}>
            <FormTextInput
              initialValue={envKey}
              onChangeText={setEnvKey}
              placeholder="OPENAI_API_KEY"
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!saving}
              size={controlSize}
            />
          </Field>
          <View style={styles.repeater}>
            {environmentVariables.map((variable, index) => (
              <EnvironmentVariableInputRow
                key={variable.id}
                variable={variable}
                first={index === 0}
                size={controlSize}
                disabled={saving}
                onChange={updateEnvironmentVariable}
                onRemove={removeEnvironmentVariable}
              />
            ))}
            <Button
              variant="ghost"
              size="sm"
              leftIcon={addIcon}
              onPress={addEnvironmentVariable}
              disabled={saving}
              style={styles.addRepeaterButton}
            >
              {t("settings.host.codexProviderInjections.addEnvironmentVariable")}
            </Button>
          </View>
        </View>

        <View style={styles.formSection}>
          <FormSectionHeading
            title={t("settings.host.codexProviderInjections.capabilitiesSection")}
          />
          <View style={styles.optionCard}>
            <View style={styles.optionRow}>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>
                  {t("settings.host.codexProviderInjections.openAiAuthLabel")}
                </Text>
                <Text style={styles.optionHint}>
                  {t("settings.host.codexProviderInjections.openAiAuthHint")}
                </Text>
              </View>
              <SegmentedControl
                options={optionalBooleanOptions}
                value={requiresOpenAiAuth}
                onValueChange={setRequiresOpenAiAuth}
                size={optionSize}
              />
            </View>
            <View style={[styles.optionRow, styles.optionRowBorder]}>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>
                  {t("settings.host.codexProviderInjections.websocketsLabel")}
                </Text>
                <Text style={styles.optionHint}>
                  {t("settings.host.codexProviderInjections.websocketsHint")}
                </Text>
              </View>
              <SegmentedControl
                options={optionalBooleanOptions}
                value={supportsWebsockets}
                onValueChange={setSupportsWebsockets}
                size={optionSize}
              />
            </View>
          </View>
        </View>

        <View style={styles.advancedSection}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={advancedAccessibilityState}
            onPress={toggleAdvanced}
            style={styles.advancedTrigger}
          >
            <AdvancedIcon size={14} uniProps={mutedColor} />
            <View style={styles.advancedTriggerText}>
              <Text style={styles.optionTitle}>
                {t("settings.host.codexProviderInjections.additionalDefinitionLabel")}
              </Text>
              <Text style={styles.optionHint}>
                {t("settings.host.codexProviderInjections.additionalDefinitionHint")}
              </Text>
            </View>
          </Pressable>
          {advancedOpen ? (
            <View style={styles.advancedContent}>
              <Field
                label={t("settings.host.codexProviderInjections.providerNameLabel")}
                hint={t("settings.host.codexProviderInjections.providerNameHint")}
              >
                <FormTextInput
                  initialValue={providerName}
                  onChangeText={setProviderName}
                  placeholder={name || t("settings.host.codexProviderInjections.namePlaceholder")}
                  editable={!saving}
                  size={controlSize}
                />
              </Field>
              <FormTextInput
                initialValue={additionalDefinition}
                onChangeText={setAdditionalDefinition}
                multiline
                numberOfLines={5}
                style={styles.codeInput}
                editable={!saving}
                accessibilityLabel={t(
                  "settings.host.codexProviderInjections.additionalDefinitionLabel",
                )}
              />
            </View>
          ) : null}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  pageDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.5),
    marginBottom: theme.spacing[6],
    maxWidth: 620,
  },
  empty: { padding: theme.spacing[6], alignItems: "center", gap: theme.spacing[3] },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, textAlign: "center" },
  row: { minHeight: 68, paddingVertical: theme.spacing[3] },
  modelSummary: {
    marginTop: theme.spacing[1],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  dragging: { backgroundColor: theme.colors.surface2 },
  actions: { flexDirection: "row", alignItems: "center" },
  form: { gap: theme.spacing[6] },
  formSection: { gap: theme.spacing[4] },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  sectionHeadingText: { flex: 1, minWidth: 0, gap: theme.spacing[1] },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  sectionHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: Math.round(theme.fontSize.xs * 1.4),
  },
  fieldRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  flexField: { flexGrow: 1, flexBasis: 0, minWidth: 190 },
  repeater: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
  },
  repeaterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  repeaterRowBorder: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  rowIndex: {
    width: 18,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    textAlign: "center",
  },
  repeaterInput: { flex: 1 },
  envNameInput: { flex: 0.8 },
  envValueInput: { flex: 1.2 },
  addRepeaterButton: {
    alignSelf: "stretch",
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    borderRadius: 0,
  },
  optionCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  optionRowBorder: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  optionText: { flex: 1, minWidth: 220, gap: theme.spacing[1] },
  optionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  optionHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: Math.round(theme.fontSize.xs * 1.4),
  },
  advancedSection: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing[3],
    gap: theme.spacing[3],
  },
  advancedTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  advancedTriggerText: { flex: 1, gap: theme.spacing[1] },
  advancedContent: { gap: theme.spacing[3] },
  codeInput: { minHeight: 120, fontFamily: "monospace", textAlignVertical: "top" },
  error: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
  footer: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  footerButton: { minWidth: 104 },
}));
