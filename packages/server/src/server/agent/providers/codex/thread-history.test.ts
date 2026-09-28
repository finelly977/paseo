import { describe, expect, test } from "vitest";
import { readCodexThread } from "./thread-history.js";

interface HistoryRequest {
  method: string;
  params: unknown;
}

function createHistoryClient(responses: readonly unknown[]) {
  const requests: HistoryRequest[] = [];
  return {
    requests,
    async request(method: string, params?: unknown): Promise<unknown> {
      const index = requests.length;
      requests.push({ method, params });
      if (index >= responses.length) throw new Error(`Unexpected history request: ${method}`);
      const response = responses[index];
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

const paginatedMetadata = { thread: { id: "thread-1", historyMode: "paginated" } };
const firstTurnPage = {
  data: [{ id: "turn-1", items: [], status: "completed" }],
  nextCursor: null,
};

describe("Codex 原生历史分页", () => {
  test("按原始顺序合并跨页回合与正文，保留回合元信息和未知条目字段", async () => {
    const requests: string[] = [];
    const responses = [
      { thread: { id: "thread-1", historyMode: "paginated" } },
      { data: [{ id: "turn-1", items: [], startedAt: 123 }], nextCursor: "turn-next" },
      { data: [{ id: "turn-2", items: [], status: "completed" }], nextCursor: null },
      {
        data: [{ turnId: "turn-1", item: { id: "item-1", type: "userMessage", text: "问题" } }],
        nextCursor: "item-next",
      },
      {
        data: [
          { turnId: "turn-1", item: { id: "item-2", type: "agentMessage", text: "回复" } },
          { turnId: "turn-2", item: { id: "item-3", type: "futureItem", payload: { a: 1 } } },
        ],
        nextCursor: null,
      },
    ];
    const history = await readCodexThread(
      {
        async request(method, params) {
          requests.push(method);
          expect(params).toMatchObject({ threadId: "thread-1" });
          if (method !== "thread/read")
            expect(params).toMatchObject({ sortDirection: "asc", limit: 100 });
          if (method === "thread/turns/list")
            expect(params).toMatchObject({ itemsView: "notLoaded" });
          return responses.shift();
        },
      },
      "thread-1",
    );
    expect(history).toEqual({
      thread: {
        id: "thread-1",
        historyMode: "paginated",
        turns: [
          {
            id: "turn-1",
            startedAt: 123,
            items: [
              { id: "item-1", type: "userMessage", text: "问题" },
              { id: "item-2", type: "agentMessage", text: "回复" },
            ],
          },
          {
            id: "turn-2",
            status: "completed",
            items: [{ id: "item-3", type: "futureItem", payload: { a: 1 } }],
          },
        ],
      },
    });
    expect(requests).toEqual([
      "thread/read",
      "thread/turns/list",
      "thread/turns/list",
      "thread/items/list",
      "thread/items/list",
    ]);
    expect(responses).toEqual([]);
  });

  test("legacy 存储按其原生接口完整读取，不请求分页接口", async () => {
    const fullHistory = {
      thread: {
        historyMode: "legacy",
        turns: [{ items: [{ type: "agentMessage", text: "原生历史" }] }],
      },
    };
    const client = createHistoryClient([{ thread: { historyMode: "legacy" } }, fullHistory]);
    await expect(readCodexThread(client, "thread-1")).resolves.toEqual(fullHistory);
    expect(client.requests).toEqual([
      { method: "thread/read", params: { threadId: "thread-1", includeTurns: false } },
      { method: "thread/read", params: { threadId: "thread-1", includeTurns: true } },
    ]);
  });

  test.each([{}, { thread: {} }, { thread: { turns: [{}] } }])(
    "legacy 完整响应缺少必要历史字段时明确失败：%j",
    async (response) => {
      const client = createHistoryClient([{ thread: { historyMode: "legacy" } }, response]);
      await expect(readCodexThread(client, "thread-1")).rejects.toThrow();
    },
  );

  test("重叠页按回合及条目身份去重，不打乱顺序也不合并不同回合的同名条目", async () => {
    const client = createHistoryClient([
      paginatedMetadata,
      { ...firstTurnPage, nextCursor: "turn-next" },
      {
        data: [
          { id: "turn-1", items: [], status: "updated" },
          { id: "turn-2", items: [] },
        ],
        nextCursor: null,
      },
      {
        data: [
          { turnId: "turn-1", item: { id: "a", type: "agentMessage", text: "未完成" } },
          { turnId: "turn-1", item: { id: "b", type: "agentMessage", text: "第二条" } },
        ],
        nextCursor: "item-next",
      },
      {
        data: [
          { turnId: "turn-1", item: { id: "a", type: "agentMessage", text: "完成" } },
          { turnId: "turn-2", item: { id: "a", type: "agentMessage", text: "其他回合" } },
        ],
        nextCursor: null,
      },
    ]);
    await expect(readCodexThread(client, "thread-1")).resolves.toMatchObject({
      thread: {
        turns: [
          {
            id: "turn-1",
            status: "updated",
            items: [
              { id: "a", text: "完成" },
              { id: "b", text: "第二条" },
            ],
          },
          { id: "turn-2", items: [{ id: "a", text: "其他回合" }] },
        ],
      },
    });
    expect(client.requests[2].params).toMatchObject({ cursor: "turn-next" });
    expect(client.requests[4].params).toMatchObject({ cursor: "item-next" });
  });

  test("空页有后续游标时继续读取，保留没有正文的回合", async () => {
    const client = createHistoryClient([
      paginatedMetadata,
      firstTurnPage,
      { data: [], nextCursor: "next" },
      { data: [], nextCursor: null },
    ]);
    await expect(readCodexThread(client, "thread-1")).resolves.toMatchObject({
      thread: { turns: [{ id: "turn-1", items: [] }] },
    });
    expect(client.requests).toHaveLength(4);
  });

  test("空线程是合法的完整历史", async () => {
    const client = createHistoryClient([
      paginatedMetadata,
      { data: [], nextCursor: null },
      { data: [], nextCursor: null },
    ]);
    await expect(readCodexThread(client, "thread-1")).resolves.toMatchObject({
      thread: { turns: [] },
    });
  });

  test.each(["thread/turns/list", "thread/items/list"])(
    "%s 游标形成循环时明确失败",
    async (method) => {
      const responses: unknown[] = [paginatedMetadata];
      if (method === "thread/items/list") responses.push(firstTurnPage);
      responses.push(
        { data: [], nextCursor: "a" },
        { data: [], nextCursor: "b" },
        { data: [], nextCursor: "a" },
      );
      const client = createHistoryClient(responses);
      await expect(readCodexThread(client, "thread-1")).rejects.toThrow(
        `${method} returned a repeated cursor`,
      );
      expect(client.requests).toHaveLength(responses.length);
    },
  );

  test.each([
    { label: "缺失历史格式", response: { thread: {} } },
    { label: "未知历史格式", response: { thread: { historyMode: "future" } } },
  ])("$label 不会静默回退到完整兼容接口", async ({ response }) => {
    const client = createHistoryClient([response]);
    await expect(readCodexThread(client, "thread-1")).rejects.toThrow();
    expect(client.requests).toHaveLength(1);
  });

  test.each([
    { label: "缺少页结束游标", response: { data: [] } },
    {
      label: "条目缺少身份",
      response: { data: [{ turnId: "turn-1", item: { type: "agentMessage" } }], nextCursor: null },
    },
    {
      label: "正文引用不存在的回合",
      response: {
        data: [{ turnId: "absent", item: { id: "item-1", type: "agentMessage" } }],
        nextCursor: null,
      },
    },
    { label: "接口失败", response: new Error("原生分页不可用") },
  ])("$label 时不返回部分历史，也不改用慢接口", async ({ response }) => {
    const client = createHistoryClient([
      paginatedMetadata,
      firstTurnPage,
      {
        data: [{ turnId: "turn-1", item: { id: "item-1", type: "agentMessage", text: "首批" } }],
        nextCursor: "next",
      },
      response,
    ]);
    await expect(readCodexThread(client, "thread-1")).rejects.toThrow();
    expect(client.requests).toHaveLength(4);
    expect(client.requests.map((request) => request.method)).toEqual([
      "thread/read",
      "thread/turns/list",
      "thread/items/list",
      "thread/items/list",
    ]);
  });
});
