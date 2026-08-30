import {
  getDesktopHost,
  type DesktopWindowBridge,
  type DesktopWindowChromeUpdate,
} from "@/desktop/host";

export function getDesktopWindow(): DesktopWindowBridge | null {
  const getter = getDesktopHost()?.window?.getCurrentWindow;
  if (typeof getter !== "function") {
    return null;
  }
  try {
    return getter() ?? null;
  } catch (error) {
    console.error("[桌面窗口] 读取当前窗口桥接失败", error);
    return null;
  }
}

export async function minimizeDesktopWindow(): Promise<void> {
  const minimize = getDesktopWindow()?.minimize;
  if (typeof minimize !== "function") {
    throw new Error("桌面窗口桥接缺少最小化能力");
  }
  await minimize();
}

export async function closeDesktopWindow(): Promise<void> {
  const close = getDesktopWindow()?.close;
  if (typeof close !== "function") {
    throw new Error("桌面窗口桥接缺少关闭能力");
  }
  await close();
}

export async function toggleDesktopMaximize(): Promise<void> {
  const win = getDesktopWindow();
  if (!win || typeof win.toggleMaximize !== "function") {
    throw new Error("桌面窗口桥接缺少最大化切换能力");
  }
  await win.toggleMaximize();
}

export async function isDesktopMaximized(): Promise<boolean> {
  const readMaximized = getDesktopWindow()?.isMaximized;
  if (typeof readMaximized !== "function") {
    throw new Error("桌面窗口桥接缺少最大化状态读取能力");
  }
  return await readMaximized();
}

export async function isDesktopFullscreen(): Promise<boolean> {
  const win = getDesktopWindow();
  if (!win || typeof win.isFullscreen !== "function") {
    return false;
  }
  return await win.isFullscreen();
}

export async function updateDesktopWindowChrome(update: DesktopWindowChromeUpdate): Promise<void> {
  const win = getDesktopWindow();
  if (!win || typeof win.updateChrome !== "function") {
    throw new Error("桌面窗口桥接缺少外观同步能力");
  }

  await win.updateChrome(update);
}
