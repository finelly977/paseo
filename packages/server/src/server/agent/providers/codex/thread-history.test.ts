import { describe, expect, test } from "vitest";
import {
  readCodexThread,
  readCodexPaginatedThread,
  readCodexThreadLatest,
  readCodexThreadLatestStatus,
} from "./thread-history.js";

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

function createConcurrentHistoryClient(responsesByMethod: Record<string, readonly unknown[]>) {
  const requests: HistoryRequest[] = [];
  const clients = new Map(
    Object.entries(responsesByMethod).map(([method, responses]) => [
      method,
      createHistoryClient(responses),
    ]),
  );
  return {
    requests,
    async request(method: string, params?: unknown): Promise<unknown> {
      requests.push({ method, params });
      const client = clients.get(method);
      if (!client) throw new Error(`Unexpected history request: ${method}`);
      return client.request(method, params);
    },
  };
}

const paginatedMetadata = { thread: { id: "thread-1", historyMode: "paginated" } };
const firstTurnPage = {
  data: [{ id: "turn-1", items: [], status: "completed" }],
  nextCursor: null,
};

describe("Codex 原生历史分页", () => {
  test("核对子任务状态只取最后一个原生回合头，不读取过程正文或旧分页", async () => {
    const client = createHistoryClient([
      paginatedMetadata,
      { data: [{ id: "last-turn", status: "completed", items: [] }], nextCursor: "older" },
    ]);
    expect(await readCodexThreadLatestStatus(client, "thread-1")).toEqual({
      id: "last-turn",
      status: "completed",
    });
    expect(client.requests).toEqual([
      { method: "thread/read", params: { threadId: "thread-1", includeTurns: false } },
      {
        method: "thread/turns/list",
        params: {
          threadId: "thread-1",
          cursor: null,
          limit: 1,
          sortDirection: "desc",
          itemsView: "notLoaded",
        },
      },
    ]);
  });

  test("尚未开始的子任务没有回合时不猜测完成，未知状态显式失败", async () => {
    expect(
      await readCodexThreadLatestStatus(
        createHistoryClient([paginatedMetadata, { data: [], nextCursor: null }]),
        "thread-1",
      ),
    ).toBeNull();
    await expect(
      readCodexThreadLatestStatus(
        createHistoryClient([
          paginatedMetadata,
          { data: [{ id: "last", status: "unknown" }], nextCursor: null },
        ]),
        "thread-1",
      ),
    ).rejects.toThrow();
  });

  test("非分页原生会话核对最后一轮自己的中断态", async () => {
    const client = createHistoryClient([
      { thread: { historyMode: "legacy" } },
      {
        thread: {
          turns: [
            { id: "old", items: [], status: "completed" },
            { id: "last", items: [], status: "interrupted" },
          ],
        },
      },
    ]);
    expect(await readCodexThreadLatestStatus(client, "thread-1")).toEqual({
      id: "last",
      status: "interrupted",
    });
  });
  test("只读原生最新页即可返回，较早正文留给后台，不混入任何本地副本", async () => {
    const client = createHistoryClient([
      paginatedMetadata,
      {
        data: [
          {
            turnId: "turn-2",
            item: { id: "answer", type: "agentMessage", text: "其他客户端新增的最新回复" },
          },
          { turnId: "turn-2", item: { id: "question", type: "userMessage", content: [] } },
        ],
        nextCursor: "older-items",
      },
      { data: [{ id: "turn-2", items: [], status: "completed" }], nextCursor: "older-turns" },
    ]);
    const latest = await readCodexThreadLatest(client, "thread-1");
    expect(latest).toEqual({
      hasOlder: true,
      response: {
        thread: {
          ...paginatedMetadata.thread,
          turns: [
            {
              id: "turn-2",
              status: "completed",
              items: [
                { id: "question", type: "userMessage", content: [] },
                { id: "answer", type: "agentMessage", text: "其他客户端新增的最新回复" },
              ],
            },
          ],
        },
      },
    });
    expect(client.requests).toEqual([
      { method: "thread/read", params: { threadId: "thread-1", includeTurns: false } },
      {
        method: "thread/items/list",
        params: { threadId: "thread-1", cursor: null, limit: 100, sortDirection: "desc" },
      },
      {
        method: "thread/turns/list",
        params: {
          threadId: "thread-1",
          cursor: null,
          limit: 100,
          sortDirection: "desc",
          itemsView: "notLoaded",
        },
      },
    ]);
  });

  test("最新页跨回合时补齐必要回合头，缺少归属则明确失败", async () => {
    const client = createHistoryClient([
      paginatedMetadata,
      { data: [{ turnId: "older", item: { id: "item", type: "agentMessage" } }], nextCursor: null },
      { data: [{ id: "empty-newer", items: [] }], nextCursor: "older-turns" },
      { data: [{ id: "older", items: [] }], nextCursor: null },
    ]);
    expect(await readCodexThreadLatest(client, "thread-1")).toMatchObject({
      hasOlder: false,
      response: { thread: { turns: [{ id: "older", items: [{ id: "item" }] }] } },
    });
    const invalid = createHistoryClient([
      paginatedMetadata,
      {
        data: [{ turnId: "missing", item: { id: "item", type: "agentMessage" } }],
        nextCursor: null,
      },
      { data: [], nextCursor: null },
    ]);
    await expect(readCodexThreadLatest(invalid, "thread-1")).rejects.toThrow("unknown turns");
  });

  test("回退的两个反向游标分别读完后恢复时间顺序，重叠条目不重复", async () => {
    const client = createConcurrentHistoryClient({
      "thread/turns/list": [
        { data: [{ id: "turn-2", items: [] }], nextCursor: "older-turns" },
        {
          data: [
            { id: "turn-2", items: [] },
            { id: "turn-1", items: [] },
          ],
          nextCursor: null,
        },
      ],
      "thread/items/list": [
        {
          data: [{ turnId: "turn-2", item: { id: "b", type: "agentMessage", text: "答复" } }],
          nextCursor: "older-items",
        },
        {
          data: [
            { turnId: "turn-2", item: { id: "b", type: "agentMessage", text: "完整答复" } },
            { turnId: "turn-2", item: { id: "a", type: "userMessage" } },
            { turnId: "turn-1", item: { id: "a", type: "userMessage" } },
          ],
          nextCursor: null,
        },
      ],
    });
    const history = await readCodexPaginatedThread({
      client,
      threadId: "thread-1",
      thread: { id: "thread-1", historyMode: "paginated" },
      sortDirection: "desc",
      turnsCursor: "retained-turns",
      itemsCursor: "retained-items",
    });
    expect(history.thread.turns).toEqual([
      { id: "turn-1", items: [{ id: "a", type: "userMessage" }] },
      {
        id: "turn-2",
        items: [
          { id: "a", type: "userMessage" },
          { id: "b", type: "agentMessage", text: "完整答复" },
        ],
      },
    ]);
    expect(client.requests.map((request) => request.params)).toEqual([
      {
        threadId: "thread-1",
        cursor: "retained-turns",
        limit: 100,
        sortDirection: "desc",
        itemsView: "notLoaded",
      },
      { threadId: "thread-1", cursor: "retained-items", limit: 100, sortDirection: "desc" },
      {
        threadId: "thread-1",
        cursor: "older-turns",
        limit: 100,
        sortDirection: "desc",
        itemsView: "notLoaded",
      },
      { threadId: "thread-1", cursor: "older-items", limit: 100, sortDirection: "desc" },
    ]);
  });

  test("按原始顺序合并跨页回合与正文，保留回合元信息和未知条目字段", async () => {
    const requests: string[] = [];
    const client = createConcurrentHistoryClient({
      "thread/read": [{ thread: { id: "thread-1", historyMode: "paginated" } }],
      "thread/turns/list": [
        { data: [{ id: "turn-1", items: [], startedAt: 123 }], nextCursor: "turn-next" },
        { data: [{ id: "turn-2", items: [], status: "completed" }], nextCursor: null },
      ],
      "thread/items/list": [
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
      ],
    });
    const history = await readCodexThread(
      {
        async request(method, params) {
          requests.push(method);
          expect(params).toMatchObject({ threadId: "thread-1" });
          if (method !== "thread/read")
            expect(params).toMatchObject({ sortDirection: "asc", limit: 100 });
          if (method === "thread/turns/list")
            expect(params).toMatchObject({ itemsView: "notLoaded" });
          return client.request(method, params);
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
      "thread/items/list",
      "thread/turns/list",
      "thread/items/list",
    ]);
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
    const client = createConcurrentHistoryClient({
      "thread/read": [paginatedMetadata],
      "thread/turns/list": [
        { ...firstTurnPage, nextCursor: "turn-next" },
        {
          data: [
            { id: "turn-1", items: [], status: "updated" },
            { id: "turn-2", items: [] },
          ],
          nextCursor: null,
        },
      ],
      "thread/items/list": [
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
      ],
    });
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
    expect(client.requests[3].params).toMatchObject({ cursor: "turn-next" });
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
      const responses = [
        { data: [], nextCursor: "a" },
        { data: [], nextCursor: "b" },
        { data: [], nextCursor: "a" },
      ];
      const client = createConcurrentHistoryClient({
        "thread/read": [paginatedMetadata],
        "thread/turns/list": method === "thread/turns/list" ? responses : [firstTurnPage],
        "thread/items/list":
          method === "thread/items/list" ? responses : [{ data: [], nextCursor: null }],
      });
      await expect(readCodexThread(client, "thread-1")).rejects.toThrow(
        `${method} returned a repeated cursor`,
      );
      expect(client.requests).toHaveLength(5);
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
