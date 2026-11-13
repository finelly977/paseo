import { WORKSPACE_OVERLAY_FRACTION } from "@/components/workspace-overlay-size";

export const PLUGIN_CENTER_RAIL_WIDTH = 200;

export interface PluginCenterLayout {
  showRail: boolean;
  twoColumns: boolean;
}

/** 与自适应浮层的80% 窗口尺寸、1px 边框保持一致，首帧不等待内容测量。 */
export function resolvePluginCenterLayout(
  viewportWidth: number,
  compact: boolean,
): PluginCenterLayout {
  const width = compact ? viewportWidth : viewportWidth * WORKSPACE_OVERLAY_FRACTION - 2;
  const showRail = width >= 1000;
  return { showRail, twoColumns: width - (showRail ? PLUGIN_CENTER_RAIL_WIDTH : 0) >= 760 };
}
