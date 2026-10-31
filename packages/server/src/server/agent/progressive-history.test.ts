import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { AgentManager, type AgentManagerEvent } from "./agent-manager.js";
import { AgentStorage } from "./agent-storage.js";
import { FileAgentTimelineStore } from "./file-agent-timeline-store.js";
import { ensureAgentLoaded } from "./agent-loading.js";
import { wrapSessionProvider } from "./provider-registry.js";
import { createTestAgentClient } from "../test-utils/fake-agent-client.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentClient, AgentTimelineItem } from "./agent-sdk-types.js";

const timestamp = "2026-10-31T00:00:00.000Z";
const latest: AgentTimelineItem[] = [
  { type: "user_message", messageId: "new-q", text: "原生最新问题" },
  { type: "assistant_message", messageId: "new-a", text: "其他客户端新增的回复" },
];
const full: AgentTimelineItem[] = [
  { type: "user_message", messageId: "old-q", text: "原生早期问题" },
  { type: "assistant_message", messageId: "old-a", text: "原生早期回复" },
  ...latest,
];

async function world() {
  const root = await mkdtemp(path.join(tmpdir(), "progressive-history-"));
  const logger = createTestLogger();
  const storage = new AgentStorage(path.join(root, "agents"), logger);
  const durable = new FileAgentTimelineStore(path.join(root, "timelines"));
  const gate = Promise.withResolvers<void>();
  let continuationCalls = 0;
  const base = createTestAgentClient("codex");
  const client: AgentClient = {
    provider: base.provider,
    capabilities: base.capabilities,
    createSession: (config, context, options) => base.createSession(config, context, options),
    fetchCatalog: (options) => base.fetchCatalog(options),
    isAvailable: () => base.isAvailable(),
    resumeSession: async (handle, config, context, options) => {
      expect(options).toMatchObject({ progressiveHistory: true });
      const inner = await base.resumeSession(handle, config, context, options);
      const session = wrapSessionProvider("codex", inner);
      let items = latest;
      session.historyContinuation = async () => {
        continuationCalls++;
        if (continuationCalls === 1) await gate.promise;
        items = full;
      };
      session.streamHistory = async function* () {
        for (const item of items) yield { type: "timeline", provider: "codex", item, timestamp };
      };
      session.close = async () => {
        gate.resolve();
        await inner.close();
      };
      return session;
    },
  };
  const manager = new AgentManager({
    clients: { codex: client },
    registry: storage,
    durableTimelineStore: durable,
    logger,
  });
  const agent = await manager.createAgent(
    { provider: "codex", cwd: root },
    "00000000-0000-4000-8000-000000000051",
    {},
  );
  await manager.releaseAgentRuntime(agent.id);
  await durable.replaceCommittedSnapshot(agent.id, {
    historyComplete: true,
    rows: [
      {
        seq: 1,
        timestamp,
        item: { type: "assistant_message", messageId: "stale", text: "过期的 Paseo 副本" },
      },
    ],
  });
  const events: AgentManagerEvent[] = [];
  manager.subscribe((event) => events.push(event));
  const load = (progressiveHistory = true) =>
    ensureAgentLoaded(agent.id, {
      agentManager: manager,
      agentStorage: storage,
      logger,
      progressiveHistory,
    });
  return {
    manager,
    durable,
    gate,
    agent,
    events,
    load,
    cleanup: async () => {
      gate.resolve();
      if (manager.getAgent(agent.id)) await manager.closeAgent(agent.id);
      await manager.flush();
      await storage.flush();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("原生最新页先就绪，后台全部成功后才提交完整快照并校准位置", async () => {
  const w = await world();
  try {
    await w.load();
    const preview = w.manager.fetchTimeline(w.agent.id, { limit: 0 });
    expect(preview.rows.map((row) => row.item)).toEqual(latest);
    expect(preview.hasOlder).toBe(true);
    expect(w.manager.hasPendingHistory(w.agent.id)).toBe(true);
    expect((await w.durable.getCommittedSnapshot(w.agent.id)).rows.map((row) => row.item)).toEqual([
      { type: "assistant_message", messageId: "stale", text: "过期的 Paseo 副本" },
    ]);
    w.gate.resolve();
    await w.manager.waitForBackgroundHistory(w.agent.id);
    const done = w.manager.fetchTimeline(w.agent.id, { limit: 0 });
    expect(done.rows.map((row) => row.item)).toEqual(full);
    expect(w.manager.hasPendingHistory(w.agent.id)).toBe(false);
    expect((await w.durable.getCommittedSnapshot(w.agent.id)).rows.map((row) => row.item)).toEqual(
      full,
    );
    expect(w.events.filter((event) => event.type === "timeline_replacement")).toEqual([
      {
        type: "timeline_replacement",
        agentId: w.agent.id,
        epoch: done.epoch,
        rebase: {
          previousEpoch: preview.epoch,
          minSeq: 1,
          positions: [
            { previousSeq: 1, seq: 3 },
            { previousSeq: 2, seq: 4 },
          ],
        },
      },
    ]);
    expect(
      w.manager
        .fetchTimeline(w.agent.id, {
          direction: "before",
          cursor: { epoch: preview.epoch, seq: 1 },
          limit: 40,
        })
        .rows.map((row) => row.item),
    ).toEqual(full.slice(0, 2));
  } finally {
    await w.cleanup();
  }
});

test("后台读取失败保留首屏与已提交历史，下一次操作可重试", async () => {
  const w = await world();
  try {
    await w.load();
    const failing = expect(w.manager.waitForBackgroundHistory(w.agent.id)).rejects.toThrow(
      "原生读取失败",
    );
    w.gate.reject(new Error("原生读取失败"));
    await failing;
    expect(w.manager.fetchTimeline(w.agent.id, { limit: 0 }).rows.map((row) => row.item)).toEqual(
      latest,
    );
    expect(w.events.filter((event) => event.type === "timeline_replacement")).toEqual([]);
    await w.manager.waitForBackgroundHistory(w.agent.id);
    expect(w.manager.fetchTimeline(w.agent.id, { limit: 0 }).rows.map((row) => row.item)).toEqual(
      full,
    );
  } finally {
    await w.cleanup();
  }
});

test("依赖完整历史的后续操作等待同一次后台读取，不重开提供方会话", async () => {
  const w = await world();
  try {
    await w.load();
    let ready = false;
    const operation = w.load(false).then(() => {
      ready = true;
      return ready;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(ready).toBe(false);
    expect(w.manager.fetchTimeline(w.agent.id, { limit: 0 }).rows.map((row) => row.item)).toEqual(
      latest,
    );
    w.gate.resolve();
    await operation;
    expect(ready).toBe(true);
    expect(w.manager.hasPendingHistory(w.agent.id)).toBe(false);
  } finally {
    await w.cleanup();
  }
});

test("释放会取消后台历史，不在关闭后发布或写入完整历史", async () => {
  const w = await world();
  try {
    await w.load();
    await w.manager.releaseAgentRuntime(w.agent.id);
    await w.manager.flush();
    expect(w.manager.getAgent(w.agent.id)).toBeNull();
    expect(w.manager.hasPendingHistory(w.agent.id)).toBe(false);
    expect(w.events.filter((event) => event.type === "timeline_replacement")).toEqual([]);
    expect((await w.durable.getCommittedSnapshot(w.agent.id)).rows.map((row) => row.item)).toEqual([
      { type: "assistant_message", messageId: "stale", text: "过期的 Paseo 副本" },
    ]);
  } finally {
    await w.cleanup();
  }
});
