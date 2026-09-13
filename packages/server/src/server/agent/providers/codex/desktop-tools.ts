import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

import {
  startCodexDesktopBridge,
  type CodexDesktopBridge,
  type DesktopToolTurn,
} from "./desktop-tools-bridge.js";
import type { CodexAppServerClient } from "./app-server-transport.js";
import { createCodexDesktopHelper } from "./desktop-tools-helper.js";

const COMPUTER_PLUGIN = "computer-use@openai-bundled";
const CHROME_PLUGIN = "chrome@openai-bundled";
const CUA_PLUGIN = "unified-computer-use@openai-bundled";
const ConfigurationSchema = z
  .object({
    mcp_servers: z.record(z.string(), z.unknown()).optional(),
    plugins: z
      .record(
        z.string(),
        z
          .object({
            enabled: z.boolean().optional(),
            mcp_servers: z.record(z.string(), z.unknown()).optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
const CandidateSchema = z
  .object({
    command: z.string().nullish(),
    env: z.record(z.string(), z.string()).nullish(),
    enabled: z.boolean().optional(),
  })
  .passthrough();
const StdioSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()),
    enabled: z.boolean().optional(),
  })
  .passthrough();
const ServicesSchema = z.record(z.string(), z.string());
const VersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/);
const TurnNotificationSchema = z.object({
  threadId: z.string().min(1),
  turn: z.object({ id: z.string().min(1).optional(), status: z.string().optional() }),
});

interface TurnCompletion {
  turn: DesktopToolTurn;
  hookEvent: "Stop" | "Interrupt";
}

interface SharedBridge {
  users: number;
  ready: Promise<CodexDesktopBridge>;
  closing: Promise<void> | null;
}
const bridges = new Map<string, SharedBridge>();

export interface CodexDesktopTools {
  config: Record<string, unknown>;
  handleNotification(method: string, params: unknown): void;
  dispose(): Promise<void>;
}

interface DesktopToolsOptions {
  client: Pick<CodexAppServerClient, "request">;
  platform: NodeJS.Platform;
  configuration: unknown;
  overrides: Record<string, unknown>;
  logger: Logger;
  startBridge?: typeof startCodexDesktopBridge;
}

function hasDesktopOverride(overrides: Record<string, unknown>): boolean {
  const keys = Object.keys(overrides);
  const pluginKeys = [COMPUTER_PLUGIN, CHROME_PLUGIN, CUA_PLUGIN];
  const roots = [
    "mcp_servers.node_repl",
    "mcp_servers.cua_repl",
    ...pluginKeys.map((plugin) => `plugins.${plugin}`),
  ];
  const hasFlatOverride = keys.some((key) =>
    roots.some((root) => key === root || key.startsWith(`${root}.`)),
  );
  if (hasFlatOverride) return true;
  const plugins = overrides.plugins;
  if (
    typeof plugins === "object" &&
    plugins !== null &&
    pluginKeys.some((plugin) => plugin in plugins)
  )
    return true;
  const nested = overrides.mcp_servers;
  return (
    typeof nested === "object" && nested !== null && ("node_repl" in nested || "cua_repl" in nested)
  );
}

function requiredEnv(env: Record<string, string>, name: string): string {
  const value = env[name];
  if (!value || !value.trim()) throw new Error(`Codex desktop runtime is missing ${name}`);
  return value;
}

async function acquireBridge(options: DesktopToolsOptions, env: Record<string, string>) {
  const home = requiredEnv(env, "CODEX_HOME");
  const cli = requiredEnv(env, "CODEX_CLI_PATH");
  const nodePath = requiredEnv(env, "NODE_REPL_NODE_PATH");
  const moduleDirectories = requiredEnv(env, "NODE_REPL_NODE_MODULE_DIRS")
    .split(";")
    .filter(Boolean);
  let sdk: string | null = null;
  for (const directory of moduleDirectories) {
    const candidate = path.join(directory, "@oai", "sky");
    try {
      await access(candidate);
      sdk = candidate;
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  if (sdk === null)
    throw new Error("未找到 Codex Computer Use SDK，请先通过 Codex App 安装桌面工具运行时");
  const helperPath = path.join(
    sdk,
    "bin",
    "windows",
    process.arch === "arm64" ? "codex-computer-use-arm64.exe" : "codex-computer-use.exe",
  );
  const modulePath = path.join(
    sdk,
    "dist/project/cua/sky_js/src/targets/windows/internal/helper_transport.js",
  );
  await Promise.all([access(helperPath), access(modulePath), access(nodePath)]);
  const key = [home, helperPath, cli, nodePath]
    .map((file) => path.resolve(file).toLowerCase())
    .join("\0");
  let shared = bridges.get(key);
  if (shared?.closing) {
    await shared.closing;
    shared = bridges.get(key);
  }
  if (!shared) {
    const start = options.startBridge ?? startCodexDesktopBridge;
    const ready = start({
      pipePath: `\\\\.\\pipe\\codex-computer-use-paseo-${randomUUID()}`,
      logger: options.logger,
      async createHelper() {
        return createCodexDesktopHelper({
          nodePath,
          modulePath,
          helperPath,
          codexHome: home,
          cliPath: cli,
          logger: options.logger,
        });
      },
    });
    shared = { users: 0, ready, closing: null };
    bridges.set(key, shared);
  }
  const entry = shared;
  entry.users++;
  let bridge: CodexDesktopBridge;
  try {
    bridge = await entry.ready;
  } catch (error) {
    entry.users--;
    if (bridges.get(key) === entry) bridges.delete(key);
    throw error;
  }
  let release: Promise<void> | null = null;
  return {
    pipePath: bridge.pipePath,
    endTurn: (turn: DesktopToolTurn) => bridge.endTurn(turn),
    dispose() {
      release ??= (async () => {
        entry.users--;
        if (entry.users !== 0) return;
        entry.closing = (async () => {
          await bridge.dispose();
          if (bridges.get(key) === entry) bridges.delete(key);
        })();
        await entry.closing;
      })();
      return release;
    },
  };
}

interface RuntimeEnvOptions {
  source: Record<string, string>;
  computer: boolean;
  chrome: boolean;
  pipePath: string | null;
}

function runtimeEnv({
  source,
  computer,
  chrome,
  pipePath,
}: RuntimeEnvOptions): Record<string, string> {
  const services = ServicesSchema.parse(
    JSON.parse(requiredEnv(source, "NODE_REPL_TRUSTED_SERVICES")),
  );
  if (computer) services.sky ??= "@oai/sky/service";
  else delete services.sky;
  if (!chrome) delete services.browser;
  const configuredBackends = source.BROWSER_USE_AVAILABLE_BACKENDS;
  const available = configuredBackends
    ? configuredBackends.split(",").map((backend) => backend.trim())
    : [];
  const backends = available.filter((backend) => chrome && backend !== "iab");
  return {
    ...source,
    NODE_REPL_TRUSTED_SERVICES: JSON.stringify(services),
    NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER: "",
    ...(!chrome ? { NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME: "" } : {}),
    BROWSER_USE_AVAILABLE_BACKENDS: backends.join(","),
    ...(pipePath === null
      ? {}
      : { SKY_CUA_NATIVE_PIPE: "1", SKY_CUA_NATIVE_PIPE_DIRECTORY: pipePath }),
  };
}

interface DesktopConnectionOptions {
  client: Pick<CodexAppServerClient, "request">;
  cwd: string | undefined;
  overrides: Record<string, unknown>;
  logger: Logger;
}

export async function connectCodexDesktopTools(
  options: DesktopConnectionOptions,
): Promise<CodexDesktopTools | null> {
  if (process.platform !== "win32" || hasDesktopOverride(options.overrides)) return null;
  const response = await options.client.request("config/read", { cwd: options.cwd });
  const parsed = z.object({ config: z.unknown() }).parse(response);
  return acquireCodexDesktopTools({
    client: options.client,
    platform: process.platform,
    configuration: parsed.config,
    overrides: options.overrides,
    logger: options.logger,
  });
}

interface DesktopRuntimeSelection {
  source: z.infer<typeof StdioSchema>;
  computer: boolean;
  chrome: boolean;
  unified: boolean;
}

function selectDesktopRuntime(raw: unknown): DesktopRuntimeSelection | null {
  const configuration = ConfigurationSchema.parse(raw);
  const customCuaServer = configuration.mcp_servers?.cua_repl;
  const cuaOverrides = configuration.plugins?.[CUA_PLUGIN]?.mcp_servers?.cua_repl;
  if (customCuaServer !== undefined || cuaOverrides !== undefined) return null;
  const nodeRepl = configuration.mcp_servers?.node_repl;
  if (nodeRepl === undefined) return null;
  const candidate = CandidateSchema.parse(nodeRepl);
  if (candidate.enabled === false || candidate.env?.SKY_CUA_NATIVE_PIPE !== "1") return null;
  const computer = configuration.plugins?.[COMPUTER_PLUGIN]?.enabled === true;
  const chrome = configuration.plugins?.[CHROME_PLUGIN]?.enabled === true;
  if (!computer && !chrome) return null;
  const source = StdioSchema.parse(nodeRepl);
  const unified = configuration.plugins?.[CUA_PLUGIN]?.enabled === true;
  return { source, computer, chrome, unified };
}

export async function acquireCodexDesktopTools(
  options: DesktopToolsOptions,
): Promise<CodexDesktopTools | null> {
  if (options.platform !== "win32" || hasDesktopOverride(options.overrides)) return null;
  const runtime = selectDesktopRuntime(options.configuration);
  if (runtime === null) return null;
  const { source, computer, chrome, unified } = runtime;
  const bridge = computer ? await acquireBridge(options, source.env) : null;
  try {
    const pipePath = bridge?.pipePath ?? null;
    const env = runtimeEnv({ source: source.env, computer, chrome, pipePath });
    // config/read 包含归一化后的 null 字段，不能把整份服务对象重新写成 TOML 覆盖。
    const config: Record<string, unknown> = { "mcp_servers.node_repl.env": env };
    const servers = ["node_repl"];
    if (unified) {
      const version = VersionSchema.parse(requiredEnv(source.env, "BROWSER_USE_CODEX_APP_VERSION"));
      const pluginPath = path.join(
        requiredEnv(source.env, "CODEX_HOME"),
        "plugins/cache/openai-bundled/unified-computer-use",
        version,
        ".mcp.json",
      );
      const raw: unknown = JSON.parse(await readFile(pluginPath, "utf8"));
      const plugin = z.object({ mcpServers: z.object({ cua_repl: StdioSchema }) }).parse(raw);
      const cua = plugin.mcpServers.cua_repl;
      const surfaces = requiredEnv(cua.env, "CUA_REPL_ENABLED_SURFACES")
        .split(",")
        .map((surface) => surface.trim())
        .filter((surface) => {
          if (surface === "computer") return computer;
          if (surface === "browser") return chrome;
          throw new Error(`Unsupported Codex desktop surface: ${surface}`);
        });
      const cuaEnv = runtimeEnv({
        source: cua.env,
        computer: surfaces.includes("computer"),
        chrome: surfaces.includes("browser"),
        pipePath,
      });
      config["plugins.unified-computer-use@openai-bundled.mcp_servers.cua_repl.enabled"] = false;
      const enabled = cua.enabled !== false && surfaces.length > 0;
      config["mcp_servers.cua_repl"] = {
        ...cua,
        enabled,
        env: {
          ...cuaEnv,
          CUA_REPL_ENABLED_SURFACES: surfaces.join(","),
        },
      };
      if (enabled) servers.push("cua_repl");
    }
    const activeTurns = new Map<string, string>();
    const cleanups = new Set<Promise<void>>();
    let disposed = false;

    async function finishTurn({ turn, hookEvent }: TurnCompletion): Promise<void> {
      const hooks = servers.map(async (server) => {
        const response = await options.client.request(
          "mcpServer/tool/call",
          {
            threadId: turn.sessionId,
            server,
            tool: "turn_ended",
            arguments: {
              hook_event_name: hookEvent,
              session_id: turn.sessionId,
              turn_id: turn.turnId,
            },
          },
          15000,
        );
        const result = CallToolResultSchema.parse(response);
        if (result.isError) throw new Error(`Codex ${server} turn_ended failed`, { cause: result });
      });
      const results = await Promise.allSettled([...hooks, bridge?.endTurn(turn)]);
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length > 0)
        throw new AggregateError(errors, "Failed to end Codex desktop tool turn");
    }

    function handleNotification(method: string, params: unknown): void {
      if (disposed || (method !== "turn/started" && method !== "turn/completed")) return;
      try {
        const notification = TurnNotificationSchema.parse(params);
        const sessionId = notification.threadId;
        if (method === "turn/started") {
          const turnId = z.string().parse(notification.turn.id);
          activeTurns.set(sessionId, turnId);
          return;
        }
        const turnId = notification.turn.id ?? activeTurns.get(sessionId);
        if (turnId === undefined) throw new Error("Codex desktop cleanup is missing the turn id");
        if (activeTurns.get(sessionId) === turnId) activeTurns.delete(sessionId);
        const hookEvent = notification.turn.status === "interrupted" ? "Interrupt" : "Stop";
        const cleanup = finishTurn({ turn: { sessionId, turnId }, hookEvent })
          .catch((error) => {
            if (disposed)
              options.logger.debug(
                { err: error },
                "Desktop cleanup interrupted by session shutdown",
              );
            else
              options.logger.error(
                { err: error, sessionId, turnId },
                "Codex desktop turn cleanup failed",
              );
          })
          .finally(() => cleanups.delete(cleanup));
        cleanups.add(cleanup);
      } catch (error) {
        options.logger.error(
          { err: error, method },
          "Invalid Codex desktop lifecycle notification",
        );
      }
    }
    return {
      config,
      handleNotification,
      async dispose() {
        disposed = true;
        activeTurns.clear();
        await Promise.all([bridge?.dispose(), ...cleanups]);
      },
    };
  } catch (error) {
    try {
      await bridge?.dispose();
    } catch (cleanupError) {
      options.logger.error(
        { err: cleanupError, setupError: error },
        "Failed to release Codex desktop tools after initialization failed",
      );
    }
    throw error;
  }
}
