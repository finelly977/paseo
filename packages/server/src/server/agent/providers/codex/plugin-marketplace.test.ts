import { expect, test } from "vitest";
import pino from "pino";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CodexPluginAction } from "@getpaseo/protocol/codex-plugins";
import { createFakeCodexAppServer, type FakeCodexAppServer } from "./test-utils/fake-app-server.js";
import { CodexAppServerClient } from "./app-server-transport.js";
import { createCodexPluginMarketplaceService } from "./plugin-marketplace.js";

function plugin(index: number) {
  return {
    id: `plugin-${index}@test`,
    name: `plugin-${index}`,
    installed: false,
    enabled: false,
    installPolicy: "AVAILABLE",
    authPolicy: "ON_USE",
    localVersion: null,
    version: "1",
    interface: { displayName: `插件 ${index}`, shortDescription: `测试技能 ${index}` },
    disabledReason: null,
  };
}
function service(server: FakeCodexAppServer) {
  return createCodexPluginMarketplaceService({
    openClient: async () =>
      new CodexAppServerClient(await server.spawnChild(), pino({ level: "silent" })),
  });
}
function catalog(count = 1) {
  return {
    marketplaces: [
      {
        name: "test",
        path: "C:/test/.agents/plugins/marketplace.json",
        plugins: Array.from({ length: count }, (_, i) => plugin(i)),
      },
    ],
    marketplaceLoadErrors: [],
  };
}

test("插件详情保留官方品牌图标与元数据，应用、技能和工具分别展示", async () => {
  const item = {
    ...plugin(0),
    interface: {
      ...plugin(0).interface,
      logoUrl: "https://files.openai.com/icon.png",
      logoUrlDark: "https://files.openai.com/icon-dark.png",
      developerName: "发布者",
      category: "Creativity",
      websiteUrl: "https://example.com",
      longDescription: "完整介绍",
    },
  };
  const native = createFakeCodexAppServer({
    "plugin/read": () => ({
      plugin: {
        summary: item,
        description: "插件完整介绍",
        apps: [{ name: "应用", description: "应用介绍", installUrl: "https://example.com/auth" }],
        skills: [{ name: "render", description: "渲染视频" }],
        mcpServers: ["tools"],
      },
    }),
  });
  const detail = await service(native).detail({
    marketplaceName: "test",
    marketplacePath: null,
    pluginName: "plugin-0",
  });
  expect(detail.plugin).toMatchObject({
    iconUrl: "https://files.openai.com/icon.png",
    iconUrlDark: "https://files.openai.com/icon-dark.png",
    developer: "发布者",
    category: "Creativity",
  });
  expect(detail.description).toBe("插件完整介绍");
  expect(detail.skills).toEqual([{ name: "render", description: "渲染视频" }]);
  expect(detail.apps).toEqual([
    { name: "应用", description: "应用介绍", url: "https://example.com/auth" },
  ]);
  expect(detail.mcpServers).toEqual(["tools"]);
  native.assertNoErrors();
});

test("本地插件图标在主机转为可传输图像，不把本机路径交给远程客户端", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-plugin-icon-"));
  try {
    const logo = path.join(root, "icon.png");
    await writeFile(logo, Buffer.from("icon"));
    const raw = {
      ...catalog(),
      marketplaces: [
        {
          ...catalog().marketplaces[0],
          plugins: [{ ...plugin(0), interface: { ...plugin(0).interface, logo } }],
        },
      ],
    };
    const native = createFakeCodexAppServer({ "plugin/list": () => raw });
    const result = await service(native).catalog({ scope: "local", force: false });
    expect(result.marketplaces[0].plugins[0].iconUrl).toBe("data:image/png;base64,aWNvbg==");
    native.assertNoErrors();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("目录按 50 项分页，搜索复用同一原生快照，不创建对话", async () => {
  const native = createFakeCodexAppServer({ "plugin/list": () => catalog(73) });
  const market = service(native);
  const first = await market.catalog({ scope: "local", force: false });
  expect(first.total).toBe(73);
  expect(first.nextOffset).toBe(50);
  expect(first.marketplaces[0].plugins).toHaveLength(50);
  const second = await market.catalog({ scope: "local", force: false, offset: 50 });
  expect(second.marketplaces[0].plugins).toHaveLength(23);
  expect(second.nextOffset).toBeNull();
  const search = await market.catalog({ scope: "local", force: false, query: "测试技能 72" });
  expect(search.total).toBe(1);
  expect(search.marketplaces[0].plugins[0].id).toBe("plugin-72@test");
  expect(native.children).toHaveLength(1);
  expect(native.requests().filter((r) => r.method === "thread/start")).toEqual([]);
  expect(native.requests()).toContainEqual(
    expect.objectContaining({
      method: "plugin/list",
      params: { forceRefetch: false, marketplaceKinds: ["local"] },
    }),
  );
  native.assertNoErrors();
});

test("官方目录只交付远程市场，本地目录不混入；部分来源错误保留", async () => {
  const raw = catalog();
  const native = createFakeCodexAppServer({
    "plugin/list": () => ({
      marketplaces: [
        ...raw.marketplaces,
        { name: "remote", path: null, plugins: [{ ...plugin(2), id: "plugin-2@remote" }] },
      ],
      marketplaceLoadErrors: [{ marketplacePath: "C:/missing", message: "目录不存在" }],
    }),
  });
  const result = await service(native).catalog({ scope: "official", force: true });
  expect(result.marketplaces.map((m) => m.name)).toEqual(["remote"]);
  expect(result.errors).toEqual([{ path: "C:/missing", message: "目录不存在" }]);
  expect(native.requests()).toContainEqual(
    expect.objectContaining({ method: "plugin/list", params: { forceRefetch: true } }),
  );
  native.assertNoErrors();
});

test("原生读取失败和非法状态明确报错，不缓存为空目录", async () => {
  let failure = true;
  const native = createFakeCodexAppServer({
    "plugin/list": () =>
      failure ? { __jsonRpcError: { code: -1, message: "目录网络不可用" } } : catalog(),
  });
  const market = service(native);
  await expect(market.catalog({ scope: "local", force: false })).rejects.toThrow("目录网络不可用");
  failure = false;
  expect((await market.catalog({ scope: "local", force: false })).total).toBe(1);
  native.assertNoErrors();
  const malformed = createFakeCodexAppServer({
    "plugin/list": () => ({
      marketplaces: [
        { name: "broken", path: null, plugins: [{ ...plugin(0), installed: "true" }] },
      ],
      marketplaceLoadErrors: [],
    }),
  });
  await expect(service(malformed).catalog({ scope: "official", force: false })).rejects.toThrow();
  malformed.assertNoErrors();
});

const actions: Array<{ action: CodexPluginAction; method: string; params: object }> = [
  {
    action: {
      kind: "install",
      marketplaceName: "test",
      marketplacePath: "C:/market.json",
      pluginName: "plugin-0",
    },
    method: "plugin/install",
    params: { marketplacePath: "C:/market.json", pluginName: "plugin-0" },
  },
  {
    action: {
      kind: "install",
      marketplaceName: "remote",
      marketplacePath: null,
      pluginName: "plugin-0",
    },
    method: "plugin/install",
    params: { remoteMarketplaceName: "remote", pluginName: "plugin-0" },
  },
  {
    action: { kind: "uninstall", pluginId: "plugin-0@test" },
    method: "plugin/uninstall",
    params: { pluginId: "plugin-0@test" },
  },
  {
    action: { kind: "set_enabled", pluginId: "plugin-0@test", enabled: false },
    method: "config/value/write",
    params: { keyPath: 'plugins."plugin-0@test".enabled', value: false, mergeStrategy: "upsert" },
  },
  {
    action: {
      kind: "add_marketplace",
      source: "owner/repo",
      ref: "main",
      sparsePaths: ["plugins"],
    },
    method: "marketplace/add",
    params: { source: "owner/repo", refName: "main", sparsePaths: ["plugins"] },
  },
  {
    action: { kind: "refresh_marketplace", name: "test" },
    method: "marketplace/upgrade",
    params: { marketplaceName: "test" },
  },
  {
    action: { kind: "remove_marketplace", name: "test" },
    method: "marketplace/remove",
    params: { marketplaceName: "test" },
  },
];
test.each(actions)(
  "插件操作直接转发原生 $method，不发送模型对话",
  async ({ action, method, params }) => {
    const native = createFakeCodexAppServer({
      [method]: () => ({
        appsNeedingAuth: [{ name: "GitHub", installUrl: "https://chatgpt.com/" }],
      }),
    });
    const result = await service(native).manage(action);
    expect(native.requests()).toContainEqual(expect.objectContaining({ method, params }));
    expect(native.requests().some((r) => r.method === "thread/start")).toBe(false);
    expect(result.authApps).toEqual(
      action.kind === "install" ? [{ name: "GitHub", url: "https://chatgpt.com/" }] : [],
    );
    expect(result.restartRequired).toBe(action.kind !== "refresh_marketplace");
    native.assertNoErrors();
  },
);

test("更改插件后目录缓存失效，失败的安装也不会显示成功", async () => {
  const native = createFakeCodexAppServer({
    "plugin/list": () => catalog(),
    "config/value/write": () => ({}),
    "plugin/install": () => ({ __jsonRpcError: { code: -1, message: "安装被策略拒绝" } }),
  });
  const market = service(native);
  await market.catalog({ scope: "local", force: false });
  await market.manage({ kind: "set_enabled", pluginId: "plugin-0@test", enabled: false });
  await market.catalog({ scope: "local", force: false });
  expect(native.requests().filter((r) => r.method === "plugin/list")).toHaveLength(2);
  await expect(
    market.manage({
      kind: "install",
      marketplaceName: "test",
      marketplacePath: null,
      pluginName: "plugin-0",
    }),
  ).rejects.toThrow("安装被策略拒绝");
  native.assertNoErrors();
});
