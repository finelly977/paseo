import { describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { AgentManager } from "../agent-manager.js";
import { FileAgentTimelineStore } from "../file-agent-timeline-store.js";
import type { AgentClient, AgentSession, AgentSessionConfig } from "../agent-sdk-types.js";
import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
import type { RewindMode } from "./rewind.js";
import { FakeRewindSession, REWIND_TEST_CAPABILITIES } from "./test-rewind-session.js";

class FakeRewindClient implements AgentClient {
  readonly provider = "claude";
  readonly capabilities = REWIND_TEST_CAPABILITIES;

  constructor(readonly session: FakeRewindSession) {}

  async createSession(_config: AgentSessionConfig): Promise<AgentSession> {
    return this.session;
  }

  async resumeSession(): Promise<AgentSession> {
    return this.session;
  }

  async fetchCatalog() {
    return { models: [], modes: [] };
  }

  async isAvailable() {
    return true;
  }
}

class RewindHistoryGate {
  private gate: Promise<void> | null = null;
  private releaseGate: (() => void) | null = null;

  hold(): void {
    this.gate = new Promise<void>((resolve) => {
      this.releaseGate = resolve;
    });
  }

  release(): void {
    this.releaseGate?.();
    this.releaseGate = null;
    this.gate = null;
  }

  async wait(): Promise<void> {
    await this.gate;
  }
}

async function createRewindHarness(options: { historyGate?: RewindHistoryGate } = {}) {
  const session = new FakeRewindSession(options.historyGate?.wait.bind(options.historyGate));
  const manager = new AgentManager({
    clients: { claude: new FakeRewindClient(session) },
    logger: createTestLogger(),
    idFactory: () => "00000000-0000-4000-8000-000000000901",
  });
  const agent = await manager.createAgent(
    {
      provider: "claude",
      cwd: process.cwd(),
    },
    undefined,
    { workspaceId: undefined },
  );
  return { manager, session, agentId: agent.id };
}

describe("AgentManager rewind", () => {
  test.each<RewindMode>(["conversation", "files", "both"])(
    "Claude %s 回退把界面消息标识转换为已记录的原生标识",
    async (mode) => {
      const { manager, session, agentId } = await createRewindHarness();
      const clientMessageId = "msg_1788661750255_9ol1iqhk8";
      const providerMessageId = "bb9c74a3-2db4-4137-aa2f-848f7b49e9b7";
      try {
        session.emit({
          type: "timeline",
          provider: "claude",
          turnId: "foreground-turn-1",
          item: {
            type: "user_message",
            text: "检查项目",
            clientMessageId,
            messageId: providerMessageId,
          },
        });
        await manager.flush();
        expect(manager.fetchTimeline(agentId, { limit: 0 }).rows).toEqual([
          expect.objectContaining({
            item: expect.objectContaining({ messageId: clientMessageId, clientMessageId }),
            providerMessageId,
          }),
        ]);

        await manager.rewind(agentId, clientMessageId, mode);

        expect(session.recordedRewinds).toEqual([{ mode, messageId: providerMessageId }]);
      } finally {
        await manager.closeAgent(agentId);
      }
    },
  );

  test("从磁盘恢复的旧会话保留回退映射，文件回退不改写界面消息标识", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paseo-claude-rewind-"));
    const agentId = "00000000-0000-4000-8000-000000000903";
    const clientMessageId = "msg-reopened";
    const providerMessageId = "claude-native-message";
    const row: AgentTimelineRow = {
      seq: 1,
      timestamp: "2026-09-06T02:29:11.203Z",
      item: {
        type: "user_message",
        text: "检查项目",
        messageId: clientMessageId,
        clientMessageId,
        turnRole: "start",
      },
      turnId: "foreground-turn-1",
      providerMessageId,
    };
    const session = new FakeRewindSession();
    session.history = [{ type: "user_message", text: "检查项目", messageId: providerMessageId }];
    const manager = new AgentManager({
      clients: { claude: new FakeRewindClient(session) },
      logger: createTestLogger(),
      durableTimelineStore: new FileAgentTimelineStore(directory),
    });
    try {
      await new FileAgentTimelineStore(directory).replaceCommittedSnapshot(agentId, {
        rows: [row],
        historyComplete: true,
      });
      await manager.resumeAgentFromPersistence(
        { provider: "claude", sessionId: session.id },
        { cwd: directory },
        agentId,
      );
      await manager.hydrateTimelineFromProvider(agentId);

      await manager.rewind(agentId, clientMessageId, "files");

      expect(session.recordedRewinds).toEqual([{ mode: "files", messageId: providerMessageId }]);
      expect(manager.fetchTimeline(agentId, { limit: 0 }).rows).toEqual([row]);
    } finally {
      try {
        if (manager.getAgent(agentId)) await manager.closeAgent(agentId);
        await manager.flush();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  test("rewinds the conversation and rehydrates the timeline", async () => {
    const { manager, session, agentId } = await createRewindHarness();

    await manager.rewind(agentId, "message-1", "conversation");

    expect(session.recordedRewinds).toEqual([{ mode: "conversation", messageId: "message-1" }]);
    expect(session.historyReadCount).toBe(1);
    expect(manager.fetchTimeline(agentId, { limit: 0 }).rows.map((row) => row.item)).toEqual([
      { type: "user_message", text: "before", messageId: "message-1" },
    ]);
  });

  test("替换权威时间线版本而不重放重建行", async () => {
    const { manager, session, agentId } = await createRewindHarness();
    session.history = Array.from({ length: 250 }, (_, index) => ({
      type: "assistant_message" as const,
      text: `rewound ${index}`,
    }));
    const epochBefore = manager.fetchTimeline(agentId, { limit: 0 }).epoch;
    const events: string[] = [];
    const unsubscribe = manager.subscribe((event) => events.push(event.type), {
      replayState: false,
    });

    await manager.rewind(agentId, "message-1", "conversation");
    unsubscribe();

    const replacement = manager.fetchTimeline(agentId, { limit: 0 });
    expect(replacement.epoch).not.toBe(epochBefore);
    expect(replacement.rows).toHaveLength(250);
    expect(events.filter((type) => type === "agent_stream")).toEqual([]);
    expect(events.filter((type) => type === "timeline_replacement")).toEqual([
      "timeline_replacement",
    ]);
  });

  test("rewinds files without rehydrating the conversation timeline", async () => {
    const { manager, session, agentId } = await createRewindHarness();

    await manager.rewind(agentId, "message-1", "files");

    expect(session.recordedRewinds).toEqual([{ mode: "files", messageId: "message-1" }]);
    expect(session.historyReadCount).toBe(0);
  });

  test("aborts an in-flight turn before rewinding", async () => {
    const { manager, session, agentId } = await createRewindHarness();
    const run = manager.streamAgent(agentId, "keep working");
    await run.next();

    await manager.rewind(agentId, "message-1", "files");

    expect(session.aborted).toBe(true);
    expect(session.recordedRewinds).toEqual([{ mode: "files", messageId: "message-1" }]);
  });

  test("does not rewind when the in-flight turn rejects cancellation", async () => {
    class RejectingInterruptSession extends FakeRewindSession {
      override async interrupt(): Promise<void> {
        throw new Error("provider still owns the active turn");
      }
    }

    const session = new RejectingInterruptSession();
    const manager = new AgentManager({
      clients: { claude: new FakeRewindClient(session) },
      logger: createTestLogger(),
      idFactory: () => "00000000-0000-4000-8000-000000000902",
    });
    const agent = await manager.createAgent({ provider: "claude", cwd: process.cwd() }, undefined, {
      workspaceId: undefined,
    });
    const run = manager.streamAgent(agent.id, "keep working");
    await run.next();

    await expect(manager.rewind(agent.id, "message-1", "files")).rejects.toThrow(
      `Cannot rewind agent ${agent.id} because its active run cancellation was not acknowledged`,
    );
    expect(session.recordedRewinds).toEqual([]);
    expect(manager.getAgent(agent.id)).toMatchObject({
      lifecycle: "running",
      activeForegroundTurnId: "turn-1",
    });
  });

  test("blocks new prompts until the rehydrate epoch broadcasts", async () => {
    const historyGate = new RewindHistoryGate();
    historyGate.hold();
    const { manager, agentId } = await createRewindHarness({ historyGate });

    const rewind = manager.rewind(agentId, "message-1", "both");

    expect(() => manager.streamAgent(agentId, "too early")).toThrow(
      "Agent 00000000-0000-4000-8000-000000000901 already has an active run",
    );

    historyGate.release();
    await rewind;
  });
});
