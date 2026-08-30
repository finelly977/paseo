import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pino from "pino";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { OpenCodeAgentClient } from "../agent/providers/opencode-agent.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { canRunRealProvider } from "./real-provider-test-config.js";

const SLOW_PLUGIN_MS = 20_000;

describe("守护进程真实 OpenCode 端到端测试：慢插件就绪", () => {
  let canRun = false;

  beforeAll(async () => {
    canRun = await canRunRealProvider("opencode");
  });

  beforeEach((context) => {
    if (!canRun) context.skip();
  });

  test("全局插件初始化较慢时，新的独立实例仍能正常启动", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "paseo-opencode-slow-plugin-"));
    const cwd = path.join(root, "worktree");
    const configHome = path.join(root, "config");
    const dataHome = path.join(root, "data");
    const cacheHome = path.join(root, "cache");
    const pluginPath = path.join(root, "slow-plugin.js");
    const configDir = path.join(configHome, "opencode");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(configDir, { recursive: true });
    mkdirSync(dataHome, { recursive: true });
    mkdirSync(cacheHome, { recursive: true });
    writeFileSync(
      pluginPath,
      [
        "export default async () => {",
        `  await new Promise((resolve) => setTimeout(resolve, ${SLOW_PLUGIN_MS}))`,
        "  return {}",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(configDir, "opencode.json"),
      JSON.stringify({ plugin: [pathToFileURL(pluginPath).href] }, null, 2),
    );

    const logger = pino({ level: "silent" });
    const openCode = new OpenCodeAgentClient(logger, {
      env: {
        XDG_CONFIG_HOME: configHome,
        XDG_DATA_HOME: dataHome,
        XDG_CACHE_HOME: cacheHome,
        OPENCODE_DISABLE_AUTO_UPDATE: "1",
      },
    });
    const daemon = await createTestPaseoDaemon({
      agentClients: { opencode: openCode },
      logger,
    });
    const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();
    await client.fetchAgents({ subscribe: { subscriptionId: "opencode-slow-plugin" } });

    try {
      const agent = await client.createAgent({
        provider: "opencode",
        cwd,
        title: "OpenCode 慢插件就绪回归测试",
        model: "diagnostic/missing-model",
        initialPrompt: "diagnostic first turn",
      });
      const finish = await client.waitForFinish(agent.id, 90_000);
      expect(finish.error).not.toContain("OpenCode event stream first record");
    } finally {
      try {
        await client.close();
      } finally {
        try {
          await daemon.close();
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }
    }
  }, 120_000);
});
