import { expect, test } from "vitest";
import pino from "pino";
import { createTestPaseoDaemon } from "../../../test-utils/paseo-daemon.js";
import { createTestAgentClients } from "../../../test-utils/fake-agent-client.js";
import { DaemonClient } from "../../../test-utils/daemon-client.js";
import { CodexAppServerClient } from "./app-server-transport.js";
import { createFakeCodexAppServer } from "./test-utils/fake-app-server.js";
import { createCodexPluginMarketplaceService } from "./plugin-marketplace.js";

test("真实 WebSocket 往返插件目录、安装及原生错误，不启动对话", async () => {
  let installed = false;
  const native = createFakeCodexAppServer({
    "plugin/list": () => ({
      marketplaces: [
        {
          name: "test",
          path: null,
          plugins: [
            {
              id: "demo@test",
              name: "demo",
              installed,
              enabled: installed,
              installPolicy: "AVAILABLE",
              authPolicy: "ON_USE",
            },
          ],
        },
      ],
      marketplaceLoadErrors: [],
    }),
    "plugin/install": () => {
      installed = true;
      return { appsNeedingAuth: [] };
    },
    "plugin/uninstall": () => ({ __jsonRpcError: { code: -1, message: "原生插件卸载失败" } }),
    "plugin/read": () => ({
      plugin: {
        summary: {
          id: "demo@test",
          name: "demo",
          installed,
          enabled: installed,
          installPolicy: "AVAILABLE",
          authPolicy: "ON_USE",
        },
        description: "测试插件详情",
        apps: [],
        skills: [{ name: "test-skill", description: "测试技能" }],
        mcpServers: ["tools"],
      },
    }),
  });
  const clients = createTestAgentClients();
  clients.codex.codexPlugins = createCodexPluginMarketplaceService({
    openClient: async () =>
      new CodexAppServerClient(await native.spawnChild(), pino({ level: "silent" })),
  });
  const daemon = await createTestPaseoDaemon({
    agentClients: clients,
    mcpEnabled: false,
    relayEnabled: false,
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  try {
    await client.connect();
    expect(client.getLastServerInfoMessage()?.features?.codexPluginMarket).toBe(true);
    const first = await client.getCodexPluginCatalog({ scope: "official", force: false });
    expect(first.marketplaces[0].plugins[0].installed).toBe(false);
    const detail = await client.getCodexPluginDetail({
      marketplaceName: "test",
      marketplacePath: null,
      pluginName: "demo",
    });
    expect(detail.description).toBe("测试插件详情");
    expect(detail.skills).toEqual([{ name: "test-skill", description: "测试技能" }]);
    expect(
      await client.manageCodexPlugin({
        kind: "install",
        marketplacePath: null,
        marketplaceName: "test",
        pluginName: "demo",
      }),
    ).toEqual({ authApps: [], restartRequired: true });
    const next = await client.getCodexPluginCatalog({
      scope: "official",
      force: false,
      installedOnly: true,
    });
    expect(next.total).toBe(1);
    expect(next.marketplaces[0].plugins[0].installed).toBe(true);
    await expect(
      client.manageCodexPlugin({ kind: "uninstall", pluginId: "demo@test" }),
    ).rejects.toThrow("原生插件卸载失败");
    expect(native.requests().some((request) => request.method === "thread/start")).toBe(false);
    native.assertNoErrors();
  } finally {
    await client.close();
    await daemon.close();
  }
}, 40_000);
