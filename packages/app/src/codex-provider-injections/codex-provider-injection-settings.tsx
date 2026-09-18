import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Alert, Text, View, type AccessibilityActionEvent } from "react-native";
import { useTranslation } from "react-i18next";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  getCodexProviderInjectionModels,
  type CodexProviderInjection,
} from "@getpaseo/protocol/messages";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { useCodexProviderInjections } from "./use-codex-provider-injections";

const ThemedPlus = withUnistyles(Plus);
const ThemedGrip = withUnistyles(GripVertical);
const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash = withUnistyles(Trash2);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const addIcon = <ThemedPlus size={ICON_SIZE.sm} uniProps={mutedColor} />;
const dragIcon = <ThemedGrip size={ICON_SIZE.sm} uniProps={mutedColor} />;
const editIcon = <ThemedPencil size={ICON_SIZE.sm} uniProps={mutedColor} />;
const removeIcon = <ThemedTrash size={ICON_SIZE.sm} uniProps={mutedColor} />;

interface EditTarget {
  mode: "create" | "edit";
  injection?: CodexProviderInjection;
}

interface ModelDraft {
  id: number;
  value: string;
}

let nextModelDraftId = 0;

function createModelDraft(value = ""): ModelDraft {
  nextModelDraftId += 1;
  return { id: nextModelDraftId, value };
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
      />
    ),
    [injections, openCreate, reordering, t],
  );

  if (!connected || !isSupported) {
    return (
      <SettingsSection title={t("settings.host.codexProviderInjections.title")}>
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
    );
  }

  return (
    <>
      <SettingsSection title={t("settings.host.codexProviderInjections.title")} trailing={trailing}>
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
      <InjectionEditModal target={editTarget} onClose={closeEditor} onSave={save} />
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

function parseEnv(value: string): Record<string, string> | undefined {
  if (!value.trim()) return undefined;
  const parsed = parseObject(value, "环境变量");
  for (const [key, entry] of Object.entries(parsed)) {
    if (!key || typeof entry !== "string") {
      throw new Error("环境变量必须是字符串键值对");
    }
  }
  return parsed as Record<string, string>;
}

function ModelInputRow({
  model,
  index,
  canRemove,
  disabled,
  onChange,
  onRemove,
}: {
  model: ModelDraft;
  index: number;
  canRemove: boolean;
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
    <View style={styles.modelRow}>
      <FormTextInput
        value={model.value}
        onChangeText={handleChange}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        placeholder={t("settings.host.codexProviderInjections.modelPlaceholder")}
        accessibilityLabel={t("settings.host.codexProviderInjections.modelAccessibilityLabel", {
          index: index + 1,
        })}
        style={styles.modelInput}
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

function InjectionEditModal({
  target,
  onClose,
  onSave,
}: {
  target: EditTarget | null;
  onClose: () => void;
  onSave: (value: Omit<CodexProviderInjection, "id">) => Promise<void>;
}): ReactElement | null {
  const { t } = useTranslation();
  const entry = target?.injection;
  const [name, setName] = useState("");
  const [modelProvider, setModelProvider] = useState("");
  const [models, setModels] = useState<ModelDraft[]>(() => [createModelDraft()]);
  const [definition, setDefinition] = useState("{}");
  const [env, setEnv] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    setName(entry?.name ?? "");
    setModelProvider(entry?.modelProvider ?? "");
    const configuredModels = entry ? getCodexProviderInjectionModels(entry) : [];
    setModels(
      configuredModels.length
        ? configuredModels.map((model) => createModelDraft(model))
        : [createModelDraft()],
    );
    setDefinition(JSON.stringify(entry?.definition ?? {}, null, 2));
    setEnv(entry?.env ? JSON.stringify(entry.env, null, 2) : "");
    setError(null);
  }, [entry, target]);
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
      const parsedDefinition = parseObject(definition, "服务商定义");
      if (Object.keys(parsedDefinition).length === 0) {
        throw new Error("服务商定义不能为空");
      }
      if (Object.hasOwn(parsedDefinition, "model_provider")) {
        throw new Error("服务商定义中不要填写 model_provider，请使用上方标识");
      }
      const parsedEnv = parseEnv(env);
      await onSave({
        name: normalizedName,
        modelProvider: normalizedProvider,
        models: normalizedModels,
        definition: parsedDefinition,
        ...(parsedEnv ? { env: parsedEnv } : {}),
      });
      onClose();
    } catch (submitError) {
      setError(toErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  }, [definition, env, modelProvider, models, name, onClose, onSave, t]);
  const header = useMemo(
    () => ({
      title: t(
        target?.mode === "edit"
          ? "settings.host.codexProviderInjections.editTitle"
          : "settings.host.codexProviderInjections.addTitle",
      ),
    }),
    [t, target?.mode],
  );
  const handleClose = useCallback(() => {
    if (!saving) onClose();
  }, [onClose, saving]);
  const handleSubmit = useCallback(() => void submit(), [submit]);

  if (!target) return null;
  return (
    <AdaptiveModalSheet visible header={header} onClose={handleClose} desktopMaxWidth={720}>
      <View style={styles.form}>
        <View style={styles.formSection}>
          <Text style={styles.sectionTitle}>
            {t("settings.host.codexProviderInjections.basicSection")}
          </Text>
          <View style={styles.basicFields}>
            <View style={styles.flexField}>
              <Field label={t("settings.host.codexProviderInjections.nameLabel")}>
                <FormTextInput
                  initialValue={entry?.name ?? ""}
                  onChangeText={setName}
                  editable={!saving}
                />
              </Field>
            </View>
            <View style={styles.flexField}>
              <Field label={t("settings.host.codexProviderInjections.providerIdLabel")}>
                <FormTextInput
                  initialValue={entry?.modelProvider ?? ""}
                  onChangeText={setModelProvider}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!saving}
                />
              </Field>
            </View>
          </View>
        </View>

        <View style={styles.sectionDivider} />

        <View style={styles.formSection}>
          <View style={styles.sectionHeading}>
            <View style={styles.sectionHeadingText}>
              <Text style={styles.sectionTitle}>
                {t("settings.host.codexProviderInjections.modelsSection")}
              </Text>
              <Text style={styles.sectionHint}>
                {t("settings.host.codexProviderInjections.modelsHint")}
              </Text>
            </View>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={addIcon}
              onPress={addModel}
              disabled={saving}
            >
              {t("settings.host.codexProviderInjections.addModel")}
            </Button>
          </View>
          <View style={styles.modelList}>
            {models.map((model, index) => (
              <ModelInputRow
                key={model.id}
                model={model}
                index={index}
                canRemove={models.length > 1}
                disabled={saving}
                onChange={updateModel}
                onRemove={removeModel}
              />
            ))}
          </View>
        </View>

        <View style={styles.sectionDivider} />

        <View style={styles.formSection}>
          <View style={styles.sectionHeadingText}>
            <Text style={styles.sectionTitle}>
              {t("settings.host.codexProviderInjections.advancedSection")}
            </Text>
            <Text style={styles.sectionHint}>
              {t("settings.host.codexProviderInjections.advancedHint")}
            </Text>
          </View>
          <Field
            label={t("settings.host.codexProviderInjections.definitionLabel")}
            hint={t("settings.host.codexProviderInjections.definitionHint")}
          >
            <FormTextInput
              initialValue={JSON.stringify(entry?.definition ?? {}, null, 2)}
              onChangeText={setDefinition}
              multiline
              numberOfLines={9}
              style={[styles.codeInput, styles.definitionInput]}
              editable={!saving}
            />
          </Field>
          <Field
            label={t("settings.host.codexProviderInjections.envLabel")}
            hint={t("settings.host.codexProviderInjections.envHint")}
          >
            <FormTextInput
              initialValue={entry?.env ? JSON.stringify(entry.env, null, 2) : ""}
              onChangeText={setEnv}
              multiline
              numberOfLines={5}
              style={styles.codeInput}
              editable={!saving}
            />
          </Field>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.footer}>
          <Button
            variant="secondary"
            onPress={onClose}
            disabled={saving}
            style={styles.footerButton}
          >
            {t("common.actions.cancel")}
          </Button>
          <Button onPress={handleSubmit} disabled={saving} style={styles.footerButton}>
            {saving ? t("settings.host.codexProviderInjections.saving") : t("common.actions.save")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
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
  form: { padding: theme.spacing[6], gap: theme.spacing[6] },
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
  sectionDivider: { height: 1, backgroundColor: theme.colors.border },
  basicFields: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[4],
  },
  flexField: { flexGrow: 1, flexBasis: 0, minWidth: 220 },
  modelList: { gap: theme.spacing[2] },
  modelRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  modelInput: { flex: 1 },
  codeInput: { minHeight: 112, fontFamily: "monospace", textAlignVertical: "top" },
  definitionInput: { minHeight: 160 },
  error: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
  footer: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
  footerButton: { minWidth: 104 },
}));
