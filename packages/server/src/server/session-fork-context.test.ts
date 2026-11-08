import os from "node:os";
import { expect, test } from "vitest";
import { createTestPaseoDaemon } from "./test-utils/paseo-daemon.js";
import { createTestAgentClients } from "./test-utils/fake-agent-client.js";
import { DaemonClient } from "./test-utils/daemon-client.js";
import type { AgentTimelineItem } from "./agent/agent-sdk-types.js";

test("原生回合分叉经过真实 WebSocket 与完整历史水合，不包含下一回合", async () => {
  const entries: Array<{ turnId: string; item: AgentTimelineItem }> = [
    { turnId: "before", item: { type: "user_message", text: "之前的问题" } },
    { turnId: "before", item: { type: "assistant_message", text: "之前的回复" } },
    { turnId: "stopped", item: { type: "user_message", text: "中断前的问题" } },
    {
      turnId: "stopped",
      item: {
        type: "tool_call",
        name: "view_image",
        callId: "image",
        status: "completed",
        detail: { type: "plain_text", label: "已查看图像" },
        error: null,
      },
    },
    { turnId: "next", item: { type: "user_message", text: "不能混入的下一轮" } },
  ];
  const agents = createTestAgentClients();
  const create = agents.codex.createSession.bind(agents.codex);
  agents.codex.createSession = async (...args) => {
    const session = await create(...args);
    session.nativeHistory = {
      readId: "native-read",
      readPage: async (cursor) => ({ readId: "native-read", cursor, nextCursor: null, turns: [] }),
      readTurn: async () => ({ items: [], nextCursor: null }),
      complete: async () => undefined,
    };
    session.streamHistory = async function* () {
      for (const entry of entries)
        yield {
          type: "timeline",
          provider: "codex",
          turnId: entry.turnId,
          item: entry.item,
          timestamp: "2026-11-08T00:00:00.000Z",
        };
    };
    return session;
  };
  const daemon = await createTestPaseoDaemon({
    agentClients: agents,
    mcpEnabled: false,
    relayEnabled: false,
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  try {
    await client.connect();
    expect(client.getLastServerInfoMessage()?.features?.agentForkContextNativeTurn).toBe(true);
    const agent = await client.createAgent({ provider: "codex", cwd: os.tmpdir() });
    const result = await client.buildAgentForkContext(agent.id, { boundaryTurnId: "stopped" });
    expect(result.itemCount).toBe(4);
    expect(result.boundaryCursor?.seq).toBe(4);
    expect(result.attachment.text).toContain("中断前的问题");
    expect(result.attachment.text).not.toContain("不能混入的下一轮");
    await expect(
      client.buildAgentForkContext(agent.id, { boundaryTurnId: "missing" }),
    ).rejects.toThrow("Selected turn is no longer available.");
  } finally {
    await client.close();
    await daemon.close();
  }
}, 20000);
