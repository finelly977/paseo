import {
  MAX_EXPLORER_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_EXPLORER_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from "@/stores/panel-store";

export const MIN_DESKTOP_CENTER_WIDTH = 400;

/**
 * 挂载与可见性独立控制。设置浮层保留背景侧栏，不重建会话投影；
 * 只有允许应用导航的路由才显示它，窄窗口仍依据实际工作面宽度隐藏。
 */
export function resolveDesktopSidebarPresence(input: {
  chromeEnabled: boolean;
  retained: boolean;
  focusModeEnabled: boolean;
  isCompactLayout: boolean;
  agentListOpen: boolean;
  canShareWidth: boolean;
}) {
  const allowed = !input.focusModeEnabled;
  return {
    mounted: (input.chromeEnabled || input.retained) && allowed,
    visible:
      input.chromeEnabled &&
      allowed &&
      !input.isCompactLayout &&
      input.agentListOpen &&
      input.canShareWidth,
  };
}

export function resolveDesktopAppChromeLayout(input: {
  desktopSidebarRendered: boolean;
  hasTopLeftWindowControls: boolean;
  sidebarControlsEnabled: boolean;
}) {
  const sidebarOwnsTopLeft = input.desktopSidebarRendered && input.hasTopLeftWindowControls;
  let sidebarToggleOwner: "none" | "window" | "content" = "none";
  if (input.sidebarControlsEnabled) {
    sidebarToggleOwner = input.hasTopLeftWindowControls ? "window" : "content";
  }
  return {
    sidebarCorners: sidebarOwnsTopLeft ? ("top-left" as const) : ("none" as const),
    contentCorners: sidebarOwnsTopLeft ? ("top-right" as const) : ("both" as const),
    sidebarToggleOwner,
  };
}

function resolveDesktopPanelWidth(input: {
  requestedWidth: number;
  viewportWidth: number;
  minimumWidth: number;
  maximumWidth: number;
}): number {
  "worklet";
  const maximumVisibleWidth = Math.max(
    input.minimumWidth,
    Math.min(input.maximumWidth, input.viewportWidth - MIN_DESKTOP_CENTER_WIDTH),
  );
  return Math.max(input.minimumWidth, Math.min(maximumVisibleWidth, input.requestedWidth));
}

export function resolveDesktopSidebarWidth(input: {
  requestedWidth: number;
  viewportWidth: number;
}): number {
  "worklet";
  return resolveDesktopPanelWidth({
    ...input,
    minimumWidth: MIN_SIDEBAR_WIDTH,
    maximumWidth: MAX_SIDEBAR_WIDTH,
  });
}

export function resolveDesktopExplorerWidth(input: {
  requestedWidth: number;
  viewportWidth: number;
}): number {
  "worklet";
  return resolveDesktopPanelWidth({
    ...input,
    minimumWidth: MIN_EXPLORER_SIDEBAR_WIDTH,
    maximumWidth: MAX_EXPLORER_SIDEBAR_WIDTH,
  });
}

export function resolveDesktopAppContentMinimum(input: {
  isWorkspaceExplorerOpen: boolean;
  requestedExplorerWidth: number;
  viewportWidth: number;
}): number {
  return input.isWorkspaceExplorerOpen
    ? MIN_DESKTOP_CENTER_WIDTH +
        resolveDesktopExplorerWidth({
          requestedWidth: input.requestedExplorerWidth,
          viewportWidth: input.viewportWidth,
        })
    : MIN_DESKTOP_CENTER_WIDTH;
}

export function canDesktopAppSidebarShare(input: {
  contentMinimumWidth: number;
  requestedSidebarWidth: number;
  viewportWidth: number;
}): boolean {
  return (
    input.viewportWidth -
      resolveDesktopSidebarWidth({
        requestedWidth: input.requestedSidebarWidth,
        viewportWidth: input.viewportWidth,
      }) >=
    input.contentMinimumWidth
  );
}
