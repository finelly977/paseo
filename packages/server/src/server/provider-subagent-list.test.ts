import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { expect, test } from "vitest";
import { AGENT_PROVIDER_DEFINITIONS } from "@getpaseo/protocol/provider-manifest";
import { createTestPaseoDaemon } from "./test-utils/paseo-daemon.js";
import { createTestAgentClients } from "./test-utils/fake-agent-client.js";
import { DaemonClient } from "./test-utils/daemon-client.js";
import { CodexAppServerAgentClient } from "./agent/providers/codex-app-server-agent.js";
import { createFakeCodexAppServer } from "./agent/providers/codex/test-utils/fake-app-server.js";

test("真实列表 RPC 独立核对子任务终态，失败保留缓存且重试可发现新一轮，不调用正文接口", async () => {
  let status = "inProgress";
  let runId = "child-turn";
  let failed = false;
  let bodyReads = 0;
  const statusRequests: unknown[] = [];
  const appServer = createFakeCodexAppServer({
    "thread/read": (params) => {
      const threadId = (params as { threadId: string }).threadId;
      if (threadId === "child") {
        if (failed)
          return { __jsonRpcError: { code: -32000, message: "测试：子任务原生状态读取失败" } };
        return { thread: { id: threadId, historyMode: "paginated" } };
      }
      return {
        thread: {
          id: threadId,
          historyMode: "legacy",
          turns: [
            {
              id: "parent-turn",
              status: "completed",
              items: [
                {
                  type: "subAgentActivity",
                  id: "spawn",
                  kind: "started",
                  agentThreadId: "child",
                  agentPath: "/root/review",
                },
              ],
            },
          ],
        },
      };
    },
    "thread/turns/list": (params) => {
      statusRequests.push(params);
      return { data: [{ id: runId, status, items: [] }], nextCursor: null };
    },
    "thread/items/list": () => {
      bodyReads += 1;
      return {
        data: [
          {
            turnId: "child-turn",
            item: {
              type: "agentMessage",
              id: "child-answer",
              text: "保留的子任务正文",
              phase: "final_answer",
            },
          },
        ],
        nextCursor: null,
      };
    },
  });
  class ReplayClient extends CodexAppServerAgentClient {
    override async isAvailable() {
      return true;
    }
    override async fetchCatalog() {
      return { models: [], modes: [] };
    }
  }
  const logger = pino({ level: "silent" });
  const provider = new ReplayClient(logger, undefined, {
    spawnAppServer: () => appServer.spawnChild(),
    resolveCodexVersion: async () => "0.0.0",
    resolveCodexLaunchCommand: async () => process.execPath,
  });
  const daemon = await createTestPaseoDaemon({
    agentClients: { ...createTestAgentClients(), codex: provider },
    providerOverrides: Object.fromEntries(
      AGENT_PROVIDER_DEFINITIONS.filter((item) => item.id !== "codex").map((item) => [
        item.id,
        { enabled: false },
      ]),
    ),
    mcpEnabled: false,
    relayEnabled: false,
    logger,
  });
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.2.5",
    clientId: `clid_status_${randomUUID()}`,
  });
  try {
    const cwd = path.join(daemon.paseoHome, "project");
    await mkdir(cwd);
    await client.connect();
    await client.fetchAgents();
    const parent = await client.importAgent({ provider: "codex", sessionId: "parent", cwd });
    await daemon.daemon.agentManager.hydrateTimelineFromProvider(parent.id);
    const baselineBodyReads = bodyReads;
    statusRequests.length = 0;
    status = "completed";
    const completed = await client.listProviderSubagents(parent.id);
    expect(completed.subagents).toEqual([
      expect.objectContaining({ id: "child", status: "completed", runId: "child-turn" }),
    ]);
    expect(statusRequests).toEqual([
      {
        threadId: "child",
        cursor: null,
        limit: 1,
        sortDirection: "desc",
        itemsView: "notLoaded",
      },
    ]);
    expect(bodyReads).toBe(baselineBodyReads);
    failed = true;
    await expect(client.listProviderSubagents(parent.id)).rejects.toThrow("子任务原生状态读取失败");
    expect(daemon.daemon.agentManager.listProviderSubagents(parent.id)).toEqual([
      expect.objectContaining({ id: "child", status: "completed" }),
    ]);
    failed = false;
    status = "inProgress";
    runId = "child-turn-next";
    const restarted = await client.listProviderSubagents(parent.id);
    expect(restarted.subagents).toEqual([
      expect.objectContaining({ id: "child", status: "running", runId: "child-turn-next" }),
    ]);
    expect(bodyReads).toBe(baselineBodyReads);
    appServer.assertNoErrors();
  } finally {
    await client.close();
    await daemon.close();
  }
});
