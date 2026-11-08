import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { AgentManager } from "./agent-manager.js";
import { AgentStorage } from "./agent-storage.js";
import { FileAgentTimelineStore } from "./file-agent-timeline-store.js";
import { ensureAgentLoaded } from "./agent-loading.js";
import { createTestAgentClient } from "../test-utils/fake-agent-client.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentClient, AgentTimelineItem } from "./agent-sdk-types.js";

async function world() {
  const root = await mkdtemp(path.join(tmpdir(), "native-history-loading-"));
  const logger = createTestLogger();
  const storage = new AgentStorage(path.join(root, "agents"), logger);
  const durable = new FileAgentTimelineStore(path.join(root, "timelines"));
  const base = createTestAgentClient("codex");
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  let completeCalls = 0;
  const full: AgentTimelineItem[] = [
    { type: "user_message", messageId: "q", text: "原生问题" },
    { type: "assistant_message", messageId: "a", text: "原生最终回复" },
  ];
  const client: AgentClient = {
    provider: base.provider,
    capabilities: base.capabilities,
    createSession: (...args) => base.createSession(...args),
    fetchCatalog: (options) => base.fetchCatalog(options),
    isAvailable: () => base.isAvailable(),
    resumeSession: async (handle, config, context, options) => {
      expect(options).toMatchObject({ nativeHistory: true });
      const session = await base.resumeSession(handle, config, context, options);
      let items: AgentTimelineItem[] = [];
      session.nativeHistory = {
        readId: handle.sessionId,
        readPage: async (cursor) => ({
          readId: handle.sessionId,
          cursor,
          nextCursor: "older",
          turns: [
            {
              id: "turn",
              status: "completed",
              startedAt: 1,
              durationMs: 4000,
              error: null,
              items: full,
            },
          ],
        }),
        readTurn: async () => ({ items: full, nextCursor: null }),
        complete: async () => {
          completeCalls++;
          started.resolve();
          await gate.promise;
          items = full;
        },
      };
      session.streamHistory = async function* () {
        for (const item of items)
          yield {
            type: "timeline",
            provider: "codex",
            turnId: "turn",
            item,
            timestamp: "2026-11-01T00:00:00.000Z",
          };
      };
      const close = session.close.bind(session);
      session.close = async () => {
        gate.resolve();
        await close();
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
    "00000000-0000-4000-8000-000000000067",
    {},
  );
  await manager.releaseAgentRuntime(agent.id);
  const stale = [
    {
      seq: 1,
      timestamp: "2026-10-01T00:00:00.000Z",
      item: { type: "assistant_message" as const, messageId: "stale", text: "过期副本" },
    },
  ];
  await durable.replaceCommittedSnapshot(agent.id, { historyComplete: true, rows: stale });
  return {
    agent,
    manager,
    durable,
    full,
    stale,
    gate,
    started,
    calls: () => completeCalls,
    load: () =>
      ensureAgentLoaded(agent.id, {
        agentManager: manager,
        agentStorage: storage,
        logger,
        nativeHistory: true,
      }),
    cleanup: async () => {
      gate.resolve();
      if (manager.getAgent(agent.id)) await manager.closeAgent(agent.id);
      await manager.flush();
      await storage.flush();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("浏览不读旧副本到规范内存，不提交摘要；完整上下文读取按需合并为一次", async () => {
  const w = await world();
  try {
    await w.load();
    expect(w.manager.fetchTimeline(w.agent.id, { limit: 0 }).rows).toEqual([]);
    expect(w.calls()).toBe(0);
    const history = w.manager.getNativeHistory(w.agent.id);
    if (!history) throw new Error("缺少原生摘要读取器");
    expect((await history.readPage(null, 5)).turns[0].items).toEqual(w.full);
    expect((await w.durable.getCommittedSnapshot(w.agent.id)).rows).toEqual(w.stale);
    const first = w.manager.getTimelineRows(w.agent.id);
    const second = w.manager.getTimelineRows(w.agent.id);
    await w.started.promise;
    expect(w.calls()).toBe(1);
    w.gate.resolve();
    expect((await first).map((row) => row.item)).toEqual(w.full);
    expect((await first).map((row) => row.turnId)).toEqual(["turn", "turn"]);
    expect((await second).map((row) => row.item)).toEqual(w.full);
    expect((await w.durable.getCommittedSnapshot(w.agent.id)).rows.map((row) => row.item)).toEqual(
      w.full,
    );
  } finally {
    await w.cleanup();
  }
});

test("释放取消按需完整读取，不覆盖旧磁盘快照或重新恢复运行时", async () => {
  const w = await world();
  try {
    await w.load();
    const reading = expect(w.manager.getTimelineRows(w.agent.id)).rejects.toThrow("会话已释放");
    await w.started.promise;
    await w.manager.releaseAgentRuntime(w.agent.id);
    await reading;
    expect(w.manager.getAgent(w.agent.id)).toBeNull();
    expect((await w.durable.getCommittedSnapshot(w.agent.id)).rows).toEqual(w.stale);
  } finally {
    await w.cleanup();
  }
});

test("首次真实写入接续原磁盘序号，不完整读取原生历史，也不覆盖旧正文", async () => {
  const w = await world();
  try {
    await w.load();
    const item: AgentTimelineItem = {
      type: "user_message",
      messageId: "new-q",
      text: "本次运行的新问题",
    };
    await w.manager.appendTimelineItem(w.agent.id, item);
    await w.manager.flush();
    expect(w.calls()).toBe(0);
    expect(w.manager.fetchTimeline(w.agent.id, { limit: 0 }).rows).toMatchObject([
      { seq: 2, item },
    ]);
    expect((await w.durable.getCommittedRows(w.agent.id)).map((row) => row.item)).toEqual([
      w.stale[0].item,
      item,
    ]);
  } finally {
    await w.cleanup();
  }
});

test("浏览后直接发送可完整结束回合，磁盘保留旧记录且不触发全量扫描", async () => {
  const w = await world();
  try {
    await w.load();
    const result = await w.manager.runAgent(w.agent.id, "新的用户问题", {
      clientMessageId: "submitted-after-browse",
    });
    await w.manager.flush();
    expect(result.finalText.length).toBeGreaterThan(0);
    expect(w.calls()).toBe(0);
    const rows = await w.durable.getCommittedRows(w.agent.id);
    expect(rows[0]).toEqual(w.stale[0]);
    expect(rows.slice(1).some((row) => row.item.type === "user_message")).toBe(true);
    expect(rows.slice(1).some((row) => row.item.type === "assistant_message")).toBe(true);
    expect(rows.slice(1).every((row) => row.seq > 1)).toBe(true);
  } finally {
    await w.cleanup();
  }
});
