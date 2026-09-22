import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSidebarWorkspacePinStore } from "@/stores/sidebar-workspace-pin-store";

export type ToggleSidebarWorkspacePin = (workspace: SidebarWorkspaceEntry) => void;
export type SidebarWorkspacePinScope = "global" | "project";

export function useSidebarWorkspacePinController(
  scope: SidebarWorkspacePinScope = "global",
): ToggleSidebarWorkspacePin {
  const { t } = useTranslation();
  const toast = useToast();
  const pendingWorkspaceKeysRef = useRef(new Set<string>());
  const setProjectPinned = useSidebarWorkspacePinStore((state) => state.setProjectPinned);
  const mutation = useMutation({
    mutationFn: async ({
      workspace,
      pinned,
      targetScope,
    }: {
      workspace: SidebarWorkspaceEntry;
      pinned: boolean;
      targetScope: SidebarWorkspacePinScope;
    }) => {
      if (targetScope === "project") {
        if (workspace.pinnedAt) {
          const client = getHostRuntimeStore().getClient(workspace.serverId);
          if (!client) {
            throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
          }
          await client.setWorkspacePinned(workspace.workspaceId, false);
        }
        setProjectPinned(workspace.workspaceKey, pinned);
        return;
      }
      const client = getHostRuntimeStore().getClient(workspace.serverId);
      if (!client) {
        throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      }
      await client.setWorkspacePinned(workspace.workspaceId, pinned);
      if (pinned) {
        setProjectPinned(workspace.workspaceKey, false);
      }
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t("sidebar.workspace.toasts.hostDisconnected"),
      );
    },
    onSettled: (_data, _error, { workspace }) => {
      pendingWorkspaceKeysRef.current.delete(workspace.workspaceKey);
    },
  });
  const mutate = mutation.mutate;

  return useCallback(
    (workspace: SidebarWorkspaceEntry) => {
      if (pendingWorkspaceKeysRef.current.has(workspace.workspaceKey)) {
        return;
      }
      pendingWorkspaceKeysRef.current.add(workspace.workspaceKey);
      const projectPinnedAt =
        useSidebarWorkspacePinStore.getState().projectPinnedAtByWorkspaceKey[
          workspace.workspaceKey
        ];
      mutate({
        workspace,
        pinned: scope === "global" ? workspace.pinnedAt == null : !projectPinnedAt,
        targetScope: scope,
      });
    },
    [mutate, scope],
  );
}
