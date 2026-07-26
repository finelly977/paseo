import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { ClaudeAgentClient } from "./agent.js";
import { streamSession } from "../test-utils/session-stream-adapter.js";
import type { AgentStreamEvent } from "../../agent-sdk-types.js";

const sdkQueryFactory = vi.fn();

interface ScriptedMessageChannel {
  push(message: Record<string, unknown>): void;
  end(): void;
  next(): Promise<{ done: boolean; value?: Record<string, unknown> }>;
}

function createScriptedMessageChannel(): ScriptedMessageChannel {
  const pending: Record<string, unknown>[] = [];
  let wake: (() => void) | null = null;
  let ended = false;

  function release(): void {
    const waiter = wake;
    wake = null;
    waiter?.();
  }

  return {
    push(message) {
      pending.push(message);
      release();
    },
    end() {
      ended = true;
      release();
    },
    async next() {
      for (;;) {
        const value = pending.shift();
        if (value) {
          return { done: false, value };
        }
        if (ended) {
          return { done: true };
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}

function createQueryMock(channel: ScriptedMessageChannel) {
  return {
    next: () => channel.next(),
    interrupt: vi.fn(async () => undefined),
    return: vi.fn(async () => undefined),
    close: vi.fn(() => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    getContextUsage: vi.fn(async () => undefined),
    supportedModels: vi.fn(async () => [{ value: "opus", displayName: "Opus" }]),
    supportedCommands: vi.fn(async () => []),
    rewindFiles: vi.fn(async () => ({ canRewind: true })),
    applyFlagSettings: vi.fn(async () => undefined),
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

async function createSession() {
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    queryFactory: sdkQueryFactory,
    resolveBinary: async () => "/test/claude/bin",
  });
  return client.createSession({ provider: "claude", cwd: process.cwd() });
}

function backgroundTasksChanged(taskIds: string[]): Record<string, unknown> {
  return {
    type: "system",
    subtype: "background_tasks_changed",
    session_id: "background-task-session",
    uuid: `background-tasks-${taskIds.join("-") || "empty"}`,
    tasks: taskIds.map((taskId) => ({
      task_id: taskId,
      task_type: "subagent",
      description: "Explore server daemon internals",
    })),
  };
}

function successResult(): Record<string, unknown> {
  return {
    type: "result",
    subtype: "success",
    session_id: "background-task-session",
    uuid: "background-task-result",
    is_error: false,
    duration_ms: 1,
    duration_api_ms: 1,
    num_turns: 1,
    result: "done",
    stop_reason: null,
    total_cost_usd: 0,
    usage: { input_tokens: 1, output_tokens: 1 },
    modelUsage: {},
    permission_denials: [],
  };
}

async function collectUntilTerminal(
  stream: AsyncGenerator<AgentStreamEvent>,
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
    if (
      event.type === "turn_completed" ||
      event.type === "turn_failed" ||
      event.type === "turn_canceled"
    ) {
      break;
    }
  }
  return events;
}

beforeEach(() => {
  sdkQueryFactory.mockReset();
});

afterEach(() => {
  sdkQueryFactory.mockReset();
});

// 后台子代理会在前台回合返回后继续通过同一 Claude Code 进程运行。
// 如果只检查前台回合状态，空闲回收会误杀仍在运行的子代理。
test("reports live background work after the foreground turn returns", async () => {
  const channel = createScriptedMessageChannel();
  sdkQueryFactory.mockImplementation(() => createQueryMock(channel));

  const session = await createSession();

  try {
    expect(session.hasLiveBackgroundWork?.()).toBe(false);

    const stream = streamSession(session, "explore the daemon");
    channel.push(backgroundTasksChanged(["a4cf20fa42e284f7c"]));
    channel.push(successResult());
    await collectUntilTerminal(stream);

    expect(session.hasLiveBackgroundWork?.()).toBe(true);
  } finally {
    channel.end();
    await session.close();
  }
});

// background_tasks_changed 携带完整存活集合，空集合明确表示已经没有后台任务。
test("clears live background work when the task set empties", async () => {
  const channel = createScriptedMessageChannel();
  sdkQueryFactory.mockImplementation(() => createQueryMock(channel));

  const session = await createSession();

  try {
    const stream = streamSession(session, "explore the daemon");
    channel.push(backgroundTasksChanged(["a4cf20fa42e284f7c", "b1200f9ce1174aa2"]));
    channel.push(backgroundTasksChanged(["b1200f9ce1174aa2"]));
    channel.push(backgroundTasksChanged([]));
    channel.push(successResult());
    await collectUntilTerminal(stream);

    expect(session.hasLiveBackgroundWork?.()).toBe(false);
  } finally {
    channel.end();
    await session.close();
  }
});

// task_notification 表示单个后台任务结束，不代表提供方开始新的工作。
// 如果 Claude 没有继续作答，为该通知开启回合会让智能体永久停留在运行状态。
test("does not open an unterminated turn when a background task settles", async () => {
  const channel = createScriptedMessageChannel();
  sdkQueryFactory.mockImplementation(() => createQueryMock(channel));

  const session = await createSession();
  const observed: AgentStreamEvent[] = [];
  const unsubscribe = session.subscribe((event) => observed.push(event));

  try {
    const stream = streamSession(session, "explore the daemon");
    channel.push(backgroundTasksChanged(["a4cf20fa42e284f7c"]));
    channel.push(successResult());
    await collectUntilTerminal(stream);

    observed.length = 0;
    channel.push({
      type: "system",
      subtype: "task_notification",
      session_id: "background-task-session",
      uuid: "task-note-settled",
      task_id: "a4cf20fa42e284f7c",
      status: "failed",
      output_file: "/tmp/a4cf20fa42e284f7c.output",
      summary: 'Background agent "Explore server daemon internals" did not complete',
    });
    channel.push(backgroundTasksChanged([]));
    await vi.waitFor(() =>
      expect(
        observed.some((event) => event.type === "timeline" && event.item.type === "tool_call"),
      ).toBe(true),
    );

    const started = observed.filter((event) => event.type === "turn_started").length;
    const terminated = observed.filter(
      (event) =>
        event.type === "turn_completed" ||
        event.type === "turn_failed" ||
        event.type === "turn_canceled",
    ).length;

    expect(started).toBe(terminated);
  } finally {
    unsubscribe();
    channel.end();
    await session.close();
  }
});

// 后台任务集合属于当前进程，关闭会话后不能继续声称已退出的进程仍持有任务。
test("drops live background work when the session closes", async () => {
  const channel = createScriptedMessageChannel();
  sdkQueryFactory.mockImplementation(() => createQueryMock(channel));

  const session = await createSession();
  const stream = streamSession(session, "explore the daemon");
  channel.push(backgroundTasksChanged(["a4cf20fa42e284f7c"]));
  channel.push(successResult());
  await collectUntilTerminal(stream);
  expect(session.hasLiveBackgroundWork?.()).toBe(true);

  channel.end();
  await session.close();

  expect(session.hasLiveBackgroundWork?.()).toBe(false);
});
