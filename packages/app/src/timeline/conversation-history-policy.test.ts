import { describe, expect, test } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  allocateConversationHistoryBudget,
  countConversationTurns,
  trimConversationHistory,
} from "./conversation-history-policy";

function message(kind: "user_message" | "assistant_message", id: string): StreamItem {
  return {
    kind,
    id,
    text: id,
    timestamp: new Date(`2026-07-30T00:00:0${id.at(-1) ?? "0"}.000Z`),
  };
}

const threeTurns = [
  message("user_message", "u1"),
  message("assistant_message", "a1"),
  message("user_message", "u2"),
  message("assistant_message", "a2"),
  message("user_message", "u3"),
  message("assistant_message", "a3"),
];

describe("对话历史内存策略", () => {
  test("按用户消息计算对话数并从完整轮次边界裁剪", () => {
    expect(countConversationTurns(threeTurns)).toBe(3);
    expect(trimConversationHistory(threeTurns, 2).map((item) => item.id)).toEqual([
      "u2",
      "a2",
      "u3",
      "a3",
    ]);
  });

  test("优先给当前会话分配预算，再按最近打开时间保留旧会话", () => {
    const allocations = allocateConversationHistoryBudget({
      totalLimit: 5,
      entries: [
        { key: "旧", items: threeTurns, openedAt: 1, current: false },
        { key: "当前", items: threeTurns, openedAt: 2, current: true },
        { key: "较新", items: threeTurns, openedAt: 3, current: false },
      ],
    });

    expect(Object.fromEntries(allocations)).toEqual({ 当前: 3, 较新: 2, 旧: 0 });
  });
});
