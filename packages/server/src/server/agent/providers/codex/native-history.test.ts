import { expect, test } from "vitest";
import { createNativeCodexHistory } from "./native-history.js";

test("原生浏览只取摘要，下一页不依赖完整历史；回合详情独立有界读取", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const pages = [
    {
      data: [
        {
          id: "turn-b",
          status: "completed",
          startedAt: 12,
          durationMs: 4000,
          error: null,
          items: [{ type: "assistant_message", messageId: "b", text: "原生最新正文" }],
        },
      ],
      nextCursor: "older",
    },
    {
      data: [
        {
          id: "turn-a",
          status: "interrupted",
          startedAt: 1,
          durationMs: null,
          error: null,
          items: [],
        },
      ],
      nextCursor: null,
    },
    {
      data: [
        {
          turnId: "turn-a",
          item: { type: "assistant_message", messageId: "a", text: "中断前的说明" },
        },
      ],
      nextCursor: "details",
    },
  ];
  const history = createNativeCodexHistory({
    threadId: "thread",
    request: async (method, params) => {
      calls.push({ method, params });
      const page = pages.shift();
      if (!page) throw new Error("意外读取了未请求的历史");
      return page;
    },
    mapItem: (raw) => raw as { type: "assistant_message"; messageId: string; text: string },
    complete: async () => {
      throw new Error("不能调用完整核对");
    },
  });
  expect(await history.readPage(null, 5)).toEqual({
    readId: "thread",
    cursor: null,
    nextCursor: "older",
    turns: [
      {
        id: "turn-b",
        status: "completed",
        startedAt: 12,
        durationMs: 4000,
        error: null,
        items: [{ type: "assistant_message", messageId: "b", text: "原生最新正文" }],
      },
    ],
  });
  expect((await history.readPage("older", 20)).turns[0].status).toBe("interrupted");
  expect(await history.readTurn("turn-a", null)).toEqual({
    items: [{ type: "assistant_message", messageId: "a", text: "中断前的说明" }],
    nextCursor: "details",
  });
  expect(calls).toEqual([
    {
      method: "thread/turns/list",
      params: {
        threadId: "thread",
        cursor: null,
        limit: 5,
        sortDirection: "desc",
        itemsView: "summary",
      },
    },
    {
      method: "thread/turns/list",
      params: {
        threadId: "thread",
        cursor: "older",
        limit: 20,
        sortDirection: "desc",
        itemsView: "summary",
      },
    },
    {
      method: "thread/items/list",
      params: {
        threadId: "thread",
        turnId: "turn-a",
        cursor: null,
        limit: 100,
        sortDirection: "asc",
      },
    },
  ]);
});

test("非法归属、重复游标及失败不能伪装成历史已耗尽", async () => {
  const history = createNativeCodexHistory({
    threadId: "thread",
    request: async (method) =>
      method === "thread/items/list"
        ? { data: [{ turnId: "wrong", item: {} }], nextCursor: null }
        : { data: [], nextCursor: "repeated" },
    mapItem: () => null,
    complete: async () => undefined,
  });
  await expect(history.readPage("repeated", 20)).rejects.toThrow("游标没有前进");
  await expect(history.readTurn("expected", null)).rejects.toThrow("其他回合");
});
