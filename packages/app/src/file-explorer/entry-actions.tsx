import { useCallback, useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceEntryMutation } from "@getpaseo/protocol/messages";
import type { ExplorerEntry } from "@/stores/session-store";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { getPanelInstanceAttributes } from "@/panels/panel-instance-attributes";
import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";

type EntryAction =
  | { operation: "create"; parent: string; kind: "file" | "directory" }
  | { operation: "rename"; entry: ExplorerEntry }
  | { operation: "delete"; entry: ExplorerEntry };

interface EntryActionState {
  action: EntryAction;
  name: string;
  error: string | null;
}

export function useExplorerEntryActions(input: {
  client: DaemonClient | null;
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  refresh: () => Promise<unknown>;
  openFile?: (path: string) => void;
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
  const beginCreate = useCallback((parent: string, kind: "file" | "directory") => {
    if (!pendingRef.current)
      setState({ action: { operation: "create", parent, kind }, name: "", error: null });
  }, []);
  const beginRename = useCallback((entry: ExplorerEntry) => {
    if (!pendingRef.current)
      setState({ action: { operation: "rename", entry }, name: entry.name, error: null });
  }, []);
  const beginDelete = useCallback((entry: ExplorerEntry) => {
    if (!pendingRef.current)
      setState({ action: { operation: "delete", entry }, name: entry.name, error: null });
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
  const submit = useCallback(async () => {
    if (!state || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      if (!input.client) throw new Error(t("workspace.terminal.hostDisconnected"));
      const mutation = buildEntryMutation(state);
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
      const path = await input.client.mutateWorkspaceEntry({ cwd: input.workspaceRoot, mutation });
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
      if (state.action.operation === "create" && state.action.kind === "file")
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
        setState({ ...state, error: error instanceof Error ? error.message : String(error) });
    } finally {
      pendingRef.current = false;
      if (active.current) setPending(false);
    }
  }, [input, state, t]);
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

function buildEntryMutation(state: EntryActionState): WorkspaceEntryMutation {
  const { action } = state;
  if (action.operation === "delete")
    return {
      operation: "delete",
      path: action.entry.path,
      expectedModifiedAt: action.entry.modifiedAt,
    };
  const name = state.name.trim();
  if (!name || name === "." || name === ".." || /[\\/]/.test(name) || name.includes("\0"))
    throw new Error("请输入不含路径分隔符的名称");
  if (action.operation === "rename")
    return {
      operation: "rename",
      path: action.entry.path,
      name,
      expectedModifiedAt: action.entry.modifiedAt,
    };
  const path = action.parent === "." ? name : `${action.parent}/${name}`;
  return { operation: "create", path, kind: action.kind };
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

export function ExplorerEntryActionForm({
  controller,
}: {
  controller: ReturnType<typeof useExplorerEntryActions>;
}) {
  const { t } = useTranslation();
  const { state, pending } = controller;
  const handleSubmit = useCallback(() => void controller.submit(), [controller]);
  if (!state)
    return controller.refreshError ? (
      <Alert variant="error" description={controller.refreshError}>
        <Button size="xs" variant="ghost" onPress={controller.close}>
          {t("common.actions.close")}
        </Button>
      </Alert>
    ) : null;
  const action = state.action;
  let title = t("workspace.fileActions.rename");
  if (action.operation === "create")
    title = t(
      action.kind === "file"
        ? "workspace.fileActions.newFile"
        : "workspace.fileActions.newDirectory",
    );
  if (action.operation === "delete") title = t("workspace.fileActions.delete");
  const target = action.operation === "create" ? action.parent : action.entry.path;
  return (
    <View style={styles.form} testID="file-entry-action-form">
      <Text style={styles.label}>{title}</Text>
      <Text style={styles.path} numberOfLines={2}>
        {target}
      </Text>
      {action.operation === "delete" ? (
        <Text style={styles.label}>{t("workspace.fileActions.deleteDescription")}</Text>
      ) : (
        <TextInput
          autoFocus
          value={state.name}
          onChangeText={controller.changeName}
          editable={!pending}
          style={styles.input}
          accessibilityLabel={t("workspace.fileActions.name")}
          testID="file-entry-name"
          onSubmitEditing={handleSubmit}
        />
      )}
      {state.error ? (
        <Alert variant="error" description={state.error} testID="file-entry-action-error" />
      ) : null}
      <View style={styles.buttons}>
        <Button size="xs" variant="ghost" disabled={pending} onPress={controller.close}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          size="xs"
          variant={action.operation === "delete" ? "destructive" : "default"}
          loading={pending}
          disabled={pending}
          onPress={handleSubmit}
          testID="file-entry-submit"
        >
          {title}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: {
    padding: theme.spacing[3],
    gap: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  label: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  path: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  input: {
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.borderRadius.sm,
    padding: theme.spacing[2],
    fontSize: theme.fontSize.sm,
  },
  buttons: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
}));
