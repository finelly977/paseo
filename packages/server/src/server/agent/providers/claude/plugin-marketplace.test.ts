import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createClaudePluginMarketplaceService,
  type ClaudePluginRunner,
} from "./plugin-marketplace.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const absolute = path.resolve(root);
    if (!absolute.startsWith(path.join(os.tmpdir(), "claude-market-test-")))
      throw new Error("测试清理路径越界");
    await rm(absolute, { recursive: true, force: true });
  }
});
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "claude-market-test-"));
  roots.push(dir);
  const market = path.join(dir, "market");
  const plugin = path.join(market, "plugins", "hello");
  await mkdir(path.join(plugin, ".claude-plugin"), { recursive: true });
  await mkdir(path.join(market, ".claude-plugin"), { recursive: true });
  await writeFile(
    path.join(market, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "test", plugins: [{ name: "hello", source: "./plugins/hello" }] }),
  );
  await writeFile(
    path.join(plugin, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      name: "hello",
      displayName: "测试插件",
      description: "真实说明",
      version: "1.0.0",
      icon: "logo.svg",
      author: { name: "测试作者" },
    }),
  );
  await writeFile(path.join(plugin, "README.md"), "# 插件说明\n\n真实的本地文档");
  await writeFile(path.join(plugin, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const calls: string[][] = [];
  let installed = true;
  const run: ClaudePluginRunner = async (args) => {
    calls.push(args);
    let output: unknown;
    if (args[0] === "list")
      output = {
        installed: installed
          ? [
              {
                id: "hello@test",
                version: "1",
                scope: "user",
                enabled: true,
                installPath: plugin,
                mcpServers: { secret: { env: { TOKEN: "不能传到客户端" } } },
              },
            ]
          : [],
        available: [
          {
            pluginId: "hello@test",
            name: "hello",
            marketplaceName: "test",
            description: "目录说明",
          },
          ...Array.from({ length: 60 }, (_, i) => ({
            pluginId: `remote-${i}@test`,
            name: `remote-${i}`,
            marketplaceName: "test",
            description: "远程插件",
          })),
        ],
      };
    else if (args[0] === "marketplace" && args[1] === "list")
      output = [{ name: "test", source: "directory", installLocation: market }];
    else {
      if (args[0] === "uninstall") installed = false;
      output = { outcome: "ok", message: "原生成功" };
    }
    return { exitCode: 0, stdout: JSON.stringify(output), stderr: "" };
  };
  return {
    dir,
    plugin,
    run,
    calls,
    service: createClaudePluginMarketplaceService({ run, defaultCwd: dir }),
  };
}
test("目录分页、原生品牌图标与详情保留真实资料，不交付 MCP 凭据", async () => {
  const { service, calls } = await fixture();
  const first = await service.catalog({ force: false });
  expect(first.plugins).toHaveLength(50);
  expect(first.total).toBe(61);
  expect(first.nextOffset).toBe(50);
  expect(first.plugins[0]).toMatchObject({
    title: "测试插件",
    developer: "测试作者",
    installed: true,
  });
  expect(first.plugins[0].iconUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(JSON.stringify(first)).not.toContain("不能传到客户端");
  const detail = await service.detail("hello@test");
  expect(detail.readme).toContain("真实的本地文档");
  expect(detail.contentStatus).toBe("available");
  const remote = await service.detail("remote-0@test");
  expect(remote.contentStatus).toBe("install_required");
  expect(remote.readme).toBeNull();
  await service.catalog({ force: false, installedOnly: true });
  expect(calls.filter((c) => c[0] === "list")).toHaveLength(1);
});
test("原生操作串行执行并清掉成功缓存，卸载只作用于明确范围", async () => {
  const { service, calls } = await fixture();
  await service.catalog({ force: false });
  await service.manage({ kind: "uninstall", pluginId: "hello@test", scope: "user" });
  expect(calls).toContainEqual([
    "uninstall",
    "hello@test",
    "--scope",
    "user",
    "--keep-data",
    "--json",
  ]);
  expect((await service.catalog({ force: false, installedOnly: true })).plugins).toEqual([]);
  await expect(
    service.manage({ kind: "install", pluginId: "hello@test", scope: "project" }),
  ).rejects.toThrow("应用项目目录");
});
test("原生命令确认单独交给用户，不自动添加 yes；读取失败不返回空目录", async () => {
  const { dir } = await fixture();
  const calls: string[][] = [];
  const run: ClaudePluginRunner = async (args) => {
    calls.push(args);
    return {
      exitCode: 1,
      stderr: "",
      stdout:
        "先打印安装命令\n" +
        JSON.stringify({
          outcome: "failed",
          message: "需要确认",
          shownCommand: { sha256: "a".repeat(64), command: "测试命令" },
        }),
    };
  };
  const service = createClaudePluginMarketplaceService({ run, defaultCwd: dir });
  expect(
    (await service.manage({ kind: "install", pluginId: "hello@test", scope: "user" })).confirmation
      ?.sha256,
  ).toBe("a".repeat(64));
  expect(calls[0]).not.toContain("--yes");
  await service.manage({
    kind: "install",
    pluginId: "hello@test",
    scope: "user",
    acceptCommand: "a".repeat(64),
  });
  expect(calls[1]).toEqual([
    "install",
    "hello@test",
    "--scope",
    "user",
    "--accept-command",
    "a".repeat(64),
    "--json",
  ]);
  await expect(service.catalog({ force: false })).rejects.toThrow("目录读取失败");
});
test("图标越界可见报错，找不到插件时明确失败", async () => {
  const { service, plugin, dir } = await fixture();
  await writeFile(path.join(dir, "outside.svg"), "不能交付");
  await writeFile(
    path.join(plugin, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "hello", icon: "../../../outside.svg" }),
  );
  const catalog = await service.catalog({ force: true });
  expect(catalog.plugins[0].errors.join()).toContain("超出插件目录");
  expect(catalog.plugins[0].iconUrl).toBeNull();
  await expect(service.detail("missing@test")).rejects.toThrow("未找到");
});
