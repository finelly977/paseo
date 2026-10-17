import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createTestLogger } from "../test-utils/test-logger.js";
import { AgentStorage } from "./agent/agent-storage.js";
import { FileAgentTimelineStore } from "./agent/file-agent-timeline-store.js";
import { DaemonClient } from "./test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "./test-utils/paseo-daemon.js";

it("通过真实 RPC 搜索尚未初始化的磁盘会话，不创建或启动智能体", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-search-rpc-"));
  let daemon: TestPaseoDaemon | null = null;
  let client: DaemonClient | null = null;
  try {
    const home = path.join(root, ".paseo");
    const storage = new AgentStorage(path.join(home, "agents"), createTestLogger());
    await storage.upsert({
      id: "cold-history",
      provider: "codex",
      cwd: root,
      title: "项目讨论",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      labels: {},
      lastStatus: "closed",
    });
    const timeline = new FileAgentTimelineStore(path.join(home, "agent-timelines"));
    await timeline.bulkInsert("cold-history", [
      {
        seq: 1,
        timestamp: "2026-01-01T00:00:00Z",
        item: { type: "assistant_message", text: "历史上的部署端口 7511" },
      },
    ]);
    daemon = await createTestPaseoDaemon({
      paseoHomeRoot: root,
      agentClients: {},
      mcpEnabled: false,
      pluginsEnabled: false,
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.2.3" });
    await client.connect();
    expect(daemon.daemon.agentManager.listAgents()).toHaveLength(0);
    expect(await client.searchConversations("部署 7511", ["cold-history"])).toEqual([
      { agentId: "cold-history", snippet: "历史上的部署端口 7511" },
    ]);
    expect(daemon.daemon.agentManager.listAgents()).toHaveLength(0);
  } finally {
    if (client) await client.close();
    if (daemon) await daemon.close();
    else await rm(root, { recursive: true, force: true });
  }
}, 30_000);
