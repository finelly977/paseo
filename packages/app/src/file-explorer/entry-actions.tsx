import { useCallback, useEffect, useRef, useState } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ExplorerEntry } from "@/stores/session-store";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { getPanelInstanceAttributes } from "@/panels/panel-instance-attributes";
import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { confirmDialog } from "@/utils/confirm-dialog";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { treeRowPaddingLeft } from "@/components/tree-primitives";
import { buildEntryMutation, renameNameSelection, type EntryActionState } from "./entry-edit";
import type { Theme } from "@/styles/theme";
import { Folder } from "lucide-react-native";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { isWeb } from "@/constants/platform";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedFolder = withUnistyles(Folder);
const spinnerColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function useExplorerEntryActions(input: {
  client: DaemonClient | null;
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  refresh: () => Promise<unknown>;
  openFile?: (path: string) => void;
  expandDirectory?: (path: string) => void;
  selectEntry?: (path: string | null) => void;
}) {
  const [state, setState] = useState<EntryActionState | null>(null);
  const [pending, setPending] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const { t } = useTranslation();
  const expandDirectory = input.expandDirectory;
  const beginCreate = useCallback(
    (parent: string, kind: "file" | "directory") => {
      if (!pendingRef.current) {
        expandDirectory?.(parent);
        setState({ action: { operation: "create", parent, kind }, name: "", error: null });
      }
    },
    [expandDirectory],
  );
  const beginRename = useCallback((entry: ExplorerEntry) => {
    if (!pendingRef.current)
      setState({ action: { operation: "rename", entry }, name: entry.name, error: null });
  }, []);
  const close = useCallback(() => {
    if (!pendingRef.current) {
      if (!active.current) return;
      setState(null);
      setRefreshError(null);
    }
  }, []);
  const changeName = useCallback(
    (name: string) => setState((current) => current && { ...current, name, error: null }),
    [],
  );
  const execute = useCallback(
    async (submitted: EntryActionState) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setState(submitted);
      setPending(true);
      try {
        if (!input.client) throw new Error(t("workspace.terminal.hostDisconnected"));
        const mutation = buildEntryMutation(submitted);
        const affectedTabs = matchingOpenFileTabs(input, mutation.path);
        if (mutation.operation !== "create") {
          for (const tab of affectedTabs) {
            if (
              getPanelInstanceAttributes({
                serverId: input.serverId,
                workspaceId: tab.workspaceId,
                tabId: tab.id,
              }).modified
            ) {
              throw new Error(t("workspace.fileActions.saveBeforeMutation"));
            }
          }
        }
        const path = await input.client.mutateWorkspaceEntry({
          cwd: input.workspaceRoot,
          mutation,
        });
        input.selectEntry?.(mutation.operation === "delete" ? null : path);
        const layout = useWorkspaceLayoutStore.getState();
        for (const tab of affectedTabs) {
          if (mutation.operation === "delete") layout.closeTab(tab.workspaceKey, tab.id);
          if (mutation.operation === "rename") {
            const absolutePath = buildAbsoluteExplorerPath({
              workspaceRoot: input.workspaceRoot,
              entryPath: path,
            });
            layout.retargetTab(tab.workspaceKey, tab.id, {
              ...tab.target,
              path: absolutePath + tab.suffix,
            });
          }
        }
        if (!active.current) return;
        setState(null);
        if (submitted.action.operation === "create" && submitted.action.kind === "file")
          input.openFile?.(path);
        try {
          await input.refresh();
        } catch (error) {
          console.error("文件操作成功，但刷新列表失败", error);
          setRefreshError(t("workspace.fileActions.refreshFailed"));
        }
      } catch (error) {
        console.error("工作区文件操作失败", error);
        if (active.current)
          setState({ ...submitted, error: error instanceof Error ? error.message : String(error) });
      } finally {
        pendingRef.current = false;
        if (active.current) setPending(false);
      }
    },
    [input, t],
  );
  const submit = useCallback(async () => {
    if (!state) return;
    if (state.action.operation === "rename" && state.name === state.action.entry.name) {
      close();
      return;
    }
    await execute(state);
  }, [state, execute, close]);
  const beginDelete = useCallback(
    async (entry: ExplorerEntry) => {
      if (pendingRef.current) return;
      const deletion: EntryActionState = {
        action: { operation: "delete", entry },
        name: entry.name,
        error: null,
      };
      pendingRef.current = true;
      setPending(true);
      try {
        const confirmed = await confirmDialog({
          title: t("workspace.fileActions.delete"),
          message: `${entry.path}\n\n${t("workspace.fileActions.deleteDescription")}`,
          confirmLabel: t("workspace.fileActions.delete"),
          cancelLabel: t("common.actions.cancel"),
          destructive: true,
        });
        pendingRef.current = false;
        if (confirmed && active.current) await execute(deletion);
      } catch (error) {
        console.error("确认删除工作区文件失败", error);
        if (active.current)
          setState({ ...deletion, error: error instanceof Error ? error.message : String(error) });
      } finally {
        pendingRef.current = false;
        if (active.current) setPending(false);
      }
    },
    [execute, t],
  );
  return {
    state,
    pending,
    refreshError,
    beginCreate,
    beginRename,
    beginDelete,
    close,
    changeName,
    submit,
  };
}

function matchingOpenFileTabs(
  input: { serverId: string; workspaceId?: string | null; workspaceRoot: string },
  entryPath: string,
) {
  if (!input.workspaceId) return [];
  const workspaceId = input.workspaceId;
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId: input.serverId, workspaceId });
  if (!workspaceKey) throw new Error("工作区标识无效");
  const absolutePath = buildAbsoluteExplorerPath({
    workspaceRoot: input.workspaceRoot,
    entryPath,
  }).replaceAll("\\", "/");
  const tabs = useWorkspaceLayoutStore.getState().getWorkspaceTabs(workspaceKey);
  return tabs.flatMap((tab) => {
    if (tab.target.kind !== "file") return [];
    const filePath = buildAbsoluteExplorerPath({
      workspaceRoot: input.workspaceRoot,
      entryPath: tab.target.path,
    }).replaceAll("\\", "/");
    if (filePath !== absolutePath && !filePath.startsWith(`${absolutePath}/`)) return [];
    return [
      {
        id: tab.tabId,
        target: tab.target,
        suffix: filePath.slice(absolutePath.length),
        workspaceKey,
        workspaceId,
      },
    ];
  });
}

export function ExplorerEntryActionFeedback({
  controller,
}: {
  controller: ReturnType<typeof useExplorerEntryActions>;
}) {
  const { t } = useTranslation();
  const handleRetry = useCallback(() => void controller.submit(), [controller]);
  if (controller.pending && controller.state?.action.operation === "delete") {
    return (
      <View style={styles.editorRow}>
        <ThemedLoadingSpinner size={12} uniProps={spinnerColor} />
        <Text style={styles.progress}>正在删除 {controller.state.name}</Text>
      </View>
    );
  }
  const error =
    controller.state?.action.operation === "delete"
      ? controller.state.error
      : controller.refreshError;
  if (!error) return null;
  return (
    <Alert variant="error" description={error} testID="file-entry-action-error">
      <Button size="xs" variant="ghost" disabled={controller.pending} onPress={controller.close}>
        {t("common.actions.close")}
      </Button>
      {controller.state?.action.operation === "delete" ? (
        <Button size="xs" variant="outline" loading={controller.pending} onPress={handleRetry}>
          {t("common.actions.retry")}
        </Button>
      ) : null}
    </Alert>
  );
}

export function ExplorerEntryInlineEditor({
  controller,
  depth,
}: {
  controller: ReturnType<typeof useExplorerEntryActions>;
  depth: number;
}) {
  const { t } = useTranslation();
  const { state, pending } = controller;
  const [selection, setSelection] = useState(() => renameNameSelection(state?.name ?? ""));
  const inputRef = useRef<TextInput>(null);
  const canceled = useRef(false);
  const inputError = state?.error;
  useEffect(() => {
    if (inputError && !pending) inputRef.current?.focus();
  }, [inputError, pending]);
  const handleSubmit = useCallback(() => void controller.submit(), [controller]);
  const handleBlur = useCallback(() => {
    if (canceled.current || pending || state?.error) return;
    if (!state?.name.trim()) controller.close();
    else void controller.submit();
  }, [controller, pending, state]);
  const handleSelectionChange = useCallback<NonNullable<TextInputProps["onSelectionChange"]>>(
    (event) => setSelection(event.nativeEvent.selection),
    [],
  );
  const handleKeyPress = useCallback<NonNullable<TextInputProps["onKeyPress"]>>(
    (event) => {
      if (event.nativeEvent.key === "Escape") {
        event.stopPropagation();
        canceled.current = true;
        controller.close();
      }
    },
    [controller],
  );
  if (!state || state.action.operation === "delete") return null;
  const isDirectory =
    state.action.operation === "create"
      ? state.action.kind === "directory"
      : state.action.entry.kind === "directory";
  return (
    <View
      style={[styles.editor, { paddingLeft: treeRowPaddingLeft(depth) }]}
      testID="file-entry-inline-editor"
    >
      <View style={styles.editorRow}>
        {isDirectory ? (
          <ThemedFolder size={16} uniProps={spinnerColor} />
        ) : (
          <MaterialFileIcon fileName={state.name} size={16} />
        )}
        <TextInput
          ref={inputRef}
          autoFocus
          blurOnSubmit={false}
          value={state.name}
          onChangeText={controller.changeName}
          editable={!pending}
          style={[styles.input, state.error && styles.inputError]}
          accessibilityLabel={t("workspace.fileActions.name")}
          testID="file-entry-name"
          onSubmitEditing={handleSubmit}
          selection={selection}
          onSelectionChange={handleSelectionChange}
          onBlur={handleBlur}
          onKeyPress={handleKeyPress}
        />
        {pending ? <ThemedLoadingSpinner size={12} uniProps={spinnerColor} /> : null}
      </View>
      {state.error ? (
        <Text style={styles.error} testID="file-entry-action-error">
          {state.error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  editor: { paddingRight: theme.spacing[2] },
  editorRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
    paddingTop: theme.spacing[1],
  },
  progress: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  input: {
    ...(isWeb ? { outlineWidth: 0 } : {}),
    flex: 1,
    height: 28,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.accent,
    borderWidth: 1,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 0,
    fontSize: theme.fontSize.sm,
  },
  inputError: { borderColor: theme.colors.destructive },
}));
