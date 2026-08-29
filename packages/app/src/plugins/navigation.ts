import { router } from "expo-router";
import type { PluginPanelLocation } from "@getpaseo/plugin";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { buildPluginSurfaceRoute } from "./routes";
import type { PluginNavigation } from "./actions";

export function createPluginNavigation(input: {
  serverId: string;
  workspaceId: string | null;
}): PluginNavigation {
  const { serverId, workspaceId } = input;
  return {
    openSurface(pluginId, surfaceId) {
      router.push(buildPluginSurfaceRoute(serverId, pluginId, { kind: "surface", id: surfaceId }));
    },
    openWorkspacePanel(pluginId, panelId, _location: PluginPanelLocation) {
      if (!workspaceId) throw new Error("当前没有活动工作区");
      navigateToWorkspace({
        serverId,
        workspaceId,
        target: { kind: "plugin", pluginId, panelId, context: "workspace" },
      });
    },
    openAgentPanel(pluginId, panelId, agentId, _location: PluginPanelLocation) {
      if (!workspaceId) throw new Error("当前没有活动工作区");
      navigateToWorkspace({
        serverId,
        workspaceId,
        target: { kind: "plugin", pluginId, panelId, context: "agent", agentId },
      });
    },
  };
}
