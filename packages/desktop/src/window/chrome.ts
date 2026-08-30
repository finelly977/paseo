export type DesktopWindowChromeMode = "native-mac" | "custom-windows" | "custom-linux";

const WINDOW_CHROME_MODE_ARGUMENT_PREFIX = "--paseo-window-chrome-mode=";

function systemWindowChromeMode(platform: NodeJS.Platform): DesktopWindowChromeMode {
  if (platform === "darwin") return "native-mac";
  if (platform === "win32") return "custom-windows";
  if (platform === "linux") return "custom-linux";
  throw new Error(`不支持在当前桌面平台绘制窗口控件：${platform}`);
}

export function resolveDesktopWindowChromeMode(input: {
  platform: NodeJS.Platform;
  override: string | undefined;
  isPackaged: boolean;
}): DesktopWindowChromeMode {
  const override = input.override?.trim().toLowerCase();
  if (!override) return systemWindowChromeMode(input.platform);
  if (input.isPackaged) {
    throw new Error("桌面窗口控件预览只允许在开发版本中使用");
  }
  if (override === "windows") return "custom-windows";
  if (override === "linux") return "custom-linux";
  throw new Error(`无效的桌面窗口控件预览值：${input.override}，只能使用 windows 或 linux`);
}

export function windowChromeModeArgument(mode: DesktopWindowChromeMode): string {
  return `${WINDOW_CHROME_MODE_ARGUMENT_PREFIX}${mode}`;
}
