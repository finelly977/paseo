import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { acquireCodexDesktopTools, resolveCodexDesktopCliPath } from "./desktop-tools.js";
import type { DesktopToolTurn, startCodexDesktopBridge } from "./desktop-tools-bridge.js";

const logger = createTestLogger();
const COMPUTER_PLUGIN = "computer-use@openai-bundled";
const CHROME_PLUGIN = "chrome@openai-bundled";
const CUA_PLUGIN = "unified-computer-use@openai-bundled";
const unusedClient = {
  async request(): Promise<unknown> {
    throw new Error("Unexpected desktop tool request");
  },
};

interface ToolRequest {
  method: string;
  params: unknown;
}

describe("Codex 独立桌面工具配置", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.toReversed()) await cleanup();
    cleanups.length = 0;
  });

  async function fixture() {
    const home = await mkdtemp(path.join(os.tmpdir(), "paseo-desktop-tools-"));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    const pluginPath = path.join(
      home,
      "plugins/cache/openai-bundled/unified-computer-use/26.908.40834/.mcp.json",
    );
    const moduleDirectory = path.join(home, "node_modules");
    const sdkPath = path.join(moduleDirectory, "@oai/sky");
    const codexCliPath = path.join(home, "codex.exe");
    const nodeReplPath = path.join(home, "node_repl.exe");
    const chromePluginPath = path.join(home, "plugins/cache/openai-bundled/chrome/latest");
    const browserServicePath = path.join(chromePluginPath, "scripts/browser-service.mjs");
    const installScriptPath = path.join(chromePluginPath, "scripts/installManifest.mjs");
    const helperName =
      process.arch === "arm64" ? "codex-computer-use-arm64.exe" : "codex-computer-use.exe";
    const files = [
      codexCliPath,
      nodeReplPath,
      browserServicePath,
      installScriptPath,
      path.join(sdkPath, "package.json"),
      path.join(sdkPath, "bin/windows", helperName),
      path.join(
        sdkPath,
        "dist/project/cua/sky_js/src/targets/windows/internal/helper_transport.js",
      ),
    ];
    for (const file of files) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "");
    }
    const env = {
      CODEX_HOME: home,
      NODE_REPL_NODE_MODULE_DIRS: moduleDirectory,
      NODE_REPL_NODE_PATH: process.execPath,
      NODE_REPL_TRUSTED_SERVICES: '{"browser":"@oai/browser-desktop/service"}',
      SKY_CUA_NATIVE_PIPE: "1",
      SKY_CUA_NATIVE_PIPE_DIRECTORY: "old-app-pipe",
      BROWSER_USE_AVAILABLE_BACKENDS: "chrome,iab",
      BROWSER_USE_CODEX_APP_VERSION: "26.908.40834",
      CODEX_CLI_PATH: codexCliPath,
    };
    const cua = {
      command: "node.exe",
      args: ["cua-repl.mjs"],
      enabled: true,
      enabled_tools: ["js", "js_reset", "turn_ended"],
      startup_timeout_sec: 120,
      env: { ...env, CUA_REPL_ENABLED_SURFACES: "browser" },
    };
    async function writePlugin() {
      await mkdir(path.dirname(pluginPath), { recursive: true });
      await writeFile(pluginPath, JSON.stringify({ mcpServers: { cua_repl: cua } }));
    }
    await writePlugin();
    const configuration = {
      plugins: {
        [COMPUTER_PLUGIN]: { enabled: true },
        [CHROME_PLUGIN]: { enabled: true },
        [CUA_PLUGIN]: { enabled: true },
      },
      mcp_servers: { node_repl: { command: nodeReplPath, enabled: true, env } },
    };
    const starts: Parameters<typeof startCodexDesktopBridge>[0][] = [];
    const endedTurns: DesktopToolTurn[] = [];
    const requests: ToolRequest[] = [];
    const nativeHostInstalls: Array<{
      installScriptPath: string;
      runtimePaths: Record<string, string>;
    }> = [];
    let stops = 0;
    const options = {
      platform: "win32" as const,
      configuration,
      overrides: {},
      logger,
      client: {
        async request(method: string, params: unknown) {
          requests.push({ method, params });
          if (method === "config/read") return { config: configuration };
          if (method === "mcpServer/tool/call") return { content: [], isError: false };
          throw new Error(`Unexpected request: ${method}`);
        },
      },
      async installChromeNativeHost(script: string, runtimePaths: Record<string, string>) {
        nativeHostInstalls.push({ installScriptPath: script, runtimePaths });
      },
      async startBridge(input: Parameters<typeof startCodexDesktopBridge>[0]) {
        starts.push(input);
        return {
          pipePath: "paseo-owned-pipe",
          async endTurn(turn: DesktopToolTurn) {
            endedTurns.push(turn);
          },
          async dispose() {
            stops++;
          },
        };
      },
    };
    async function acquire() {
      const tools = await acquireCodexDesktopTools(options);
      if (tools === null) throw new Error("Expected managed desktop tools");
      cleanups.push(() => tools.dispose());
      return tools;
    }
    return {
      home,
      pluginPath,
      sdkPath,
      codexCliPath,
      nodeReplPath,
      browserServicePath,
      installScriptPath,
      configuration,
      cua,
      writePlugin,
      options,
      acquire,
      starts,
      requests,
      endedTurns,
      nativeHostInstalls,
      stopCount: () => stops,
    };
  }

  test("Codex 更新后从当前 npm 启动器解析新的原生 CLI，不沿用失效的哈希路径", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "paseo-codex-cli-"));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    const launcher = path.join(home, "bin", "codex.cmd");
    const nativeCli = path.join(
      home,
      "bin",
      "node_modules",
      "@openai",
      "codex",
      "node_modules",
      "@openai",
      process.arch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64",
      "vendor",
      process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc",
      "bin",
      "codex.exe",
    );
    await mkdir(path.dirname(nativeCli), { recursive: true });
    await Promise.all([writeFile(launcher, ""), writeFile(nativeCli, "")]);

    await expect(
      resolveCodexDesktopCliPath({
        launchCommand: launcher,
        configuredPath: path.join(home, "Codex", "bin", "old-hash", "codex.exe"),
        platform: "win32",
        arch: process.arch,
      }),
    ).resolves.toBe(nativeCli);
  });

  test("会话独立接管管道，保留工具限制且不修改官方配置文件", async () => {
    const f = await fixture();
    const original = await readFile(f.pluginPath, "utf8");
    const first = await f.acquire();
    const second = await f.acquire();
    expect(f.starts).toHaveLength(1);
    expect(first.config).toMatchObject({
      "mcp_servers.node_repl.env": {
        SKY_CUA_NATIVE_PIPE_DIRECTORY: "paseo-owned-pipe",
        BROWSER_USE_AVAILABLE_BACKENDS: "chrome",
        NODE_REPL_TRUSTED_SERVICES: JSON.stringify({
          browser: f.browserServicePath,
          sky: "@oai/sky/service",
        }),
      },
      "mcp_servers.cua_repl": {
        enabled_tools: ["js", "js_reset", "turn_ended"],
        startup_timeout_sec: 120,
        env: {
          CUA_REPL_ENABLED_SURFACES: "browser",
          SKY_CUA_NATIVE_PIPE_DIRECTORY: "paseo-owned-pipe",
          BROWSER_USE_AVAILABLE_BACKENDS: "chrome",
        },
      },
      "plugins.unified-computer-use@openai-bundled.mcp_servers.cua_repl.enabled": false,
    });
    expect(await readFile(f.pluginPath, "utf8")).toBe(original);
    expect(f.nativeHostInstalls).toEqual([
      {
        installScriptPath: f.installScriptPath,
        runtimePaths: {
          codexCliPath: f.codexCliPath,
          nodePath: process.execPath,
          nodeReplPath: f.nodeReplPath,
        },
      },
    ]);
    expect(f.configuration.mcp_servers.node_repl.env.SKY_CUA_NATIVE_PIPE_DIRECTORY).toBe(
      "old-app-pipe",
    );
    await first.dispose();
    expect(f.stopCount()).toBe(0);
    await second.dispose();
    await second.dispose();
    expect(f.stopCount()).toBe(1);
  });

  test("会话启动时修复 Codex 与 Chrome 更新后失效的运行路径", async () => {
    const f = await fixture();
    const launcher = path.join(f.home, "npm", "codex.cmd");
    const nativeCli = path.join(
      f.home,
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "node_modules",
      "@openai",
      process.arch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64",
      "vendor",
      process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc",
      "bin",
      "codex.exe",
    );
    await mkdir(path.dirname(nativeCli), { recursive: true });
    await Promise.all([writeFile(launcher, ""), writeFile(nativeCli, "")]);
    f.configuration.mcp_servers.node_repl.env.CODEX_CLI_PATH = path.join(
      f.home,
      "Codex/bin/removed-hash/codex.exe",
    );
    f.configuration.mcp_servers.node_repl.env.NODE_REPL_TRUSTED_SERVICES = JSON.stringify({
      browser: path.join(f.home, "plugins/cache/openai-bundled/browser/removed/service.mjs"),
    });
    f.options.codexLaunchCommand = launcher;

    const tools = await f.acquire();

    expect(tools.config).toMatchObject({
      "mcp_servers.node_repl.env": {
        CODEX_CLI_PATH: nativeCli,
        NODE_REPL_TRUSTED_SERVICES: JSON.stringify({
          browser: f.browserServicePath,
          sky: "@oai/sky/service",
        }),
      },
      "mcp_servers.cua_repl": {
        env: {
          CODEX_CLI_PATH: nativeCli,
          NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ browser: f.browserServicePath }),
        },
      },
    });
    expect(f.nativeHostInstalls[0]?.runtimePaths.codexCliPath).toBe(nativeCli);
  });

  test("Chrome 原生宿主注册失败会明确报错，并允许下次启动重试", async () => {
    const f = await fixture();
    let attempts = 0;
    f.options.installChromeNativeHost = async () => {
      attempts++;
      if (attempts === 1) throw new Error("注册失败");
    };

    await expect(f.acquire()).rejects.toThrow("注册失败");
    expect(f.starts).toHaveLength(0);
    await f.acquire();
    expect(attempts).toBe(2);
  });

  test.each(["linux", "darwin"] as const)("%s 不启用 Windows 桌面组件", async (platform) => {
    await expect(
      acquireCodexDesktopTools({
        platform,
        configuration: {},
        overrides: {},
        logger,
        client: unusedClient,
      }),
    ).resolves.toBeNull();
  });

  test.each([
    {
      name: "插件关闭",
      configuration: {
        plugins: { [COMPUTER_PLUGIN]: { enabled: false }, [CHROME_PLUGIN]: { enabled: false } },
      },
    },
    { name: "没有桌面 MCP", configuration: {} },
    {
      name: "用户禁用 Node REPL",
      configuration: { mcp_servers: { node_repl: { enabled: false } } },
    },
    {
      name: "非 App 原生管道配置",
      configuration: { mcp_servers: { node_repl: { command: "custom-node", env: {} } } },
    },
  ])("$name 时保留现有启动方式", async ({ configuration }) => {
    await expect(
      acquireCodexDesktopTools({
        platform: "win32",
        configuration,
        overrides: {},
        logger,
        client: unusedClient,
      }),
    ).resolves.toBeNull();
  });

  test("未知界面类型明确报错且释放已创建的宿主", async () => {
    const f = await fixture();
    f.cua.env.CUA_REPL_ENABLED_SURFACES = "unexpected";
    await f.writePlugin();
    await expect(f.acquire()).rejects.toThrow("surface");
    expect(f.stopCount()).toBe(1);
  });

  test.each([
    { "mcp_servers.node_repl.env.SKY_CUA_NATIVE_PIPE_DIRECTORY": "用户管道" },
    { "mcp_servers.cua_repl": { enabled: false } },
    { mcp_servers: { node_repl: { command: "user-runtime" } } },
    { mcp_servers: { cua_repl: { enabled: false } } },
    { ["plugins." + COMPUTER_PLUGIN + ".enabled"]: false },
    { plugins: { [CHROME_PLUGIN]: { enabled: false } } },
  ])("不覆盖用户显式提供的会话配置 %j", async (overrides) => {
    await expect(
      acquireCodexDesktopTools({
        platform: "win32",
        configuration: {},
        overrides,
        logger,
        client: unusedClient,
      }),
    ).resolves.toBeNull();
  });

  test("不把用户关闭的统一插件服务重新注册为启用的全局服务", async () => {
    const f = await fixture();
    const configuration = {
      ...f.configuration,
      plugins: {
        ...f.configuration.plugins,
        [CUA_PLUGIN]: { enabled: true, mcp_servers: { cua_repl: { enabled: false } } },
      },
    };
    await expect(acquireCodexDesktopTools({ ...f.options, configuration })).resolves.toBeNull();
    expect(f.starts).toHaveLength(0);
  });

  test("仅启用 Chrome 时不启动桌面控制组件且不提供内置浏览器", async () => {
    const f = await fixture();
    f.configuration.plugins[COMPUTER_PLUGIN].enabled = false;
    const tools = await f.acquire();
    expect(f.starts).toHaveLength(0);
    expect(tools.config).toMatchObject({
      "mcp_servers.node_repl.env": {
        NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ browser: f.browserServicePath }),
        BROWSER_USE_AVAILABLE_BACKENDS: "chrome",
      },
      "mcp_servers.cua_repl": { env: { CUA_REPL_ENABLED_SURFACES: "browser" } },
    });
  });

  test("仅启用 Computer Use 时不会启用浏览器界面", async () => {
    const f = await fixture();
    f.configuration.plugins[CHROME_PLUGIN].enabled = false;
    const tools = await f.acquire();
    expect(tools.config).toMatchObject({
      "mcp_servers.node_repl.env": {
        NODE_REPL_TRUSTED_SERVICES: '{"sky":"@oai/sky/service"}',
        BROWSER_USE_AVAILABLE_BACKENDS: "",
      },
      "mcp_servers.cua_repl": { enabled: false, env: { CUA_REPL_ENABLED_SURFACES: "" } },
    });
    expect(f.nativeHostInstalls).toHaveLength(0);
  });

  test("按运行时声明的目录顺序定位 SDK，不假定它总在第一项", async () => {
    const f = await fixture();
    const env = f.configuration.mcp_servers.node_repl.env;
    env.NODE_REPL_NODE_MODULE_DIRS =
      path.join(f.home, "other-node-modules") + ";" + env.NODE_REPL_NODE_MODULE_DIRS;
    await f.acquire();
    expect(f.starts).toHaveLength(1);
  });

  test("缺失 SDK 时明确失败，不留下监听服务", async () => {
    const f = await fixture();
    f.configuration.mcp_servers.node_repl.env.NODE_REPL_NODE_MODULE_DIRS = path.join(
      f.home,
      "missing-runtime",
    );
    await expect(f.acquire()).rejects.toThrow("未找到 Codex Computer Use SDK");
    expect(f.starts).toHaveLength(0);
  });

  test("非法受信任服务配置不回退为空对象，且不启动宿主", async () => {
    const f = await fixture();
    f.configuration.mcp_servers.node_repl.env.NODE_REPL_TRUSTED_SERVICES = "not-json";
    await expect(f.acquire()).rejects.toThrow(SyntaxError);
    expect(f.stopCount()).toBe(0);
  });

  test("不重新提交 config/read 的归一化空值，避免破坏 Codex 的 TOML 解析", async () => {
    const f = await fixture();
    const configuration = {
      ...f.configuration,
      mcp_servers: {
        node_repl: {
          ...f.configuration.mcp_servers.node_repl,
          tool_timeout_sec: null,
          enabled_tools: null,
        },
      },
    };
    const tools = await acquireCodexDesktopTools({ ...f.options, configuration });
    if (tools === null) throw new Error("Expected managed desktop tools");
    cleanups.push(() => tools.dispose());
    expect(Object.keys(tools.config)).toEqual([
      "mcp_servers.node_repl.env",
      "plugins.unified-computer-use@openai-bundled.mcp_servers.cua_repl.enabled",
      "mcp_servers.cua_repl",
    ]);
  });

  test("停止回合时调用官方清理工具，并按回合释放原生组件", async () => {
    const f = await fixture();
    const tools = await f.acquire();
    tools.handleNotification("turn/started", { threadId: "thread", turn: { id: "turn" } });
    tools.handleNotification("turn/completed", {
      threadId: "thread",
      turn: { id: "turn", status: "interrupted" },
    });
    await tools.dispose();
    expect(f.requests).toEqual(
      ["node_repl", "cua_repl"].map((server) => ({
        method: "mcpServer/tool/call",
        params: {
          threadId: "thread",
          server,
          tool: "turn_ended",
          arguments: {
            hook_event_name: "Interrupt",
            session_id: "thread",
            turn_id: "turn",
          },
        },
      })),
    );
    expect(f.endedTurns).toEqual([{ sessionId: "thread", turnId: "turn" }]);
  });
});
