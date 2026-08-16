import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type {
  Options,
  Query,
  SpawnOptions as ClaudeSpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import * as spawnUtils from "../../../../utils/spawn.js";
import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import { ClaudeAgentClient } from "./agent.js";
import type { ClaudeQueryInput } from "./query.js";

interface QueryMockOptions {
  // 会话回收查询时执行，用于模拟进程在回收握手期间退出。
  onReturn?: () => void;
  // 脚本事件耗尽后等待此 Promise，让查询像真实进程一样保持打开；传入值后再发送一个事件。
  tail?: Promise<unknown>;
}

function createQueryMock(events: unknown[], options: QueryMockOptions = {}): Query {
  let index = 0;
  return {
    next: vi.fn(async () => {
      if (index < events.length) {
        return { done: false, value: events[index++] };
      }
      const late = await options.tail;
      if (late !== undefined) {
        options.tail = undefined;
        return { done: false, value: late };
      }
      return { done: true, value: undefined };
    }),
    return: vi.fn(async () => {
      options.onReturn?.();
      return { done: true, value: undefined };
    }),
    interrupt: vi.fn(async () => undefined),
    close: vi.fn(() => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    supportedModels: vi.fn(async () => [{ value: "opus", displayName: "Opus" }]),
    supportedCommands: vi.fn(async () => []),
    rewindFiles: vi.fn(async () => ({ canRewind: true })),
    [Symbol.asyncIterator]() {
      return this;
    },
  } as Query;
}

function createChildProcessStub(): ChildProcess & { killSignals: (NodeJS.Signals | number)[] } {
  const child = new EventEmitter() as ChildProcess & {
    killSignals: (NodeJS.Signals | number)[];
  };
  child.stderr = new EventEmitter() as ChildProcess["stderr"];
  child.killSignals = [];
  // 真实子进程收到信号后会退出；测试桩也必须退出，避免每项测试等待完整的优雅与强制超时。
  child.kill = ((signal?: NodeJS.Signals | number) => {
    child.killSignals.push(signal ?? "SIGTERM");
    child.emit("exit", null, typeof signal === "string" ? signal : "SIGTERM");
    return true;
  }) as ChildProcess["kill"];
  return child;
}

const COMPLETED_TURN_EVENTS = [
  {
    type: "system",
    subtype: "init",
    session_id: "claude-runtime-exit-session",
    permissionMode: "default",
    model: "opus",
  },
  { type: "assistant", message: { content: "SPAWNED" } },
  {
    type: "result",
    subtype: "success",
    usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
    total_cost_usd: 0,
  },
];

const MISSING_RESUMED_CONVERSATION_RESULT = {
  type: "result",
  subtype: "error_during_execution",
  errors: ["No conversation found with session ID: claude-runtime-exit-session"],
};

const SPAWN_OPTIONS: ClaudeSpawnOptions = {
  command: "node",
  args: ["claude.js"],
  cwd: process.cwd(),
  env: {},
  signal: new AbortController().signal,
};

describe("Claude 运行时退出", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("会话空闲时进程退出会报告回合失败", async () => {
    let capturedOptions: Options | undefined;
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      return createQueryMock(COMPLETED_TURN_EVENTS);
    });
    const child = createChildProcessStub();
    vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    });
    const session = await client.createSession({ provider: "claude", cwd: process.cwd() });

    try {
      await session.run("start a background shell");
      capturedOptions?.spawnClaudeCodeProcess?.(SPAWN_OPTIONS);

      const events: AgentStreamEvent[] = [];
      session.subscribe((event) => events.push(event));

      child.emit("exit", 1, null);

      const failure = events.find((event) => event.type === "turn_failed");
      expect(failure).toBeDefined();
      expect(failure && "error" in failure ? failure.error : "").toContain("后台 Shell");
    } finally {
      await session.close();
    }
  });

  test("主动清理期间进程退出不会误报失败", async () => {
    let capturedOptions: Options | undefined;
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      return createQueryMock(COMPLETED_TURN_EVENTS);
    });
    const child = createChildProcessStub();
    vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    });
    const session = await client.createSession({ provider: "claude", cwd: process.cwd() });

    await session.run("start a background shell");
    capturedOptions?.spawnClaudeCodeProcess?.(SPAWN_OPTIONS);

    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    await session.close();
    child.emit("exit", 0, null);

    expect(events.some((event) => event.type === "turn_failed")).toBe(false);
  });

  test("查询重启回收进程时不会误报失败", async () => {
    let capturedOptions: Options | undefined;
    const child = createChildProcessStub();
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      // 真实查询会在回合之间保持打开，因此测试也保持打开；会话回收查询时进程随之退出。
      return createQueryMock(COMPLETED_TURN_EVENTS, {
        tail: new Promise<never>(() => undefined),
        onReturn: () => child.emit("exit", 0, null),
      });
    });
    vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    });
    const session = await client.createSession({ provider: "claude", cwd: process.cwd() });

    try {
      await session.run("first turn");
      capturedOptions?.spawnClaudeCodeProcess?.(SPAWN_OPTIONS);

      const events: AgentStreamEvent[] = [];
      session.subscribe((event) => events.push(event));

      // 下一次调用会在没有回合运行时重启查询并回收当前进程。
      await session.setThinkingOption(null);
      await session.listCommands();

      expect(events.some((event) => event.type === "turn_failed")).toBe(false);
    } finally {
      await session.close();
    }
  });

  test("恢复目标会话不存在时会终止已回收的进程树", async () => {
    let capturedOptions: Options | undefined;
    let deliverMissingConversation: ((event: unknown) => void) | undefined;
    // 全程只使用一个查询，确保只有缺失会话恢复路径能够终止子进程，而不是 ensureQuery() 重启路径。
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      return createQueryMock(COMPLETED_TURN_EVENTS, {
        tail: new Promise<unknown>((resolve) => {
          deliverMissingConversation = resolve;
        }),
      });
    });
    const child = createChildProcessStub();
    vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    });
    const session = await client.createSession({ provider: "claude", cwd: process.cwd() });

    try {
      // 先建立 Claude 会话标识，下一条结果将无法恢复该会话。
      await session.run("first turn");
      capturedOptions?.spawnClaudeCodeProcess?.(SPAWN_OPTIONS);

      deliverMissingConversation?.(MISSING_RESUMED_CONVERSATION_RESULT);

      // 必须终止整个进程树，否则 MCP 子进程会在 Claude 进程回收后继续残留。
      await vi.waitFor(() => expect(child.killSignals.length).toBeGreaterThan(0));
      expect(queryFactory).toHaveBeenCalledTimes(1);
    } finally {
      await session.close();
    }
  });

  test("回合中的进程崩溃交由查询泵报告", async () => {
    let rejectStream: ((error: Error) => void) | undefined;
    const tail = new Promise<never>((_resolve, reject) => {
      rejectStream = reject;
    });
    let capturedOptions: Options | undefined;
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      return createQueryMock(COMPLETED_TURN_EVENTS.slice(0, 2), { tail });
    });
    const child = createChildProcessStub();
    vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(child);
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    });
    const session = await client.createSession({ provider: "claude", cwd: process.cwd() });

    try {
      const events: AgentStreamEvent[] = [];
      session.subscribe((event) => events.push(event));
      const turn = session.run("start a background shell");
      await vi.waitFor(() => expect(capturedOptions?.spawnClaudeCodeProcess).toBeDefined());
      capturedOptions?.spawnClaudeCodeProcess?.(SPAWN_OPTIONS);

      child.emit("exit", 1, null);
      rejectStream?.(new Error("Claude Code process exited with code 1"));
      await expect(turn).rejects.toThrow("exited with code 1");

      const failures = events.filter((event) => event.type === "turn_failed");
      expect(failures).toHaveLength(1);
      expect(failures[0] && "error" in failures[0] ? failures[0].error : "").toContain(
        "exited with code 1",
      );
    } finally {
      await session.close();
    }
  });
});
