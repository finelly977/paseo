import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { ClaudeAgentClient } from "./agent.js";
import {
  createClaudePluginMarketplaceService,
  createClaudePluginRunner,
} from "./plugin-marketplace.js";

let fixtureRoot: string | null = null;
afterEach(async () => {
  if (fixtureRoot === null) return;
  const target = path.resolve(fixtureRoot);
  if (!target.startsWith(path.join(os.tmpdir(), "paseo-claude-market-test-")))
    throw new Error("原生市场测试清理路径越界");
  await rm(target, { recursive: true, force: true });
  fixtureRoot = null;
});

test("隔离的真实 Claude Code 市场完成安装、SDK 发现、启停、更新与卸载", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-claude-market-test-"));
  fixtureRoot = root;
  const home = path.join(root, "home");
  const cwd = path.join(root, "project");
  const market = path.join(root, "market");
  const plugin = path.join(market, "plugins", "paseo-market-test");
  await mkdir(path.join(plugin, ".claude-plugin"), { recursive: true });
  await mkdir(path.join(plugin, "skills", "market-echo"), { recursive: true });
  await mkdir(path.join(market, ".claude-plugin"), { recursive: true });
  await mkdir(home, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeFile(
    path.join(home, "settings.json"),
    JSON.stringify({ autoUpdatesChannel: "stable" }),
  );
  await writeFile(
    path.join(plugin, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      name: "paseo-market-test",
      description: "隔离验收插件，不包含钩子或 MCP",
      version: "1.0.0",
      icon: "icon.svg",
    }),
  );
  await writeFile(
    path.join(plugin, "icon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#3687ed" d="M4 4h16v16H4z"/></svg>',
  );
  await writeFile(
    path.join(plugin, "README.md"),
    "# 市场验收插件\n\n用于验证真实原生管理与技能发现，不发送模型请求。",
  );
  await writeFile(
    path.join(plugin, "skills", "market-echo", "SKILL.md"),
    "---\nname: market-echo\ndescription: 用于隔离市场验收的测试技能\n---\n返回市场验收已就绪。\n",
  );
  await writeFile(
    path.join(market, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "paseo-market-fixture",
      owner: { name: "Paseo 测试" },
      plugins: [
        {
          name: "paseo-market-test",
          source: "./plugins/paseo-market-test",
          description: "隔离原生市场验收",
        },
      ],
    }),
  );
  const runtimeSettings = {
    env: {
      CLAUDE_CONFIG_DIR: home,
      DISABLE_AUTOUPDATER: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    },
  };
  const logger = pino({ level: "silent" });
  const service = createClaudePluginMarketplaceService({
    run: createClaudePluginRunner({ runtimeSettings, logger }),
    defaultCwd: cwd,
  });
  await service.manage({ kind: "add_marketplace", source: market, scope: "user" });
  const first = await service.catalog({ force: true });
  expect(first.plugins[0].installed).toBe(false);
  expect(first.plugins[0].iconUrl).toMatch(/^data:image\/svg/);
  const id = "paseo-market-test@paseo-market-fixture";
  expect(
    (await service.manage({ kind: "install", pluginId: id, scope: "user" })).confirmation,
  ).toBeNull();
  expect((await service.detail(id)).plugin.enabled).toBe(true);
  const agentClient = new ClaudeAgentClient({ logger, runtimeSettings });
  const session = await agentClient.createSession(
    { provider: "claude", cwd, modeId: "default" },
    undefined,
    { persistSession: false },
  );
  try {
    if (!session.listCommands) throw new Error("缺少命令发现接口");
    const commands = await session.listCommands();
    expect(commands.map((item) => item.name)).toContain("paseo-market-test:market-echo");
  } finally {
    await session.close();
  }
  await service.manage({ kind: "set_enabled", pluginId: id, scope: "user", enabled: false });
  expect((await service.detail(id)).plugin.enabled).toBe(false);
  const disabledSession = await agentClient.createSession(
    { provider: "claude", cwd, modeId: "default" },
    undefined,
    { persistSession: false },
  );
  try {
    if (!disabledSession.listCommands) throw new Error("缺少命令发现接口");
    expect((await disabledSession.listCommands()).map((item) => item.name)).not.toContain(
      "paseo-market-test:market-echo",
    );
  } finally {
    await disabledSession.close();
  }
  await service.manage({ kind: "set_enabled", pluginId: id, scope: "user", enabled: true });
  expect((await service.detail(id)).plugin.enabled).toBe(true);
  await service.manage({ kind: "update", pluginId: id, scope: "user" });
  await service.manage({ kind: "uninstall", pluginId: id, scope: "user" });
  expect((await service.detail(id)).plugin.installed).toBe(false);
  await service.manage({ kind: "install", pluginId: id, scope: "project" }, cwd);
  expect((await service.detail(id, cwd)).plugin.installations).toEqual([
    expect.objectContaining({ scope: "project" }),
  ]);
  await service.manage({ kind: "uninstall", pluginId: id, scope: "project" }, cwd);
}, 180_000);
