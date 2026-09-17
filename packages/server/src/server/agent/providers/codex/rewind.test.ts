import { describe, expect, test } from "vitest";

import type {
  CodexThreadRollbackParams,
  CodexThreadRollbackResponse,
} from "./app-server-transport.js";
import {
  type CodexUserMessageTurnIndex,
  type CodexRewindClient,
  revertCodexConversation,
} from "./rewind.js";
import { CodexAppServerRpcError } from "./app-server-transport.js";

class FakeCodex implements CodexRewindClient {
  readonly recordedRollbacks: CodexThreadRollbackParams[] = [];

  async rollbackThread(params: CodexThreadRollbackParams): Promise<CodexThreadRollbackResponse> {
    this.recordedRollbacks.push(params);
    return {
      thread: {
        id: params.threadId,
        sessionId: "source-session",
        turns: [],
      },
    };
  }

  async request(method: string): Promise<unknown> {
    if (method === "thread/read") {
      return { thread: { id: "source-thread", historyMode: "legacy" } };
    }
    throw new Error(`Unexpected request: ${method}`);
  }
}

class CodexMessageTurns implements CodexUserMessageTurnIndex {
  constructor(private readonly indexesByMessageId: Map<string, number>) {}

  resolve(messageId: string): number | null {
    return this.indexesByMessageId.get(messageId) ?? null;
  }

  count(): number {
    return this.indexesByMessageId.size;
  }
}

class ScriptedCodex implements CodexRewindClient {
  readonly requests: Array<{ method: string; params: unknown }> = [];

  constructor(private readonly responses: unknown[]) {}

  async request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    if (this.responses.length === 0) {
      throw new Error(`Unexpected request: ${method}`);
    }
    const response = this.responses.shift();
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }
}

describe("Codex Rewind", () => {
  test("原生索引损坏时明确提示恢复索引，保留原错误且不再次执行回退", async () => {
    const original = new CodexAppServerRpcError(
      "failed to revert session: thread-store internal error: durable rollout shrank before projection",
      -32603,
      undefined,
    );
    const codex = new ScriptedCodex([
      { thread: { id: "source-thread", historyMode: "paginated" } },
      {
        data: [
          {
            id: "turn-target",
            itemsView: "full",
            items: [{ type: "userMessage", id: "user-target" }],
          },
        ],
        nextCursor: null,
      },
      original,
    ]);
    const restored: string[] = [];
    await expect(
      revertCodexConversation({
        client: codex,
        threadId: "source-thread",
        messageId: "user-target",
        userMessageTurns: new CodexMessageTurns(new Map()),
        setThreadId: (id) => {
          restored.push(id);
        },
      }),
    ).rejects.toMatchObject({
      name: "CodexHistoryProjectionError",
      message: expect.stringContaining("历史索引"),
      threadId: "source-thread",
      cause: original,
    });
    expect(codex.requests.map((r) => r.method)).toEqual([
      "thread/read",
      "thread/turns/list",
      "thread/revert",
    ]);
    expect(restored).toEqual([]);
  });

  test.each(["client-target", "codex-target"])(
    "分页会话按消息 %s 定位原生回合，并完整恢复保留历史",
    async (messageId) => {
      const oldestTurn = { id: "turn-oldest", itemsView: "full", items: [] };
      const retainedTurn = {
        id: "turn-retained",
        itemsView: "full",
        items: [
          { type: "userMessage", id: "user-retained", content: [{ type: "text", text: "保留" }] },
          { type: "agentMessage", id: "answer-retained", text: "已记录" },
        ],
      };
      const codex = new ScriptedCodex([
        { thread: { id: "source-thread", historyMode: "paginated" } },
        {
          data: [{ id: "turn-latest", itemsView: "full", items: [] }],
          nextCursor: "older-turns",
        },
        {
          data: [
            {
              id: "turn-target",
              itemsView: "full",
              items: [{ type: "userMessage", id: "codex-target", clientId: "client-target" }],
            },
          ],
          nextCursor: null,
        },
        {
          thread: { id: "source-thread", historyMode: "paginated", turns: [] },
          turnsBackwardsCursor: "retained-tail",
          itemsBackwardsCursor: null,
        },
        { data: [retainedTurn], nextCursor: "retained-older" },
        { data: [oldestTurn], nextCursor: null },
      ]);
      const restored: Array<{ threadId: string; history: unknown }> = [];

      await revertCodexConversation({
        client: codex,
        threadId: "source-thread",
        messageId,
        userMessageTurns: new CodexMessageTurns(new Map()),
        setThreadId: (threadId, history) => {
          restored.push({ threadId, history });
        },
      });

      expect(codex.requests).toEqual([
        { method: "thread/read", params: { threadId: "source-thread", includeTurns: false } },
        {
          method: "thread/turns/list",
          params: {
            threadId: "source-thread",
            cursor: null,
            limit: 100,
            sortDirection: "desc",
            itemsView: "full",
          },
        },
        {
          method: "thread/turns/list",
          params: {
            threadId: "source-thread",
            cursor: "older-turns",
            limit: 100,
            sortDirection: "desc",
            itemsView: "full",
          },
        },
        {
          method: "thread/revert",
          params: { threadId: "source-thread", beforeTurnId: "turn-target" },
        },
        {
          method: "thread/turns/list",
          params: {
            threadId: "source-thread",
            cursor: "retained-tail",
            limit: 100,
            sortDirection: "desc",
            itemsView: "full",
          },
        },
        {
          method: "thread/turns/list",
          params: {
            threadId: "source-thread",
            cursor: "retained-older",
            limit: 100,
            sortDirection: "desc",
            itemsView: "full",
          },
        },
      ]);
      expect(restored).toEqual([
        {
          threadId: "source-thread",
          history: {
            thread: {
              id: "source-thread",
              historyMode: "paginated",
              turns: [oldestTurn, retainedTurn],
            },
          },
        },
      ]);
    },
  );

  test("回退首个原生回合时清空对话，不把空游标当成最新历史重新读取", async () => {
    const codex = new ScriptedCodex([
      { thread: { id: "source-thread", historyMode: "paginated" } },
      {
        data: [
          {
            id: "turn-first",
            itemsView: "full",
            items: [{ type: "userMessage", id: "codex-first" }],
          },
        ],
        nextCursor: null,
      },
      {
        thread: { id: "source-thread", historyMode: "paginated", turns: [] },
        turnsBackwardsCursor: null,
        itemsBackwardsCursor: null,
      },
    ]);
    const restored: unknown[] = [];

    await revertCodexConversation({
      client: codex,
      threadId: "source-thread",
      messageId: "codex-first",
      userMessageTurns: new CodexMessageTurns(new Map()),
      setThreadId: (threadId, history) => {
        restored.push({ threadId, history });
      },
    });

    expect(codex.requests.map((request) => request.method)).toEqual([
      "thread/read",
      "thread/turns/list",
      "thread/revert",
    ]);
    expect(restored).toEqual([
      {
        threadId: "source-thread",
        history: { thread: { id: "source-thread", historyMode: "paginated", turns: [] } },
      },
    ]);
  });

  test.each([
    {
      label: "目标不存在",
      pages: [{ data: [], nextCursor: null }],
      error: "could not find user message",
    },
    { label: "读取失败", pages: [new Error("history unavailable")], error: "history unavailable" },
    {
      label: "历史不完整",
      pages: [
        { data: [{ id: "turn-partial", itemsView: "summary", items: [] }], nextCursor: null },
      ],
      error: "full",
    },
    {
      label: "游标重复",
      pages: [
        { data: [], nextCursor: "again" },
        { data: [], nextCursor: "again" },
      ],
      error: "repeated turn history cursor",
    },
  ])("$label 时不执行回退，也不按缓存中的消息序号猜测目标", async ({ pages, error }) => {
    const codex = new ScriptedCodex([
      { thread: { id: "source-thread", historyMode: "paginated" } },
      ...pages,
    ]);
    const restored: string[] = [];

    await expect(
      revertCodexConversation({
        client: codex,
        threadId: "source-thread",
        messageId: "codex-target",
        userMessageTurns: new CodexMessageTurns(new Map([["codex-target", 0]])),
        setThreadId: (threadId) => {
          restored.push(threadId);
        },
      }),
    ).rejects.toThrow(error);

    expect(
      codex.requests.filter(
        (request) => !["thread/read", "thread/turns/list"].includes(request.method),
      ),
    ).toEqual([]);
    expect(restored).toEqual([]);
  });

  test.each([
    { label: "回退失败", response: new Error("revert failed"), after: [], error: "revert failed" },
    {
      label: "响应线程错误",
      response: {
        thread: { id: "other-thread", historyMode: "paginated" },
        turnsBackwardsCursor: null,
      },
      after: [],
      error: "instead of source-thread",
    },
    {
      label: "保留历史读取失败",
      response: {
        thread: { id: "source-thread", historyMode: "paginated" },
        turnsBackwardsCursor: "retained-tail",
      },
      after: [new Error("retained history unavailable")],
      error: "retained history unavailable",
    },
  ])("$label 时显式失败，不分叉会话或展示成功的空历史", async ({ response, after, error }) => {
    const codex = new ScriptedCodex([
      { thread: { id: "source-thread", historyMode: "paginated" } },
      {
        data: [
          {
            id: "turn-target",
            itemsView: "full",
            items: [{ type: "userMessage", id: "codex-target" }],
          },
        ],
        nextCursor: null,
      },
      response,
      ...after,
    ]);
    const restored: string[] = [];

    await expect(
      revertCodexConversation({
        client: codex,
        threadId: "source-thread",
        messageId: "codex-target",
        userMessageTurns: new CodexMessageTurns(new Map()),
        setThreadId: (threadId) => {
          restored.push(threadId);
        },
      }),
    ).rejects.toThrow(error);

    expect(
      codex.requests.filter((request) =>
        ["thread/fork", "thread/rollback"].includes(request.method),
      ),
    ).toEqual([]);
    expect(restored).toEqual([]);
  });

  test("rewinds the current thread directly past the native user message", async () => {
    const codex = new FakeCodex();
    const userMessageTurns = new CodexMessageTurns(
      new Map([
        ["codex-first", 0],
        ["codex-second", 1],
      ]),
    );
    let reboundThreadId: string | null = null;

    await revertCodexConversation({
      client: codex,
      threadId: "source-thread",
      messageId: "codex-first",
      userMessageTurns,
      setThreadId: (threadId) => {
        reboundThreadId = threadId;
      },
    });

    expect(codex.recordedRollbacks).toEqual([{ threadId: "source-thread", numTurns: 2 }]);
    expect(reboundThreadId).toBe("source-thread");
  });

  test("rewinds the conversation using native user message ids hydrated from app-server history", async () => {
    const codex = new FakeCodex();
    const userMessageTurns = new CodexMessageTurns(
      new Map([
        ["codex-first", 0],
        ["codex-second", 1],
        ["codex-third", 2],
      ]),
    );
    let reboundThreadId: string | null = null;

    await revertCodexConversation({
      client: codex,
      threadId: "source-thread",
      messageId: "codex-second",
      userMessageTurns,
      setThreadId: (threadId) => {
        reboundThreadId = threadId;
      },
    });

    expect(codex.recordedRollbacks).toEqual([{ threadId: "source-thread", numTurns: 2 }]);
    expect(reboundThreadId).toBe("source-thread");
  });

  test("declines to rewind when the user message is not in the Codex thread", async () => {
    const codex = new FakeCodex();
    const userMessageTurns = new CodexMessageTurns(new Map([["codex-first", 0]]));

    await expect(
      revertCodexConversation({
        client: codex,
        threadId: "source-thread",
        messageId: "missing-message",
        userMessageTurns,
        setThreadId: () => undefined,
      }),
    ).rejects.toThrow("Codex could not find user message missing-message");
    expect(codex.recordedRollbacks).toEqual([]);
  });
});
