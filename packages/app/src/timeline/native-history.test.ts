import { expect, test } from "vitest";
import type { NativeHistoryPage } from "@getpaseo/protocol/messages";
import {
  mergeNativeHistoryPage,
  nativeBeforeCursor,
  retainNativeHistoryLiveItems,
  planNativeHistoryPage,
} from "./native-history";
import { deriveStreamTurnTiming } from "./turn-time";
import type { StreamItem } from "@/types/stream";

const page: NativeHistoryPage = {
  readId: "thread",
  cursor: null,
  nextCursor: "older",
  turns: [
    {
      id: "turn",
      status: "completed",
      startedAt: 1,
      durationMs: 4000,
      error: null,
      items: [
        { type: "user_message", messageId: "q", text: "原生问题" },
        { type: "assistant_message", messageId: "a", text: "原生最终回复" },
      ],
    },
  ],
};

test("摘要保留原生消息、过程入口与真实耗时，不伪造规范序号或工具事件", () => {
  const items = mergeNativeHistoryPage([], page, false, null);
  expect(items.map((item) => item.kind)).toEqual([
    "user_message",
    "native_history_process",
    "assistant_message",
  ]);
  expect(items[1]).toMatchObject({
    id: "native-process:turn",
    turnId: "turn",
    durationMs: 4000,
    error: null,
    status: "completed",
  });
  expect(items.every((item) => item.timelineCursor === undefined)).toBe(true);
  expect(mergeNativeHistoryPage(items, page, false, null)[2]).toBe(items[2]);
});

test("原生缺失的时间与耗时不显示为纪元日期或零秒耗时", () => {
  for (const turn of [
    { ...page.turns[0], startedAt: null },
    { ...page.turns[0], durationMs: null },
  ]) {
    const items = mergeNativeHistoryPage([], { ...page, turns: [turn] }, false, null);
    expect(items[2].timestampUnknown).toBe(true);
    expect(
      deriveStreamTurnTiming({ agentStatus: "idle", tail: items, head: [] }).byAssistantId.size,
    ).toBe(0);
    expect(items[0].timestampUnknown).toBe(turn.startedAt === null);
  }
});

test("补页前插不重建现有行，内存裁剪后的原生边界页可以重读补齐", () => {
  const recent = mergeNativeHistoryPage([], page, false, null);
  const older: NativeHistoryPage = {
    readId: "thread",
    cursor: "older",
    nextCursor: "oldest",
    turns: [
      {
        ...page.turns[0],
        id: "before",
        items: [{ type: "user_message", messageId: "old-q", text: "更早问题" }],
      },
    ],
  };
  const merged = mergeNativeHistoryPage(recent, older, true, "older");
  expect(merged.at(-1)).toBe(recent.at(-1));
  expect(nativeBeforeCursor(merged, { firstTurnId: "before", nextCursor: "oldest" })).toBe(
    "oldest",
  );
  expect(nativeBeforeCursor(recent, { firstTurnId: "before", nextCursor: "oldest" })).toBeNull();
});

test("刷新摘要不删除尚未覆盖的实时回复和待发送用户消息", () => {
  const live: StreamItem[] = [
    { kind: "user_message", id: "q", messageId: "q", text: "原生问题", timestamp: new Date(1000) },
    {
      kind: "assistant_message",
      id: "partial",
      messageId: "partial",
      text: "旧的流式部分",
      timestamp: new Date(2000),
    },
    {
      kind: "user_message",
      id: "next",
      clientMessageId: "next",
      text: "正在发送",
      timestamp: new Date(5000),
    },
  ];
  expect(retainNativeHistoryLiveItems(live, page).map((item) => item.id)).toEqual(["next"]);
  expect(mergeNativeHistoryPage(live, page, false, null).at(-1)).toBe(live[2]);
});

test("外部客户端回退后不保留已删除的旧尾部，没有重叠时不跨过未读缺口", () => {
  const current = mergeNativeHistoryPage([], page, false, null);
  const following: NativeHistoryPage = {
    ...page,
    turns: [
      {
        ...page.turns[0],
        id: "next",
        items: [{ type: "user_message", messageId: "later", text: "已被回退的用户消息" }],
      },
    ],
  };
  const extended = [...current, ...mergeNativeHistoryPage([], following, false, null)];
  expect(mergeNativeHistoryPage(extended, page, false, null).map((item) => item.id)).toEqual(
    current.map((item) => item.id),
  );
  const disjoint = mergeNativeHistoryPage(current, following, false, null);
  expect(disjoint.every((item) => item.nativeTurnId === "next")).toBe(true);
});

test("重复或旧游标的迟到前插页不修改当前窗口", () => {
  const items = mergeNativeHistoryPage([], page, false, null);
  const previous = { readId: "thread", nextCursor: "older", firstTurnId: "turn" };
  expect(planNativeHistoryPage({ items, previous, page, older: true })).toBeNull();
  const older: NativeHistoryPage = { ...page, cursor: "older", nextCursor: null, turns: [] };
  expect(
    planNativeHistoryPage({ items, previous, page: older, older: true })?.nativeState.nextCursor,
  ).toBeNull();
  expect(
    planNativeHistoryPage({
      items,
      previous: { ...previous, readId: "different" },
      page: older,
      older: true,
    }),
  ).toBeNull();
});
