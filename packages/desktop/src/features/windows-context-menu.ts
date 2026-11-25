import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { app, ipcMain } from "electron";
import { assertTrustedIpcSender } from "../security/trusted-renderer.js";

const execFileAsync = promisify(execFile);

const DIRECTORY_SHELL_KEY = "HKCU\\Software\\Classes\\Directory\\shell\\Paseo";
const DIRECTORY_COMMAND_KEY = `${DIRECTORY_SHELL_KEY}\\command`;
const BACKGROUND_SHELL_KEY = "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Paseo";
const BACKGROUND_COMMAND_KEY = `${BACKGROUND_SHELL_KEY}\\command`;
const PREFERENCE_FILE_NAME = "windows-context-menu.json";

export interface WindowsContextMenuStatus {
  supported: boolean;
  enabled: boolean;
  registered: boolean;
  executablePath: string | null;
}

export interface RegCommand {
  args: string[];
}

export type RegRunner = (args: string[]) => Promise<{ exitCode: number; stdout: string }>;

const defaultRegRunner: RegRunner = async (args) => {
  try {
    const { stdout } = await execFileAsync("reg.exe", args, {
      windowsHide: true,
      encoding: "utf8",
    });
    return { exitCode: 0, stdout };
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "number"
        ? error.code
        : 1;
    const stdout =
      typeof error === "object" &&
      error !== null &&
      "stdout" in error &&
      typeof error.stdout === "string"
        ? error.stdout
        : "";
    return { exitCode: code, stdout };
  }
};

export function resolveWindowsContextMenuLabel(locale: string): string {
  return locale.trim().toLowerCase().startsWith("zh") ? "用 Paseo 打开" : "Open with Paseo";
}

export function buildWindowsContextMenuRegisterCommands(input: {
  executablePath: string;
  label: string;
}): RegCommand[] {
  const exe = path.win32.normalize(input.executablePath);
  const iconValue = `"${exe}",0`;
  const directoryCommand = `"${exe}" --open-project "%1"`;
  const backgroundCommand = `"${exe}" --open-project "%V"`;

  return [
    { args: ["add", DIRECTORY_SHELL_KEY, "/ve", "/t", "REG_SZ", "/d", input.label, "/f"] },
    { args: ["add", DIRECTORY_SHELL_KEY, "/v", "Icon", "/t", "REG_SZ", "/d", iconValue, "/f"] },
    { args: ["add", DIRECTORY_COMMAND_KEY, "/ve", "/t", "REG_SZ", "/d", directoryCommand, "/f"] },
    { args: ["add", BACKGROUND_SHELL_KEY, "/ve", "/t", "REG_SZ", "/d", input.label, "/f"] },
    { args: ["add", BACKGROUND_SHELL_KEY, "/v", "Icon", "/t", "REG_SZ", "/d", iconValue, "/f"] },
    { args: ["add", BACKGROUND_COMMAND_KEY, "/ve", "/t", "REG_SZ", "/d", backgroundCommand, "/f"] },
  ];
}

export function buildWindowsContextMenuUnregisterCommands(): RegCommand[] {
  return [
    { args: ["delete", DIRECTORY_SHELL_KEY, "/f"] },
    { args: ["delete", BACKGROUND_SHELL_KEY, "/f"] },
  ];
}

export async function isWindowsContextMenuRegistered(
  runner: RegRunner = defaultRegRunner,
): Promise<boolean> {
  const [directoryResult, backgroundResult] = await Promise.all([
    runner(["query", DIRECTORY_COMMAND_KEY, "/ve"]),
    runner(["query", BACKGROUND_COMMAND_KEY, "/ve"]),
  ]);
  return directoryResult.exitCode === 0 && backgroundResult.exitCode === 0;
}

export async function applyWindowsContextMenuRegistration(
  input: {
    enabled: boolean;
    executablePath: string;
    label: string;
  },
  runner: RegRunner = defaultRegRunner,
): Promise<void> {
  if (input.enabled) {
    for (const command of buildWindowsContextMenuRegisterCommands(input)) {
      const result = await runner(command.args);
      if (result.exitCode !== 0) {
        throw new Error(`注册 Windows 右键菜单失败（退出码 ${result.exitCode}）`);
      }
    }
    return;
  }

  for (const command of buildWindowsContextMenuUnregisterCommands()) {
    await runner(command.args);
  }
}

function preferenceFilePath(userDataPath: string): string {
  return path.join(userDataPath, PREFERENCE_FILE_NAME);
}

export function readWindowsContextMenuPreference(userDataPath: string): boolean | null {
  const filePath = preferenceFilePath(userDataPath);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "enabled" in parsed &&
      typeof parsed.enabled === "boolean"
    ) {
      return parsed.enabled;
    }
  } catch {
    // 配置文件损坏时按未设置处理，允许重新写入。
  }
  return null;
}

export function writeWindowsContextMenuPreference(userDataPath: string, enabled: boolean): void {
  const filePath = preferenceFilePath(userDataPath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ enabled }, null, 2), "utf8");
}

function isSupportedWindowsDesktop(): boolean {
  return process.platform === "win32" && app.isPackaged;
}

export async function getWindowsContextMenuStatus(
  runner: RegRunner = defaultRegRunner,
): Promise<WindowsContextMenuStatus> {
  if (!isSupportedWindowsDesktop()) {
    return {
      supported: false,
      enabled: false,
      registered: false,
      executablePath: null,
    };
  }
  const userDataPath = app.getPath("userData");
  const registered = await isWindowsContextMenuRegistered(runner);
  const preference = readWindowsContextMenuPreference(userDataPath);
  return {
    supported: true,
    enabled: preference ?? registered,
    registered,
    executablePath: process.execPath,
  };
}

/**
 * Windows 打包版首次启动或迁移安装路径时，自动保持当前用户的资源管理器右键菜单指向当前 Paseo.exe；
 * 若用户已在设置中手动关闭，则严格保留关闭状态。
 */
export async function syncWindowsContextMenuOnStartup(
  input: {
    platform?: NodeJS.Platform;
    isPackaged?: boolean;
    executablePath?: string;
    locale?: string;
    userDataPath?: string;
  } = {},
  runner: RegRunner = defaultRegRunner,
): Promise<boolean> {
  const platform = input.platform ?? process.platform;
  const isPackaged = input.isPackaged ?? app.isPackaged;
  if (platform !== "win32" || !isPackaged) {
    return false;
  }
  const userDataPath = input.userDataPath ?? app.getPath("userData");
  const preference = readWindowsContextMenuPreference(userDataPath);
  if (preference === false) {
    return false;
  }
  const executablePath = input.executablePath ?? process.execPath;
  const locale = input.locale ?? app.getLocale();
  await applyWindowsContextMenuRegistration(
    {
      enabled: true,
      executablePath,
      label: resolveWindowsContextMenuLabel(locale),
    },
    runner,
  );
  if (preference === null) {
    writeWindowsContextMenuPreference(userDataPath, true);
  }
  return true;
}

export function registerWindowsContextMenuHandlers(): void {
  ipcMain.handle("paseo:windows-context-menu:getStatus", async (event) => {
    assertTrustedIpcSender(event);
    return getWindowsContextMenuStatus();
  });

  ipcMain.handle("paseo:windows-context-menu:setEnabled", async (event, enabled: unknown) => {
    assertTrustedIpcSender(event);
    if (typeof enabled !== "boolean") {
      throw new Error("Invalid windows context menu enabled flag");
    }
    if (!isSupportedWindowsDesktop()) {
      throw new Error("仅打包后的 Windows 桌面客户端支持资源管理器右键菜单注册");
    }
    const userDataPath = app.getPath("userData");
    await applyWindowsContextMenuRegistration({
      enabled,
      executablePath: process.execPath,
      label: resolveWindowsContextMenuLabel(app.getLocale()),
    });
    writeWindowsContextMenuPreference(userDataPath, enabled);
    return getWindowsContextMenuStatus();
  });
}
