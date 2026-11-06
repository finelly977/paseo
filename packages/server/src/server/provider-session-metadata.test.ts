import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { AGENT_PROVIDER_DEFINITIONS } from "@getpaseo/protocol/provider-manifest";
import { CLIENT_CAPS } from "@getpaseo/protocol/client-capabilities";
import { expect, test, vi } from "vitest";
import type { AgentFeature } from "./agent/agent-sdk-types.js";
import { createTestPaseoDaemon } from "./test-utils/paseo-daemon.js";
import { createTestAgentClients } from "./test-utils/fake-agent-client.js";
import { DaemonClient } from "./test-utils/daemon-client.js";
import { CodexAppServerAgentClient } from "./agent/providers/codex-app-server-agent.js";
import { createFakeCodexAppServer } from "./agent/providers/codex/test-utils/fake-app-server.js";

test("真实 WebSocket 首屏先到，Fast 与计划菜单随后主动推送，不发送对话或恢复执行", async () => {
  const catalog = Promise.withResolvers<unknown>();
  const appServer = createFakeCodexAppServer({
    "thread/read": () => ({
      thread: { id: "existing-thread", historyMode: "paginated", model: "gpt-5.4" },
    }),
    "thread/turns/list": () => ({ data: [], nextCursor: null }),
    "model/list": () => catalog.promise,
    "collaborationMode/list": () => ({ data: [{ name: "Plan", mode: "plan" }] }),
  });
  class ReadOnlyProvider extends CodexAppServerAgentClient {
    override async isAvailable() {
      return true;
    }
    override async fetchCatalog() {
      return { models: [], modes: [] };
    }
  }
  const logger = pino({ level: "silent" });
  const provider = new ReadOnlyProvider(logger, undefined, {
    spawnAppServer: () => appServer.spawnChild(),
    resolveCodexVersion: async () => "0.0.0",
    resolveCodexLaunchCommand: async () => process.execPath,
  });
  const daemon = await createTestPaseoDaemon({
    agentClients: { ...createTestAgentClients(), codex: provider },
    providerOverrides: Object.fromEntries(
      AGENT_PROVIDER_DEFINITIONS.filter((entry) => entry.id !== "codex").map((entry) => [
        entry.id,
        { enabled: false },
      ]),
    ),
    mcpEnabled: false,
    relayEnabled: false,
    logger,
  });
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    capabilities: { [CLIENT_CAPS.nativeHistoryPages]: true },
  });
  const agentId = randomUUID();
  const featureUpdates: AgentFeature[][] = [];
  const unsubscribe = client.subscribe((event) => {
    if (
      event.type === "agent_update" &&
      event.agentId === agentId &&
      event.payload.kind === "upsert"
    )
      featureUpdates.push(event.payload.agent.features);
  });
  try {
    const cwd = path.join(daemon.paseoHome, "project");
    await mkdir(cwd);
    await client.connect();
    await client.fetchAgents({ subscribe: { subscriptionId: "metadata-regression" } });
    const { workspace } = await client.openProject(cwd);
    if (!workspace) throw new Error("测试工作区创建失败");
    await daemon.daemon.agentManager.resumeAgentFromPersistence(
      { provider: "codex", sessionId: "existing-thread" },
      { cwd, modeId: "auto", model: "gpt-5.4" },
      agentId,
      { workspaceId: workspace.id },
      { nativeHistory: true },
    );
    const firstPage = await client.fetchAgentTimeline(agentId, { projection: "projected" });
    expect(firstPage.nativeHistory?.turns).toEqual([]);
    expect(firstPage.agent.features).toEqual([]);
    catalog.resolve({
      data: [{ id: "gpt-5.4", isDefault: true, serviceTiers: [{ id: "priority", name: "Fast" }] }],
    });
    await vi.waitFor(() =>
      expect(featureUpdates.at(-1)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "fast_mode" }),
          expect.objectContaining({ id: "plan_mode" }),
        ]),
      ),
    );
    await daemon.daemon.agentManager.flush();
    const saved = await daemon.daemon.agentStorage.get(agentId);
    if (!saved) throw new Error("测试会话没有保存");
    expect(Date.parse(saved.updatedAt)).toBeGreaterThan(Date.parse(firstPage.agent.updatedAt));
    expect(saved.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "fast_mode" }),
        expect.objectContaining({ id: "plan_mode" }),
      ]),
    );
    expect(
      appServer
        .requests()
        .filter((request) =>
          ["thread/start", "thread/resume", "turn/start", "skills/list"].includes(request.method),
        ),
    ).toEqual([]);
    expect(daemon.daemon.agentManager.getAgent(agentId)?.lifecycle).toBe("idle");
    appServer.assertNoErrors();
  } finally {
    catalog.resolve({ data: [] });
    unsubscribe();
    await client.close();
    await daemon.close();
  }
});
