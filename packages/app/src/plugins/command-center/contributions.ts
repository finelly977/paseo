import type { PluginClientStateSource } from "@getpaseo/plugin/host";
import type { CommandCenterContribution } from "@/command-center/contributions";
import { getCommandCenterIcon } from "@/command-center/icon";
import {
  createPluginAgentActionContext,
  createPluginCapabilities,
  createPluginWorkspaceActionContext,
  type PluginNavigation,
} from "../actions";
import { resolvePluginIcon } from "../icons";
import type { PluginSurfaceRuntime } from "../surface-runtime";
import type { InstalledPlugin } from "../types";

export interface PluginCommandCenterSource {
  plugins: readonly InstalledPlugin[];
  runtime(pluginId: string): PluginSurfaceRuntime;
  state: PluginClientStateSource;
  workspaceId: string | null;
  agentId: string | null;
  navigation: PluginNavigation;
  reportError(error: unknown): void;
}

export function buildPluginCommandCenterContributions(
  source: PluginCommandCenterSource,
): CommandCenterContribution[] {
  const contributions: CommandCenterContribution[] = [];
  for (const plugin of source.plugins) {
    const runtime = source.runtime(plugin.id);
    const common = createPluginCapabilities(plugin, runtime, source.navigation);
    for (const [rank, item] of plugin.commandCenterItems.entries()) {
      if (item.context === "workspace" && !source.workspaceId) continue;
      if (item.context === "agent" && (!source.workspaceId || !source.agentId)) continue;
      const run = async () => {
        try {
          if (item.context === "global") {
            await item.onSelect({ context: "global", ...common });
            return;
          }
          if (item.context === "workspace") {
            const workspaceId = source.workspaceId;
            if (!workspaceId) return;
            const context = createPluginWorkspaceActionContext({
              plugin,
              runtime,
              navigation: source.navigation,
              state: source.state,
              workspaceId,
            });
            if (!context) return;
            await item.onSelect(context);
            return;
          }
          const workspaceId = source.workspaceId;
          const agentId = source.agentId;
          if (!workspaceId || !agentId) return;
          const context = createPluginAgentActionContext({
            plugin,
            runtime,
            navigation: source.navigation,
            state: source.state,
            workspaceId,
            agentId,
          });
          if (!context) return;
          await item.onSelect(context);
        } catch (error) {
          source.reportError(error);
        }
      };
      contributions.push({
        id: `${plugin.id}:${item.id}`,
        group: `plugin:${plugin.id}`,
        groupRank: 5,
        rank,
        keywords: item.keywords ?? [],
        visibility: "always",
        presentation: {
          kind: "action",
          title: item.title,
          sectionTitle: plugin.id,
          icon: getCommandCenterIcon(resolvePluginIcon(item.icon)),
        },
        run,
      });
    }
  }
  return contributions;
}
