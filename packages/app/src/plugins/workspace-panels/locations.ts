import type { PluginPanelLocation, PluginWorkspacePanelContribution } from "@getpaseo/plugin";

const DEFAULT_LOCATIONS: readonly PluginPanelLocation[] = ["workspace"];

export function getPluginPanelLocations(
  panel: PluginWorkspacePanelContribution,
): readonly PluginPanelLocation[] {
  return panel.locations ?? DEFAULT_LOCATIONS;
}

export function resolvePluginPanelOpenLocation(
  panel: PluginWorkspacePanelContribution,
  requested?: PluginPanelLocation,
): PluginPanelLocation {
  const locations = getPluginPanelLocations(panel);
  const location = requested ?? (locations.includes("workspace") ? "workspace" : locations[0]);
  if (!location || !locations.includes(location)) {
    throw new Error(`插件面板“${panel.id}”不支持打开到“${requested ?? "任意位置"}”`);
  }
  return location;
}
