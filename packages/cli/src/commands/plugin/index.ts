import { Command } from "commander";
import path from "node:path";
import type {
  PluginListItem,
  PluginLogEntry,
  PluginSourceStatusItem,
  PluginSourceUpdateItem,
} from "@getpaseo/protocol/messages";
import type { CommandOptions, ListResult, OutputSchema, SingleResult } from "../../output/index.js";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions, addJsonOption } from "../../utils/command-options.js";
import { scaffoldPluginDirectory, type PluginScaffold } from "./scaffold.js";
import {
  withPluginLogsClient,
  withPluginManagementClient,
  withPluginSourceClient,
} from "./shared.js";

interface PluginOptions extends CommandOptions {
  host?: string;
  id?: string;
  ref?: string;
  path?: string;
  all?: boolean;
}

const pluginActionDescriptions = {
  reload: "重新加载插件",
  enable: "启用插件",
  disable: "禁用插件",
} as const;

const pluginSchema: OutputSchema<PluginListItem> = {
  idField: "id",
  columns: [
    { header: "插件", field: "id", width: 20 },
    { header: "状态", field: "status", width: 10 },
    { header: "已启用", field: (plugin) => (plugin.enabled ? "是" : "否"), width: 8 },
    { header: "目录", field: "path", width: 40 },
    { header: "错误", field: (plugin) => plugin.error ?? "", width: 40 },
  ],
};

const scaffoldSchema: OutputSchema<PluginScaffold> = {
  idField: "id",
  columns: [
    { header: "插件", field: "id", width: 20 },
    { header: "目录", field: "directory", width: 60 },
  ],
};

const pluginLogsSchema: OutputSchema<PluginLogEntry> = {
  idField: (entry) => String(entry.sequence),
  columns: [
    { header: "时间", field: "timestamp", width: 24 },
    { header: "输出流", field: "stream", width: 8 },
    { header: "消息", field: "message", width: 80 },
  ],
};

function shortCommit(commit: string | undefined): string {
  return commit?.slice(0, 12) ?? "-";
}

const pluginStatusSchema: OutputSchema<PluginSourceStatusItem> = {
  idField: "id",
  columns: [
    { header: "插件", field: "id", width: 20 },
    { header: "来源", field: "source", width: 10 },
    { header: "当前提交", field: (plugin) => shortCommit(plugin.currentCommit), width: 14 },
    { header: "最新提交", field: (plugin) => shortCommit(plugin.latestCommit), width: 14 },
    { header: "落后提交", field: (plugin) => String(plugin.commitsBehind ?? 0), width: 8 },
    { header: "引用", field: (plugin) => plugin.ref ?? "-", width: 24 },
  ],
};

const pluginUpdateSchema: OutputSchema<PluginSourceUpdateItem> = {
  idField: "id",
  columns: [
    { header: "插件", field: "id", width: 20 },
    { header: "更新前", field: (plugin) => shortCommit(plugin.previousCommit), width: 14 },
    { header: "当前提交", field: (plugin) => shortCommit(plugin.currentCommit), width: 14 },
    { header: "提交数", field: (plugin) => String(plugin.commits), width: 8 },
    { header: "已更新", field: (plugin) => (plugin.updated ? "是" : "否"), width: 8 },
  ],
};

export async function runPluginInitCommand(
  directory: string,
  options: PluginOptions,
  _command: Command,
): Promise<SingleResult<PluginScaffold>> {
  return {
    type: "single",
    data: await scaffoldPluginDirectory(directory, options.id),
    schema: scaffoldSchema,
  };
}

export async function runPluginListCommand(
  options: PluginOptions,
  _command: Command,
): Promise<ListResult<PluginListItem>> {
  const data = await withPluginManagementClient(options.host, (client) => client.listPlugins());
  return { type: "list", data, schema: pluginSchema };
}

export async function runPluginLogsCommand(
  pluginId: string,
  options: PluginOptions,
  _command: Command,
): Promise<ListResult<PluginLogEntry>> {
  const data = await withPluginLogsClient(options.host, (client) => client.getPluginLogs(pluginId));
  return { type: "list", data, schema: pluginLogsSchema };
}

async function install(
  source: string,
  options: PluginOptions,
  _command: Command,
): Promise<SingleResult<PluginListItem>> {
  const isExplicitPath =
    path.isAbsolute(source) ||
    source === "." ||
    source === ".." ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    source.startsWith(".\\") ||
    source.startsWith("..\\");
  const canUseLegacyDirectoryInstall = isExplicitPath && !options.ref && !options.path;
  const data = canUseLegacyDirectoryInstall
    ? await withPluginManagementClient(options.host, (client) =>
        client.installDirectoryPlugin(source, options.id),
      )
    : await withPluginSourceClient(options.host, (client) =>
        client.installPluginSource({
          source,
          ...(options.id ? { id: options.id } : {}),
          ...(options.ref ? { ref: options.ref } : {}),
          ...(options.path ? { pluginPath: options.path } : {}),
        }),
      );
  return { type: "single", data, schema: pluginSchema };
}

async function status(
  pluginId: string | undefined,
  options: PluginOptions,
  _command: Command,
): Promise<ListResult<PluginSourceStatusItem>> {
  const data = await withPluginSourceClient(options.host, (client) =>
    client.getPluginSourceStatus(pluginId),
  );
  return { type: "list", data, schema: pluginStatusSchema };
}

async function update(
  pluginId: string | undefined,
  options: PluginOptions,
  _command: Command,
): Promise<ListResult<PluginSourceUpdateItem>> {
  if ((pluginId === undefined) === (options.all !== true)) {
    throw new Error("请选择一个插件标识，或传入 --all");
  }
  const data = await withPluginSourceClient(options.host, (client) =>
    client.updatePluginSources(pluginId),
  );
  return { type: "list", data, schema: pluginUpdateSchema };
}

async function act(
  action: "reload" | "enable" | "disable",
  pluginId: string,
  options: PluginOptions,
): Promise<SingleResult<PluginListItem>> {
  const data = await withPluginManagementClient(options.host, (client) =>
    client[`${action}Plugin`](pluginId),
  );
  return { type: "single", data, schema: pluginSchema };
}

async function remove(
  pluginId: string,
  options: PluginOptions,
  _command: Command,
): Promise<SingleResult<PluginListItem>> {
  const data = await withPluginManagementClient(options.host, async (client) => {
    const current = (await client.listPlugins()).find((plugin) => plugin.id === pluginId);
    if (!current) throw new Error(`插件尚未配置：${pluginId}`);
    await client.removePlugin(pluginId);
    return { ...current, enabled: false, status: "disabled" as const };
  });
  return { type: "single", data, schema: pluginSchema };
}

export function createPluginCommand(): Command {
  const plugin = new Command("plugin").description("管理受信任插件");
  addJsonOption(
    plugin
      .command("init")
      .description("创建可执行类型检查的本地插件")
      .argument("<directory>")
      .option("--id <id>", "清单中的插件标识（默认使用目录名）"),
  ).action(withOutput(runPluginInitCommand));
  addJsonAndDaemonHostOptions(plugin.command("ls").description("列出已配置的插件")).action(
    withOutput(runPluginListCommand),
  );
  addJsonAndDaemonHostOptions(
    plugin.command("logs").description("显示插件最近的输出").argument("<id>"),
  ).action(withOutput(runPluginLogsCommand));
  addJsonAndDaemonHostOptions(
    plugin
      .command("install")
      .alias("add")
      .description("从目录或 Git 仓库安装插件")
      .argument("<source>", "宿主目录、所有者/仓库简写或 Git 地址")
      .option("--id <id>", "运行时插件标识（默认使用 paseo-plugin.json 中的标识）")
      .option("--ref <ref>", "Git 分支、标签或提交")
      .option("--path <path>", "仓库内的插件目录"),
  ).action(withOutput(install));
  addJsonAndDaemonHostOptions(
    plugin.command("status").description("检查插件来源更新").argument("[id]"),
  ).action(withOutput(status));
  addJsonAndDaemonHostOptions(
    plugin
      .command("update")
      .description("更新由 Git 管理的插件")
      .argument("[id]")
      .option("--all", "更新所有由 Git 管理的插件"),
  ).action(withOutput(update));
  for (const action of ["reload", "enable", "disable"] as const) {
    addJsonAndDaemonHostOptions(
      plugin.command(action).description(pluginActionDescriptions[action]).argument("<id>"),
    ).action(
      withOutput((id: string, options: PluginOptions, _command: Command) =>
        act(action, id, options),
      ),
    );
  }
  addJsonAndDaemonHostOptions(
    plugin.command("remove").description("移除插件配置").argument("<id>"),
  ).action(withOutput(remove));
  return plugin;
}
