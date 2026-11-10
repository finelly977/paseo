import os from "node:os";
import { expect, test } from "vitest";
import { createTestPaseoDaemon } from "../../../test-utils/paseo-daemon.js";
import { createTestAgentClients } from "../../../test-utils/fake-agent-client.js";
import { DaemonClient } from "../../../test-utils/daemon-client.js";
import { createClaudePluginMarketplaceService } from "./plugin-marketplace.js";

test("Claude 市场经过真实 WebSocket 管理，不创建或重启对话", async () => {
  let installed = false;
  const calls: string[][] = [];
  const agents = createTestAgentClients();
  agents.claude.claudePlugins = createClaudePluginMarketplaceService({
    defaultCwd: os.tmpdir(),
    run: async (args) => {
      calls.push(args);
      if (args[0] === "list")
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            installed: installed
              ? [
                  {
                    id: "demo@test",
                    version: "1",
                    scope: "user",
                    enabled: true,
                    installPath: os.tmpdir(),
                  },
                ]
              : [],
            available: [
              {
                pluginId: "demo@test",
                name: "demo",
                marketplaceName: "test",
                description: "测试插件",
              },
            ],
          }),
        };
      if (args[0] === "marketplace") return { exitCode: 0, stderr: "", stdout: "[]" };
      if (args[0] === "install") {
        installed = true;
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({ outcome: "ok", message: "已安装" }),
        };
      }
      return {
        exitCode: 1,
        stderr: "",
        stdout: JSON.stringify({ outcome: "failed", message: "原生卸载失败" }),
      };
    },
  });
  const daemon = await createTestPaseoDaemon({
    agentClients: agents,
    mcpEnabled: false,
    relayEnabled: false,
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  try {
    await client.connect();
    expect(client.getLastServerInfoMessage()?.features?.claudePluginMarket).toBe(true);
    expect((await client.getClaudePluginCatalog({ force: false })).total).toBe(1);
    expect((await client.getClaudePluginDetail("demo@test")).contentStatus).toBe(
      "install_required",
    );
    await client.manageClaudePlugin({ kind: "install", pluginId: "demo@test", scope: "user" });
    expect(
      (await client.getClaudePluginCatalog({ force: false, installedOnly: true })).plugins[0]
        .installed,
    ).toBe(true);
    await expect(
      client.manageClaudePlugin({ kind: "uninstall", pluginId: "demo@test", scope: "user" }),
    ).rejects.toThrow("原生卸载失败");
    expect(calls).toContainEqual(["install", "demo@test", "--scope", "user", "--json"]);
  } finally {
    await client.close();
    await daemon.close();
  }
}, 40000);
