import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { ipcMain } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DESKTOP_SETTINGS } from "../settings/desktop-settings";
import { getBundledCliShimPath } from "../integrations/cli-install";
import {
  createDaemonCommandHandlers,
  type DaemonStartupDeps,
  type DesktopDaemonStatus,
  prestartDesktopDaemon,
  registerDaemonManager,
} from "./daemon-manager";

const mocks = vi.hoisted(() => ({
  paseoHome: "/tmp/paseo-desktop-daemon-manager-test-home",
  settings: {
    releaseChannel: "stable",
    daemon: {
      manageBuiltInDaemon: true,
      keepRunningAfterQuit: true,
    },
  },
  runExternalCliJsonCommand: vi.fn(),
  runExternalCliTextCommand: vi.fn(),
  createNodeEntrypointInvocation: vi.fn(() => ({
    command: "node",
    args: [],
    env: {},
  })),
  spawnProcess: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  appLogPath: "/tmp/paseo-desktop-daemon-manager-test-main.log",
  getElectronLogFile: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/paseo-user-data"),
    getVersion: vi.fn(() => "1.2.3"),
    isPackaged: true,
  },
  ipcMain: { handle: vi.fn() },
  powerMonitor: { getSystemIdleTime: vi.fn(() => 0) },
}));

vi.mock("electron-log/main", () => ({
  default: {
    info: mocks.logInfo,
    error: mocks.logError,
    transports: {
      file: {
        getFile: mocks.getElectronLogFile,
      },
    },
  },
}));

vi.mock("@getpaseo/server", () => ({
  resolvePaseoHome: vi.fn(() => mocks.paseoHome),
  spawnProcess: mocks.spawnProcess,
}));

vi.mock("../settings/desktop-settings-electron.js", () => ({
  getDesktopSettingsStore: () => ({
    get: async () => mocks.settings,
    patch: vi.fn(),
    migrateLegacyRendererSettings: vi.fn(),
  }),
}));

vi.mock("./runtime-paths.js", () => ({
  createNodeEntrypointInvocation: mocks.createNodeEntrypointInvocation,
  resolveDaemonRunnerEntrypoint: vi.fn(() => ({
    entryPath: "/tmp/daemon.js",
    execArgv: [],
  })),
}));

vi.mock("./cli/external.js", () => ({
  runExternalCliJsonCommand: mocks.runExternalCliJsonCommand,
  runExternalCliTextCommand: mocks.runExternalCliTextCommand,
}));

function desktopSettingsWithManagement(enabled: boolean) {
  return {
    ...DEFAULT_DESKTOP_SETTINGS,
    daemon: {
      ...DEFAULT_DESKTOP_SETTINGS.daemon,
      manageBuiltInDaemon: enabled,
    },
  };
}

type MockChildProcess = EventEmitter & {
  pid: number;
  spawnfile: string;
  spawnargs: string[];
  unref: ReturnType<typeof vi.fn>;
};

function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.pid = 1234;
  child.spawnfile = "node";
  child.spawnargs = ["node", "daemon.js"];
  child.unref = vi.fn();
  return child;
}

function scheduleFailedStartup(child: MockChildProcess): void {
  setImmediate(() => {
    child.emit("exit", 1, null);
  });
}

describe("daemon-manager commands", () => {
  beforeEach(() => {
    mocks.settings = DEFAULT_DESKTOP_SETTINGS;
    mocks.runExternalCliJsonCommand.mockReset();
    mocks.runExternalCliTextCommand.mockReset();
    mocks.createNodeEntrypointInvocation.mockReset();
    mocks.createNodeEntrypointInvocation.mockReturnValue({ command: "node", args: [], env: {} });
    mocks.spawnProcess.mockReset();
    mocks.logInfo.mockReset();
    mocks.logError.mockReset();
    mocks.getElectronLogFile.mockReset();
    mocks.getElectronLogFile.mockReturnValue({ path: mocks.appLogPath });
    vi.mocked(ipcMain.handle).mockReset();
    rmSync(mocks.paseoHome, { recursive: true, force: true });
    rmSync(mocks.appLogPath, { force: true });
  });

  afterEach(() => {
    rmSync(mocks.paseoHome, { recursive: true, force: true });
    rmSync(mocks.appLogPath, { force: true });
  });

  it("refuses start and restart while built-in daemon management is disabled", async () => {
    mocks.settings = desktopSettingsWithManagement(false);
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.start_desktop_daemon()).rejects.toThrow(
      "Built-in daemon management is disabled.",
    );
    await expect(handlers.restart_desktop_daemon()).rejects.toThrow(
      "Built-in daemon management is disabled.",
    );

    expect(mocks.runExternalCliJsonCommand).not.toHaveBeenCalled();
    expect(mocks.spawnProcess).not.toHaveBeenCalled();
  });

  it("skips launch prestart while built-in daemon management is disabled", async () => {
    mocks.settings = desktopSettingsWithManagement(false);

    await expect(prestartDesktopDaemon()).resolves.toBeUndefined();

    expect(mocks.runExternalCliJsonCommand).not.toHaveBeenCalled();
    expect(mocks.spawnProcess).not.toHaveBeenCalled();
  });

  it("skips launch prestart when a custom local daemon is configured", async () => {
    vi.stubEnv("EXPO_PUBLIC_LOCAL_DAEMON", "127.0.0.1:7788");
    try {
      await expect(prestartDesktopDaemon()).resolves.toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }

    expect(mocks.runExternalCliJsonCommand).not.toHaveBeenCalled();
    expect(mocks.spawnProcess).not.toHaveBeenCalled();
  });

  it("keeps stop callable while built-in daemon management is disabled", async () => {
    mocks.settings = desktopSettingsWithManagement(false);
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stopped",
      serverId: "",
    });
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.stop_desktop_daemon()).resolves.toEqual({
      serverId: "",
      status: "stopped",
      listen: null,
      hostname: null,
      pid: null,
      home: mocks.paseoHome,
      version: null,
      desktopManaged: false,
      error: null,
    });

    expect(mocks.runExternalCliJsonCommand).toHaveBeenCalledWith(["daemon", "status", "--json"]);
  });

  it("routes running desktop daemon stops through external CLI daemon stop", async () => {
    mocks.runExternalCliJsonCommand
      .mockResolvedValueOnce({
        localDaemon: "running",
        serverId: "server-1",
        pid: 4242,
        listen: "127.0.0.1:6767",
        desktopManaged: true,
      })
      .mockResolvedValueOnce({ action: "stopped" })
      .mockResolvedValueOnce({
        localDaemon: "stopped",
        serverId: "",
      });
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.stop_desktop_daemon()).resolves.toEqual({
      serverId: "",
      status: "stopped",
      listen: null,
      hostname: null,
      pid: null,
      home: mocks.paseoHome,
      version: null,
      desktopManaged: false,
      error: null,
    });

    expect(mocks.runExternalCliJsonCommand).toHaveBeenNthCalledWith(1, [
      "daemon",
      "status",
      "--json",
    ]);
    expect(mocks.runExternalCliJsonCommand).toHaveBeenNthCalledWith(2, [
      "daemon",
      "stop",
      "--json",
      "--timeout",
      "5",
      "--force",
      "--kill-timeout",
      "5",
    ]);
    expect(mocks.runExternalCliJsonCommand).toHaveBeenNthCalledWith(3, [
      "daemon",
      "status",
      "--json",
    ]);
    expect(mocks.logInfo).toHaveBeenCalledWith(
      "[desktop daemon]",
      "desktop daemon stop requested",
      expect.objectContaining({
        reason: "manual_ipc",
        statusBefore: expect.objectContaining({
          status: "running",
          pid: 4242,
          serverId: "server-1",
          desktopManaged: true,
        }),
      }),
    );
    expect(mocks.logInfo).toHaveBeenCalledWith(
      "[desktop daemon]",
      "desktop daemon stop completed",
      expect.objectContaining({
        reason: "manual_ipc",
        cliResult: { action: "stopped" },
        statusAfter: expect.objectContaining({
          status: "stopped",
          serverId: null,
        }),
      }),
    );
  });

  it("routes stale reachable desktop daemon stops through external CLI daemon stop", async () => {
    mocks.runExternalCliJsonCommand
      .mockResolvedValueOnce({
        localDaemon: "stale_pid",
        connectedDaemon: "reachable",
        serverId: "server-1",
        pid: 7675,
        listen: "127.0.0.1:6767",
        daemonVersion: "1.2.2",
        desktopManaged: true,
      })
      .mockResolvedValueOnce({ action: "stopped" })
      .mockResolvedValueOnce({
        localDaemon: "stopped",
        connectedDaemon: "unreachable",
        serverId: "",
      });
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.stop_desktop_daemon()).resolves.toEqual({
      serverId: "",
      status: "stopped",
      listen: null,
      hostname: null,
      pid: null,
      home: mocks.paseoHome,
      version: null,
      desktopManaged: false,
      error: null,
    });

    expect(mocks.runExternalCliJsonCommand).toHaveBeenNthCalledWith(2, [
      "daemon",
      "stop",
      "--json",
      "--timeout",
      "5",
      "--force",
      "--kill-timeout",
      "5",
    ]);
  });

  it("records the renderer stop reason when stopping the desktop daemon", async () => {
    mocks.runExternalCliJsonCommand
      .mockResolvedValueOnce({
        localDaemon: "running",
        serverId: "server-1",
        pid: 4242,
        listen: "127.0.0.1:6767",
        desktopManaged: true,
      })
      .mockResolvedValueOnce({ action: "stopped", reason: "lifecycle_shutdown_rpc" })
      .mockResolvedValueOnce({
        localDaemon: "stopped",
        serverId: "",
      });
    const handlers = createDaemonCommandHandlers();

    await handlers.stop_desktop_daemon({ reason: "host_remove" });

    expect(mocks.logInfo).toHaveBeenCalledWith(
      "[desktop daemon]",
      "desktop daemon stop requested",
      expect.objectContaining({ reason: "host_remove" }),
    );
    expect(mocks.logInfo).toHaveBeenCalledWith(
      "[desktop daemon]",
      "desktop daemon stop completed",
      expect.objectContaining({
        reason: "host_remove",
        cliResult: { action: "stopped", reason: "lifecycle_shutdown_rpc" },
      }),
    );
  });

  function status(overrides: Partial<DesktopDaemonStatus> = {}): DesktopDaemonStatus {
    return {
      serverId: "server-1",
      status: "running",
      listen: "127.0.0.1:6767",
      hostname: "dev-host",
      pid: 4242,
      home: mocks.paseoHome,
      version: "1.2.3",
      desktopManaged: true,
      error: null,
      ...overrides,
    };
  }

  function startup(...responses: Array<DesktopDaemonStatus | Error>) {
    let calls = 0;
    const deps: DaemonStartupDeps = {
      async resolveReadiness() {
        calls += 1;
        const response = responses.shift();
        if (!response) throw new Error("未提供就绪检查响应");
        if (response instanceof Error) throw response;
        return response;
      },
    };
    return { deps, calls: () => calls };
  }

  it("复用已确认可连接且版本一致的服务，不启动完整诊断", async () => {
    const fake = startup(status({ pid: null }));
    await expect(createDaemonCommandHandlers(fake.deps).start_desktop_daemon()).resolves.toEqual(
      status({ pid: null }),
    );
    expect(fake.calls()).toBe(1);
    expect(mocks.spawnProcess).not.toHaveBeenCalled();
    expect(mocks.runExternalCliJsonCommand).not.toHaveBeenCalled();
  });

  it("托管服务版本不同仍通过原停止流程重启", async () => {
    const fake = startup(status({ version: "1.2.2" }), status());
    mocks.runExternalCliJsonCommand
      .mockResolvedValueOnce({
        localDaemon: "running",
        connectedDaemon: "reachable",
        serverId: "server-1",
        pid: 4242,
        listen: "127.0.0.1:6767",
        desktopManaged: true,
      })
      .mockResolvedValueOnce({ action: "stopped" })
      .mockResolvedValueOnce({ localDaemon: "stopped", serverId: "server-1" });
    mocks.spawnProcess.mockReturnValue(createMockChildProcess());
    await expect(createDaemonCommandHandlers(fake.deps).start_desktop_daemon()).resolves.toEqual(
      status(),
    );
    expect(mocks.runExternalCliJsonCommand).toHaveBeenNthCalledWith(2, [
      "daemon",
      "stop",
      "--json",
      "--timeout",
      "5",
      "--force",
      "--kill-timeout",
      "5",
    ]);
    expect(mocks.spawnProcess).toHaveBeenCalledTimes(1);
  });

  it("非托管服务版本不同也不自动停止", async () => {
    const running = status({ desktopManaged: false, version: "different" });
    const fake = startup(running);
    await expect(createDaemonCommandHandlers(fake.deps).start_desktop_daemon()).resolves.toEqual(
      running,
    );
    expect(mocks.runExternalCliJsonCommand).not.toHaveBeenCalled();
    expect(mocks.spawnProcess).not.toHaveBeenCalled();
  });

  it("后台启动失败仍显示守护进程日志", async () => {
    mkdirSync(mocks.paseoHome, { recursive: true });
    writeFileSync(`${mocks.paseoHome}/daemon.log`, "recent daemon failure");
    const fake = startup(status({ status: "stopped", pid: null }));
    mocks.spawnProcess.mockImplementation(() => {
      const child = createMockChildProcess();
      scheduleFailedStartup(child);
      return child;
    });
    await expect(createDaemonCommandHandlers(fake.deps).start_desktop_daemon()).rejects.toThrow(
      "recent daemon failure",
    );
    expect(mocks.spawnProcess).toHaveBeenCalledWith(
      "node",
      [],
      expect.objectContaining({
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
        envOverlay: expect.objectContaining({
          PASEO_CLI: getBundledCliShimPath(),
          PASEO_WEB_UI_ENABLED: "false",
        }),
      }),
    );
  });

  it("预启动和渲染器启动共用一次轻量就绪流程", async () => {
    const fake = startup(status({ status: "stopped", pid: null }), status());
    mocks.spawnProcess.mockReturnValue(createMockChildProcess());
    const [prestartResult, result] = await Promise.all([
      prestartDesktopDaemon(fake.deps),
      createDaemonCommandHandlers(fake.deps).start_desktop_daemon(),
    ]);
    expect(prestartResult).toBeUndefined();
    expect(result).toEqual(status());
    expect(fake.calls()).toBe(2);
    expect(mocks.spawnProcess).toHaveBeenCalledTimes(1);
    expect(mocks.runExternalCliJsonCommand).not.toHaveBeenCalled();
  });

  it("服务连接暂时超时时等待就绪，不重复创建或回收进程", async () => {
    const fake = startup(status({ status: "starting", error: "Connection timed out" }), status());
    await expect(createDaemonCommandHandlers(fake.deps).start_desktop_daemon()).resolves.toEqual(
      status(),
    );
    expect(mocks.spawnProcess).not.toHaveBeenCalled();
    expect(mocks.runExternalCliJsonCommand).not.toHaveBeenCalled();
  });

  it("只有已确认无法连接的托管进程才尝试回收陈旧锁", async () => {
    const fake = startup(status({ status: "errored" }));
    mocks.spawnProcess.mockImplementation(() => {
      const child = createMockChildProcess();
      scheduleFailedStartup(child);
      return child;
    });
    await expect(createDaemonCommandHandlers(fake.deps).start_desktop_daemon()).rejects.toThrow(
      "exit code 1",
    );
    expect(mocks.createNodeEntrypointInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["--reclaim-stale-pid-lock"] }),
    );
  });

  it("检查异常立即失败，不再盲目拉起第二个进程，并允许重试", async () => {
    const fake = startup(new Error("status failed"), status());
    const handlers = createDaemonCommandHandlers(fake.deps);
    await expect(handlers.start_desktop_daemon()).rejects.toThrow("status failed");
    await expect(handlers.start_desktop_daemon()).resolves.toEqual(status());
    expect(mocks.spawnProcess).not.toHaveBeenCalled();
  });

  it("returns the Electron main-process log tail from electron-log", () => {
    writeFileSync(
      mocks.appLogPath,
      Array.from({ length: 105 }, (_value, index) => `main log line ${index + 1}`).join("\n"),
    );
    const handlers = createDaemonCommandHandlers();

    expect(handlers.desktop_app_logs()).toEqual({
      logPath: mocks.appLogPath,
      contents: Array.from({ length: 100 }, (_value, index) => `main log line ${index + 6}`).join(
        "\n",
      ),
    });
  });

  it("拒绝远程页面调用通用桌面命令", async () => {
    registerDaemonManager();
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => {
      return channel === "paseo:invoke";
    })?.[1];
    if (typeof handler !== "function") {
      throw new Error("通用桌面命令处理器未注册");
    }
    const mainFrame = { url: "https://evil.example", origin: "https://evil.example" };

    await expect(
      handler({ sender: { mainFrame }, senderFrame: mainFrame }, "desktop_get_runtime_info"),
    ).rejects.toThrow("拒绝来自非受信任页面的桌面 IPC");
  });
});
