import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyWindowsContextMenuRegistration,
  buildWindowsContextMenuRegisterCommands,
  buildWindowsContextMenuUnregisterCommands,
  isWindowsContextMenuRegistered,
  readWindowsContextMenuPreference,
  resolveWindowsContextMenuLabel,
  syncWindowsContextMenuOnStartup,
  writeWindowsContextMenuPreference,
} from "./windows-context-menu.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "paseo-win-ctx-menu-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("windows-context-menu", () => {
  it("resolves localized menu label for Chinese and non-Chinese locales", () => {
    expect(resolveWindowsContextMenuLabel("zh-CN")).toBe("用 Paseo 打开");
    expect(resolveWindowsContextMenuLabel("zh-TW")).toBe("用 Paseo 打开");
    expect(resolveWindowsContextMenuLabel("en-US")).toBe("Open with Paseo");
  });

  it("builds HKCU registration commands for both folder icons and folder background", () => {
    const commands = buildWindowsContextMenuRegisterCommands({
      executablePath: "C:\\Users\\demo\\AppData\\Local\\Programs\\Paseo\\Paseo.exe",
      label: "用 Paseo 打开",
    });

    expect(commands.map((c) => c.args)).toEqual([
      [
        "add",
        "HKCU\\Software\\Classes\\Directory\\shell\\Paseo",
        "/ve",
        "/t",
        "REG_SZ",
        "/d",
        "用 Paseo 打开",
        "/f",
      ],
      [
        "add",
        "HKCU\\Software\\Classes\\Directory\\shell\\Paseo",
        "/v",
        "Icon",
        "/t",
        "REG_SZ",
        "/d",
        '"C:\\Users\\demo\\AppData\\Local\\Programs\\Paseo\\Paseo.exe",0',
        "/f",
      ],
      [
        "add",
        "HKCU\\Software\\Classes\\Directory\\shell\\Paseo\\command",
        "/ve",
        "/t",
        "REG_SZ",
        "/d",
        '"C:\\Users\\demo\\AppData\\Local\\Programs\\Paseo\\Paseo.exe" --open-project "%1"',
        "/f",
      ],
      [
        "add",
        "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Paseo",
        "/ve",
        "/t",
        "REG_SZ",
        "/d",
        "用 Paseo 打开",
        "/f",
      ],
      [
        "add",
        "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Paseo",
        "/v",
        "Icon",
        "/t",
        "REG_SZ",
        "/d",
        '"C:\\Users\\demo\\AppData\\Local\\Programs\\Paseo\\Paseo.exe",0',
        "/f",
      ],
      [
        "add",
        "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Paseo\\command",
        "/ve",
        "/t",
        "REG_SZ",
        "/d",
        '"C:\\Users\\demo\\AppData\\Local\\Programs\\Paseo\\Paseo.exe" --open-project "%V"',
        "/f",
      ],
    ]);

    expect(buildWindowsContextMenuUnregisterCommands().map((c) => c.args)).toEqual([
      ["delete", "HKCU\\Software\\Classes\\Directory\\shell\\Paseo", "/f"],
      ["delete", "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Paseo", "/f"],
    ]);
  });

  it("checks both folder and background registry keys when querying status", async () => {
    const bothPresent = vi.fn(async () => ({ exitCode: 0, stdout: "" }));
    expect(await isWindowsContextMenuRegistered(bothPresent)).toBe(true);
    expect(bothPresent).toHaveBeenCalledTimes(2);

    const partial = vi.fn(async (args: string[]) => ({
      exitCode: args[1]?.includes("Background") ? 1 : 0,
      stdout: "",
    }));
    expect(await isWindowsContextMenuRegistered(partial)).toBe(false);
  });

  it("registers on packaged Windows startup by default and respects explicit opt-out", async () => {
    const userDataPath = createTempDir();
    const runner = vi.fn(async () => ({ exitCode: 0, stdout: "" }));

    const synced = await syncWindowsContextMenuOnStartup(
      {
        platform: "win32",
        isPackaged: true,
        executablePath: "C:\\Program Files\\Paseo\\Paseo.exe",
        locale: "zh-CN",
        userDataPath,
      },
      runner,
    );
    expect(synced).toBe(true);
    expect(runner).toHaveBeenCalledTimes(6);
    expect(readWindowsContextMenuPreference(userDataPath)).toBe(true);

    // 用户显式关闭后，下次启动不再重新注册。
    writeWindowsContextMenuPreference(userDataPath, false);
    runner.mockClear();
    const skipped = await syncWindowsContextMenuOnStartup(
      {
        platform: "win32",
        isPackaged: true,
        executablePath: "C:\\Program Files\\Paseo\\Paseo.exe",
        locale: "zh-CN",
        userDataPath,
      },
      runner,
    );
    expect(skipped).toBe(false);
    expect(runner).not.toHaveBeenCalled();

    // 非打包开发环境或非 Windows 平台不写入注册表。
    const unpackaged = await syncWindowsContextMenuOnStartup(
      {
        platform: "win32",
        isPackaged: false,
        executablePath: "C:\\electron.exe",
        locale: "zh-CN",
        userDataPath: createTempDir(),
      },
      runner,
    );
    expect(unpackaged).toBe(false);
    expect(runner).not.toHaveBeenCalled();
  });

  it("deletes both keys when disabled via applyWindowsContextMenuRegistration", async () => {
    const runner = vi.fn(async () => ({ exitCode: 0, stdout: "" }));
    await applyWindowsContextMenuRegistration(
      {
        enabled: false,
        executablePath: "C:\\Paseo\\Paseo.exe",
        label: "用 Paseo 打开",
      },
      runner,
    );
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls.map((call) => call[0])).toEqual([
      ["delete", "HKCU\\Software\\Classes\\Directory\\shell\\Paseo", "/f"],
      ["delete", "HKCU\\Software\\Classes\\Directory\\Background\\shell\\Paseo", "/f"],
    ]);
  });
});
