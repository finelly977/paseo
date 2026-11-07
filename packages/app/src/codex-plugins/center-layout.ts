import { SPACING } from "@/styles/theme";

export const PLUGIN_CENTER_MAX_WIDTH = 1280;
export const PLUGIN_CENTER_RAIL_WIDTH = 200;

export interface PluginCenterLayout {
  showRail: boolean;
  twoColumns: boolean;
}

/** 与自适应浮层的外边距、1px 边框保持一致，首帧不等待内容测量。 */
export function resolvePluginCenterLayout(
  viewportWidth: number,
  compact: boolean,
): PluginCenterLayout {
  const width = compact
    ? viewportWidth
    : Math.min(PLUGIN_CENTER_MAX_WIDTH, viewportWidth - 2 * SPACING[6]) - 2;
  const showRail = width >= 1000;
  return { showRail, twoColumns: width - (showRail ? PLUGIN_CENTER_RAIL_WIDTH : 0) >= 760 };
}
