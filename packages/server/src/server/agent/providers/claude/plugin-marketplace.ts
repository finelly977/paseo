import { readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import pLimit from "p-limit";
import type { Logger } from "pino";
import type {
  ClaudePlugin,
  ClaudePluginAction,
  ClaudePluginService,
} from "@getpaseo/protocol/claude-plugins";
import {
  createProviderEnv,
  resolveProviderLaunch,
  getProviderLaunchAvailability,
  type ProviderRuntimeSettings,
} from "../../provider-launch-config.js";
import { execCommand } from "../../../../utils/spawn.js";

const InstalledSchema = z.object({
  id: z.string().regex(/^[\w.-]+@[\w.-]+$/),
  version: z.string(),
  scope: z.string(),
  enabled: z.boolean(),
  installPath: z.string(),
  readFromFolder: z.string().optional(),
  projectPath: z.string().optional(),
  errors: z.array(z.string()).optional(),
});
const AvailableSchema = z.object({
  pluginId: z.string().regex(/^[\w.-]+@[\w.-]+$/),
  name: z.string(),
  marketplaceName: z.string(),
  description: z.string().optional(),
  version: z.string().optional(),
});
const CatalogSchema = z.object({
  installed: z.array(InstalledSchema),
  available: z.array(AvailableSchema),
});
const MarketSchema = z.object({
  name: z.string(),
  source: z.string(),
  installLocation: z.string().optional(),
});
const ManifestSchema = z
  .object({
    name: z.string().optional(),
    displayName: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    author: z.union([z.string(), z.object({ name: z.string().optional() })]).optional(),
    icon: z.string().optional(),
    homepage: z.string().optional(),
    keywords: z.array(z.string()).optional(),
  })
  .passthrough();
const MarketFileSchema = z.object({
  plugins: z.array(z.object({ name: z.string(), source: z.unknown().optional() }).passthrough()),
});
interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
export type ClaudePluginRunner = (
  args: string[],
  cwd: string,
  timeout: number,
) => Promise<RunResult>;
interface Snapshot {
  installed: z.infer<typeof InstalledSchema>[];
  available: z.infer<typeof AvailableSchema>[];
  markets: z.infer<typeof MarketSchema>[];
  entries: Map<string, Record<string, unknown>>;
  expires: number;
}
interface ResolvedPlugin {
  plugin: ClaudePlugin;
  root: string | null;
  metadata: z.infer<typeof ManifestSchema> | null;
}

export function createClaudePluginRunner(options: {
  runtimeSettings?: ProviderRuntimeSettings;
  configDir?: string;
  logger: Logger;
}): ClaudePluginRunner {
  return async (args, cwd, timeout) => {
    const launch = await resolveProviderLaunch({
      commandConfig: options.runtimeSettings?.command,
      defaultBinary: "claude",
    });
    const availability = await getProviderLaunchAvailability(launch);
    if (!availability.available)
      throw new Error("未找到 Claude Code，请先在此主机安装并配置运行命令。");
    const env = createProviderEnv({
      baseEnv: process.env,
      runtimeSettings: options.runtimeSettings,
    });
    if (options.configDir) env.CLAUDE_CONFIG_DIR = options.configDir;
    try {
      const result = await execCommand(
        availability.resolvedPath ?? launch.command,
        [...launch.args, "plugin", ...args],
        { cwd, env, timeout, maxBuffer: 16 * 1024 * 1024 },
      );
      if (result.stderr.trim())
        options.logger.warn({ stderr: result.stderr }, "Claude 插件命令诊断");
      return { ...result, exitCode: 0 };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "stdout" in error &&
        typeof error.stdout === "string" &&
        "stderr" in error &&
        typeof error.stderr === "string" &&
        "code" in error &&
        typeof error.code === "number"
      ) {
        options.logger.error(
          { stack: error instanceof Error ? error.stack : undefined, exitCode: error.code },
          "Claude 插件命令执行失败",
        );
        return { stdout: error.stdout, stderr: error.stderr, exitCode: error.code };
      }
      throw new Error("Claude Code 插件命令启动失败或超时", { cause: error });
    }
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("Claude Code 插件接口返回了无效 JSON，请更新 Claude Code 后重试。", {
      cause: error,
    });
  }
}
// 清单、README 与图标都是可选资源；只有文件确实不存在时才按缺失处理，读取错误不能伪装成空介绍。
async function optionalFile(file: string, maxBytes: number): Promise<Buffer | null> {
  try {
    const meta = await stat(file);
    if (!meta.isFile()) throw new Error(`插件资源不是普通文件：${file}`);
    if (meta.size > maxBytes) throw new Error(`插件资源超过大小限制：${file}`);
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function contained(root: string, relative: string): Promise<string> {
  const base = await realpath(root);
  const file = await realpath(path.resolve(base, relative));
  const rel = path.relative(base, file);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
    throw new Error("插件资源路径超出插件目录。");
  return file;
}
async function icon(root: string, relative: string | undefined): Promise<string | null> {
  if (!relative) return null;
  const mime = new Map([
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".webp", "image/webp"],
    [".svg", "image/svg+xml"],
  ]).get(path.extname(relative).toLowerCase());
  if (!mime) throw new Error("插件图标格式不受支持。");
  const file = await contained(root, relative);
  const bytes = await optionalFile(file, 512 * 1024);
  return bytes === null ? null : `data:${mime};base64,${bytes.toString("base64")}`;
}
function applies(project: string | undefined, cwd: string): boolean {
  if (project === undefined) return true;
  const rel = path.relative(path.resolve(project), cwd);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

export function createClaudePluginMarketplaceService(options: {
  run: ClaudePluginRunner;
  defaultCwd?: string;
}): ClaudePluginService {
  const queue = pLimit(1);
  let cache: { cwd: string; snapshot: Snapshot } | null = null;
  async function directory(cwd?: string) {
    const value = cwd ?? options.defaultCwd ?? os.homedir();
    if (!path.isAbsolute(value)) throw new Error("项目目录必须是当前主机上的绝对路径。");
    const resolved = await realpath(value);
    if (!(await stat(resolved)).isDirectory()) throw new Error("项目目录不存在或不是文件夹。");
    return resolved;
  }
  async function read(args: string[], cwd: string): Promise<unknown> {
    const result = await options.run(args, cwd, 45_000);
    if (result.exitCode !== 0)
      throw new Error(
        result.stderr.trim() || "Claude Code 插件目录读取失败，请检查主机上的 Claude Code。",
      );
    return parseJson(result.stdout);
  }
  async function snapshot(cwd: string, force = false): Promise<Snapshot> {
    if (!force && cache !== null && cache.cwd === cwd && cache.snapshot.expires > Date.now())
      return cache.snapshot;
    const [catalog, markets] = await Promise.all([
      read(["list", "--json", "--available"], cwd),
      read(["marketplace", "list", "--json"], cwd),
    ]);
    const parsed = CatalogSchema.parse(catalog);
    const marketList = z.array(MarketSchema).parse(markets);
    const entries = new Map<string, Record<string, unknown>>();
    for (const market of marketList) {
      if (!market.installLocation) continue;
      const bytes = await optionalFile(
        path.join(market.installLocation, ".claude-plugin", "marketplace.json"),
        8 * 1024 * 1024,
      );
      if (bytes !== null)
        for (const entry of MarketFileSchema.parse(parseJson(bytes.toString("utf8"))).plugins)
          entries.set(`${entry.name}@${market.name}`, entry);
    }
    const value = {
      ...parsed,
      installed: parsed.installed.filter((item) => applies(item.projectPath, cwd)),
      markets: marketList,
      entries,
      expires: Date.now() + 60000,
    };
    cache = { cwd, snapshot: value };
    return value;
  }
  async function resolve(id: string, data: Snapshot): Promise<ResolvedPlugin> {
    const installs = data.installed.filter((item) => item.id === id);
    const available = data.available.find((candidate) => candidate.pluginId === id);
    if (installs.length === 0 && !available)
      throw new Error("未找到此 Claude Code 插件，请刷新目录。");
    const [name, marketplaceName] = id.split("@");
    const local = await localMetadata(
      installs[0],
      data.entries.get(id) ?? null,
      data.markets.find((item) => item.name === marketplaceName),
    );
    const { root, metadata, iconUrl } = local;
    const errors = [...installs.flatMap((item) => item.errors ?? []), ...local.errors];
    const ui = metadataFields(metadata);
    const plugin: ClaudePlugin = {
      id,
      name,
      title: ui.title ?? name,
      marketplaceName,
      description: ui.description ?? available?.description ?? "",
      version: installs[0]?.version ?? ui.version ?? available?.version ?? null,
      installed: installs.length > 0,
      enabled: installs.some((item) => item.enabled),
      iconUrl,
      iconUrlDark: null,
      developer: ui.developer,
      websiteUrl: ui.websiteUrl,
      capabilities: ui.components,
      errors,
      installations: installs.map((item) => ({
        scope: item.scope,
        projectPath: item.projectPath ?? null,
        version: item.version,
      })),
    };
    return { plugin, root, metadata };
  }
  return {
    catalog(input) {
      return queue(async () => {
        const cwd = await directory(input.cwd);
        const data = await snapshot(cwd, input.force);
        const ids = [
          ...new Set([
            ...data.installed.map((item) => item.id),
            ...data.available.map((item) => item.pluginId),
          ]),
        ];
        const query = (input.query ?? "").trim().toLocaleLowerCase();
        const filtered = ids.filter((id) => {
          const installed = data.installed.some((item) => item.id === id);
          const item = data.available.find((candidate) => candidate.pluginId === id);
          return (
            (!input.installedOnly || installed) &&
            (!query || `${id} ${item?.description ?? ""}`.toLocaleLowerCase().includes(query))
          );
        });
        const offset = input.offset ?? 0;
        const plugins = await Promise.all(
          filtered.slice(offset, offset + 50).map(async (id) => (await resolve(id, data)).plugin),
        );
        return {
          plugins,
          marketplaces: data.markets.map((item) => ({ name: item.name, source: item.source })),
          total: filtered.length,
          nextOffset: offset + 50 < filtered.length ? offset + 50 : null,
        };
      });
    },
    detail(id, cwd) {
      return queue(async () => {
        const data = await snapshot(await directory(cwd));
        const resolved = await resolve(id, data);
        let readme: string | null = null;
        const components = [...resolved.plugin.capabilities];
        if (resolved.root !== null) {
          for (const name of ["README.md", "readme.md"]) {
            const file = await optionalFile(
              await optionalContainedPath(resolved.root, name),
              256 * 1024,
            );
            if (file !== null) {
              readme = file.toString("utf8");
              break;
            }
          }
          for (const [key, label] of [
            ["skills", "技能"],
            ["agents", "智能体"],
            ["commands", "命令"],
            ["hooks", "钩子"],
            [".mcp.json", "MCP 服务"],
            [".lsp.json", "LSP 服务"],
          ]) {
            const file = path.join(resolved.root, key);
            try {
              await stat(file);
              if (!components.includes(label)) components.push(label);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
          }
        }
        return {
          plugin: resolved.plugin,
          description: resolved.plugin.description,
          readme,
          contentStatus: resolved.root === null ? "install_required" : "available",
          components,
        };
      });
    },
    manage(action, cwd) {
      return queue(async () => {
        if ("scope" in action && action.scope !== "user" && !cwd)
          throw new Error("请先填写并应用项目目录，再修改项目范围的插件。");
        const dir = await directory(cwd);
        const args = actionArgs(action);
        cache = null;
        try {
          const result = await options.run([...args, "--json"], dir, 120_000);
          return actionResult(result, action);
        } finally {
          cache = null;
        }
      });
    },
  };
}
async function optionalContainedPath(root: string, name: string): Promise<string> {
  // 可选资源可以缺失，但存在的链接必须仍在插件目录内。
  const file = path.join(root, name);
  try {
    return await contained(root, name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return file;
    throw error;
  }
}

function actionArgs(action: ClaudePluginAction): string[] {
  const args: string[] = [];
  switch (action.kind) {
    case "install":
    case "update":
      args.push(action.kind, action.pluginId, "--scope", action.scope);
      if (action.acceptCommand) args.push("--accept-command", action.acceptCommand);
      break;
    case "uninstall":
      args.push("uninstall", action.pluginId, "--scope", action.scope, "--keep-data");
      break;
    case "set_enabled":
      args.push(action.enabled ? "enable" : "disable", action.pluginId, "--scope", action.scope);
      break;
    case "add_marketplace":
      if (action.source.startsWith("-")) throw new Error("市场来源不能以选项前缀开头。");
      args.push("marketplace", "add", action.source, "--scope", action.scope);
      break;
    case "refresh_marketplace":
      args.push("marketplace", "update", action.name);
      break;
    case "remove_marketplace":
      args.push("marketplace", "remove", action.name, "--scope", action.scope);
      break;
  }

  return args;
}
function actionResult(result: RunResult, action: ClaudePluginAction) {
  const last = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!last) throw new Error(result.stderr.trim() || "Claude Code 没有返回插件操作结果。");
  const parsed = z
    .object({
      outcome: z.enum(["ok", "failed"]),
      message: z.string(),
      alreadyInGoalState: z.boolean().optional(),
      shownCommand: z.record(z.string(), z.json()).optional(),
    })
    .parse(parseJson(last));
  if (parsed.shownCommand && (action.kind === "install" || action.kind === "update")) {
    const sha256 = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(parsed.shownCommand.sha256);
    return {
      restartRequired: false,
      message: "此插件需要执行市场提供的命令，请核对后单独确认。",
      confirmation: { sha256, description: JSON.stringify(parsed.shownCommand, null, 2) },
    };
  }
  if (parsed.outcome !== "ok" && !parsed.alreadyInGoalState) throw new Error(parsed.message);
  if (result.exitCode !== 0 && !parsed.alreadyInGoalState) throw new Error(parsed.message);
  return {
    restartRequired: action.kind !== "refresh_marketplace",
    message: parsed.message,
    confirmation: null,
  };
}

async function localMetadata(
  installed: z.infer<typeof InstalledSchema> | undefined,
  entry: Record<string, unknown> | null,
  market: z.infer<typeof MarketSchema> | undefined,
) {
  let root = installed ? (installed.readFromFolder ?? installed.installPath) : null;
  const errors: string[] = [];
  let metadata = entry === null ? null : ManifestSchema.parse(entry);
  let iconUrl: string | null = null;
  try {
    if (
      root === null &&
      market?.installLocation &&
      entry !== null &&
      typeof entry.source === "string" &&
      entry.source.startsWith("./")
    )
      root = await contained(market.installLocation, entry.source);
    if (root !== null) {
      const bytes = await optionalFile(
        await optionalContainedPath(root, ".claude-plugin/plugin.json"),
        256 * 1024,
      );
      if (bytes !== null)
        metadata = ManifestSchema.parse({
          ...metadata,
          ...z.record(z.string(), z.unknown()).parse(parseJson(bytes.toString("utf8"))),
        });
      iconUrl = await icon(root, metadata?.icon);
    }
  } catch (error) {
    console.error("Claude 插件本地资料读取失败", installed?.id ?? entry?.name, error);
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { root, metadata, iconUrl, errors };
}
function metadataFields(metadata: z.infer<typeof ManifestSchema> | null) {
  const author = metadata?.author;
  return {
    title: metadata?.displayName ?? null,
    description: metadata?.description ?? null,
    version: metadata?.version ?? null,
    developer: typeof author === "string" ? author : (author?.name ?? null),
    websiteUrl: metadata?.homepage ?? null,
    components: [
      ["skills", "技能"],
      ["agents", "智能体"],
      ["commands", "命令"],
      ["hooks", "钩子"],
      ["mcpServers", "MCP 服务"],
      ["lspServers", "LSP 服务"],
    ]
      .filter(([key]) => metadata !== null && metadata[key] !== undefined)
      .map(([, label]) => label),
  };
}
