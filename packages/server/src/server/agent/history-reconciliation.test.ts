import { describe, expect, test } from "vitest";

import { reconcileProviderHistory } from "./history-reconciliation.js";

const user = (text: string, id?: string) => ({
  type: "user_message" as const,
  text,
  ...(id ? { clientMessageId: id } : {}),
});

const assistant = (text: string, messageId: string) => ({
  type: "assistant_message" as const,
  text,
  messageId,
});

describe("reconcileProviderHistory", () => {
  test("puts missing provider prefix before a newer durable suffix while preserving suffix metadata", () => {
    const rows = reconcileProviderHistory(
      [
        {
          seq: 2,
          timestamp: "2026-01-02T00:00:00.000Z",
          item: user("suffix", "suffix"),
          turnId: "turn-1",
          providerMessageId: "p-suffix",
        },
      ],
      [
        { item: user("prefix"), timestamp: "2026-01-01T00:00:00.000Z" },
        { item: user("suffix"), timestamp: "2026-01-02T00:00:00.000Z" },
      ],
    );
    expect(rows).toMatchObject([
      { seq: 1, item: { text: "prefix" } },
      {
        seq: 2,
        turnId: "turn-1",
        providerMessageId: "p-suffix",
        item: { text: "suffix", clientMessageId: "suffix" },
      },
    ]);
  });

  test("pairs repeated identical user text by ordered occurrence", () => {
    const rows = reconcileProviderHistory(
      [
        {
          seq: 1,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: user("same", "one"),
          turnId: "turn-1",
        },
        {
          seq: 2,
          timestamp: "2026-01-02T00:00:00.000Z",
          item: user("same", "two"),
          turnId: "turn-2",
        },
      ],
      [{ item: user("same") }, { item: user("same") }],
    );
    expect(
      rows.map((row) => [
        row.item.type === "user_message" ? row.item.clientMessageId : null,
        row.turnId,
      ]),
    ).toEqual([
      ["one", "turn-1"],
      ["two", "turn-2"],
    ]);
  });

  test("retains a canonical suffix when provider history is lagging", () => {
    const rows = reconcileProviderHistory(
      [
        {
          seq: 1,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: user("initial", "initial"),
          turnId: "turn-1",
        },
        {
          seq: 2,
          timestamp: "2026-01-02T00:00:00.000Z",
          item: user("hello", "hello"),
          turnId: "turn-1",
        },
      ],
      [{ item: user("initial") }],
    );

    expect(rows).toMatchObject([
      { seq: 1, item: { text: "initial", clientMessageId: "initial" }, turnId: "turn-1" },
      { seq: 2, item: { text: "hello", clientMessageId: "hello" }, turnId: "turn-1" },
    ]);
  });

  test("does not transfer provider identity between ambiguous repeated prompts", () => {
    const rows = reconcileProviderHistory(
      [
        {
          seq: 1,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: user("same", "one"),
          turnId: "turn-1",
        },
        {
          seq: 2,
          timestamp: "2026-01-02T00:00:00.000Z",
          item: user("same", "two"),
          turnId: "turn-2",
        },
      ],
      [{ item: { type: "user_message", text: "same", messageId: "provider-two" } }],
    );

    expect(rows).toMatchObject([
      { item: { clientMessageId: "one" }, turnId: "turn-1" },
      { item: { clientMessageId: "two" }, turnId: "turn-2" },
    ]);
    expect(rows.some((row) => row.providerMessageId === "provider-two")).toBe(false);
  });

  test("does not invent turn membership for provider-only rows", () => {
    expect(
      reconcileProviderHistory([], [{ item: { type: "assistant_message", text: "provider" } }])[0]
        ?.turnId,
    ).toBeUndefined();
  });

  test("clears unmatched rows for an authoritative forced history", () => {
    expect(
      reconcileProviderHistory(
        [{ seq: 1, timestamp: "now", item: user("old", "old"), turnId: "turn-1" }],
        [],
        { mode: "force" },
      ),
    ).toEqual([]);
  });

  test("将提供方完整助手消息与同一条实时流式片段对齐", () => {
    const rows = reconcileProviderHistory(
      [
        {
          seq: 1,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: user("开始", "client-user"),
          turnId: "turn-1",
        },
        {
          seq: 2,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: assistant("\n\n---\n\n正在", "live-assistant"),
          turnId: "turn-1",
        },
        {
          seq: 3,
          timestamp: "2026-01-01T00:00:01.100Z",
          item: assistant("处理", "live-assistant"),
          turnId: "turn-1",
        },
      ],
      [
        { item: { type: "user_message", text: "开始", messageId: "provider-user" } },
        { item: assistant("正在处理", "provider-assistant") },
      ],
    );

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.item)).toEqual([
      expect.objectContaining({ type: "user_message", text: "开始" }),
      assistant("\n\n---\n\n正在", "live-assistant"),
      assistant("处理", "live-assistant"),
    ]);
    expect(rows.slice(1).map((row) => row.turnId)).toEqual(["turn-1", "turn-1"]);
  });

  test("再次恢复时清理同一回合中旧版本写入的助手消息副本", () => {
    const rows = reconcileProviderHistory(
      [
        {
          seq: 1,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: user("开始", "client-user"),
          turnId: "turn-1",
        },
        {
          seq: 2,
          timestamp: "2026-01-01T00:00:03.000Z",
          item: assistant("正在处理", "provider-assistant"),
        },
        {
          seq: 3,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: assistant("正在", "live-assistant"),
          turnId: "turn-1",
        },
        {
          seq: 4,
          timestamp: "2026-01-01T00:00:01.100Z",
          item: assistant("处理", "live-assistant"),
          turnId: "turn-1",
        },
      ],
      [
        { item: { type: "user_message", text: "开始", messageId: "provider-user" } },
        { item: assistant("正在处理", "provider-assistant") },
      ],
    );

    expect(rows).toHaveLength(3);
    expect(
      rows.filter(
        (row) =>
          row.item.type === "assistant_message" && row.item.messageId === "provider-assistant",
      ),
    ).toEqual([]);
    expect(rows.slice(1).map((row) => row.item)).toEqual([
      assistant("正在", "live-assistant"),
      assistant("处理", "live-assistant"),
    ]);
  });

  test("相同助手正文出现在不同用户回合时仍按原顺序逐轮对齐", () => {
    const rows = reconcileProviderHistory(
      [
        {
          seq: 1,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: user("第一轮", "client-user-1"),
          turnId: "turn-1",
        },
        {
          seq: 2,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: assistant("完成", "provider-assistant-1"),
        },
        {
          seq: 3,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: user("第二轮", "client-user-2"),
          turnId: "turn-2",
        },
        {
          seq: 4,
          timestamp: "2026-01-01T00:00:03.000Z",
          item: assistant("完成", "live-assistant-2"),
          turnId: "turn-2",
        },
      ],
      [
        { item: { type: "user_message", text: "第一轮", messageId: "provider-user-1" } },
        { item: assistant("完成", "provider-assistant-1") },
        { item: { type: "user_message", text: "第二轮", messageId: "provider-user-2" } },
        { item: assistant("完成", "provider-assistant-2") },
      ],
    );

    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.item.type)).toEqual([
      "user_message",
      "assistant_message",
      "user_message",
      "assistant_message",
    ]);
    expect(rows[1]?.item).toEqual(assistant("完成", "provider-assistant-1"));
    expect(rows[3]).toMatchObject({
      turnId: "turn-2",
      item: assistant("完成", "live-assistant-2"),
    });
  });
});
