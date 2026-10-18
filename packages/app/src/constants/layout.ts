import { useUnistyles } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";

export const FOOTER_HEIGHT = 75;

// 主工具栏与两侧栏顶部共用紧凑高度，保留原有按钮和图标大小。
export const HEADER_INNER_HEIGHT = 40;
export const HEADER_INNER_HEIGHT_MOBILE = 56;
export const WORKSPACE_SECONDARY_HEADER_HEIGHT = 36;
// 桌面标签栏单独收紧，不改变文件面板等次级工具栏的高度。
export const WORKSPACE_TAB_BAR_HEIGHT = 32;
export const HEADER_TOP_PADDING_MOBILE = 8;

// 表单与文件预览的宽屏上限。
export const MAX_CONTENT_WIDTH = 820;
// 对话正文、输入框及其附件共用的宽屏上限，比原布局缩窄 10%。
export const MAX_CHAT_CONTENT_WIDTH = 738;
export const COMPACT_FORM_FACTOR_WIDTH = 500;

// 设置浮层独立覆盖工作面，不再占据应用侧栏的宽度预算。
export const SETTINGS_DESKTOP_SIDEBAR_WIDTH = 240;
export const SETTINGS_DESKTOP_MAX_WIDTH = 1120;

// Desktop app constants for macOS traffic light buttons
// These buttons (close/minimize/maximize) overlay the top-left corner
export const DESKTOP_TRAFFIC_LIGHT_WIDTH = 78;
export const DESKTOP_TRAFFIC_LIGHT_HEIGHT = 45;

// Windows/Linux 自绘窗口控件（最小化、最大化、关闭）位于右上角。
export const DESKTOP_WINDOW_CONTROLS_HEIGHT = HEADER_INNER_HEIGHT;

export {
  getIsElectron as getIsElectronRuntime,
  getIsElectronMac as getIsElectronRuntimeMac,
} from "./platform";

/**
 * Reactive hook — re-renders the component when the breakpoint changes.
 * Always use this instead of reading UnistylesRuntime.breakpoint directly.
 */
export function useIsCompactFormFactor(): boolean {
  const { rt } = useUnistyles();
  return rt.breakpoint === "xs" || rt.breakpoint === "sm";
}

// SplitContainer relies on dnd-kit and DOM-backed accessibility helpers.
// Keep that capability distinct from desktop-width layout so touch tablets
// can use the desktop shell without entering web-only code paths.
export function supportsDesktopPaneSplits(): boolean {
  return isWeb;
}
