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
import {
  acceptMessageSubmission,
  beginMessageSubmission,
  observeMessageSubmissionCanonical,
} from "@/composer/submission/model";
import { nativeHistoryDetailRevision } from "./native-history-details";

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

test("运行中的压缩不被滞后的完成摘要清掉，明确结束当前回合后才归入历史", () => {
  const compact: StreamItem = {
    kind: "compaction",
    id: "compact",
    compactionId: "compress",
    turnId: "live-turn",
    timestamp: new Date(3000),
    status: "loading",
  };
  const items = mergeNativeHistoryPage([], page, false, null);
  const pending = planNativeHistoryPage({
    items: [...items, compact],
    previous: { readId: "thread", firstTurnId: "turn", nextCursor: "older" },
    page,
    older: false,
    activeTurnId: "live-turn",
  });
  expect(pending?.tail.filter((item) => item.kind === "compaction")).toEqual([compact]);
  const finished = retainNativeHistoryLiveItems(
    [...items, compact],
    { ...page, turns: [{ ...page.turns[0], id: "live-turn" }] },
    undefined,
    null,
  );
  expect(finished.filter((item) => item.kind === "compaction")).toEqual([]);
});

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

test("首屏原生页到达时保留尚未确认的新输入，页面没有重叠也不能丢草稿消息", () => {
  const pending: StreamItem = {
    kind: "user_message",
    id: "client-pending",
    clientMessageId: "client-pending",
    text: "刚刚提交的新问题",
    timestamp: new Date(10000),
    optimistic: true,
  };
  const result = planNativeHistoryPage({
    items: [pending],
    previous: undefined,
    page,
    older: false,
  });
  expect(result?.tail.at(-1)).toBe(pending);
});

test.each(["completed", "interrupted", "inProgress"] as const)(
  "原生 %s 回合按客户端提交身份核对，不重复显示乐观用户卡片",
  (status) => {
    const confirmed: NativeHistoryPage = {
      ...page,
      turns: [
        {
          ...page.turns[0],
          status,
          items: [
            {
              type: "user_message",
              messageId: "native-q",
              clientMessageId: "client-q",
              text: "原生确认的问题",
            },
          ],
        },
      ],
    };
    const pending: StreamItem = {
      kind: "user_message",
      id: "client-q",
      clientMessageId: "client-q",
      text: "原生确认的问题",
      timestamp: new Date(1000),
      optimistic: true,
    };
    expect(retainNativeHistoryLiveItems([pending], confirmed)).toEqual([]);
    const result = planNativeHistoryPage({
      items: [pending],
      previous: undefined,
      page: confirmed,
      older: false,
    });
    expect(result?.tail.filter((item) => item.kind === "user_message")).toHaveLength(1);
  },
);

test("原生摘要接收活动区中的提交后保留本地图片，完成发送登记且采用被改写的新正文", () => {
  const image = {
    id: "image",
    mimeType: "image/png",
    storageType: "web-indexeddb" as const,
    storageKey: "image-key",
    createdAt: 1,
  };
  const pending: StreamItem = {
    kind: "user_message",
    id: "client-q",
    clientMessageId: "client-q",
    text: "带图问题",
    timestamp: new Date(1000),
    images: [image],
    optimistic: true,
  };
  const confirmed: NativeHistoryPage = {
    ...page,
    turns: [
      {
        ...page.turns[0],
        items: [
          {
            type: "user_message",
            messageId: "native-q",
            clientMessageId: "client-q",
            text: "带图问题",
            images: [{ path: "/host/同一张图片.png", mimeType: "image/png" }],
          },
        ],
      },
    ],
  };
  const result = planNativeHistoryPage({
    items: [],
    head: [pending],
    previous: undefined,
    page: confirmed,
    older: false,
  });
  if (!result) throw new Error("首屏原生页未应用");
  expect(result?.head).toEqual([]);
  expect(result?.tail[0]).toMatchObject({
    kind: "user_message",
    messageId: "native-q",
    images: [image],
  });
  if (result.tail[0].kind !== "user_message") throw new Error("缺少用户消息");
  expect(result.tail[0].providerImages).toBeUndefined();
  const refreshed = mergeNativeHistoryPage(result.tail, confirmed, false, null);
  if (refreshed[0].kind !== "user_message") throw new Error("缺少刷新后的用户消息");
  expect(refreshed[0].images).toEqual([image]);
  expect(refreshed[0].providerImages).toBeUndefined();
  const changedImagePage: NativeHistoryPage = {
    ...confirmed,
    turns: [
      {
        ...confirmed.turns[0],
        items: [
          {
            type: "user_message",
            messageId: "native-q",
            clientMessageId: "client-q",
            text: "带图问题",
            images: [{ path: "/host/另一张图片.png", mimeType: "image/png" }],
          },
        ],
      },
    ],
  };
  const changedImage = mergeNativeHistoryPage(refreshed, changedImagePage, false, null)[0];
  if (changedImage.kind !== "user_message") throw new Error("缺少换图后的用户消息");
  expect(changedImage.images).toBeUndefined();
  expect(changedImage.providerImages).toEqual([
    { path: "/host/另一张图片.png", mimeType: "image/png" },
  ]);
  expect(result?.acknowledgedClientMessageIds).toEqual(["client-q"]);
  const submissions = acceptMessageSubmission(
    beginMessageSubmission([], { clientMessageId: "client-q" }),
    "client-q",
  );
  expect(
    observeMessageSubmissionCanonical(submissions, result.acknowledgedClientMessageIds),
  ).toEqual([]);

  const originalUser = confirmed.turns[0].items[0];
  if (originalUser.type !== "user_message") throw new Error("缺少用户消息样本");
  confirmed.turns[0].items[0] = { ...originalUser, text: "另一客户端改写的新问题" };
  const edited = planNativeHistoryPage({
    items: result.tail,
    previous: result.nativeState,
    page: confirmed,
    older: false,
  });
  expect(edited?.tail[0]).toMatchObject({ text: "另一客户端改写的新问题" });
  if (!edited || edited.tail[0].kind !== "user_message") throw new Error("改写后的用户消息未应用");
  expect(edited.tail[0].images).toBeUndefined();
});

test("原生消息标识不变但正文或错误被客户端改写时，过程修订随内容变化", () => {
  const process = (value: NativeHistoryPage) => {
    const item = mergeNativeHistoryPage([], value, false, null).find(
      (entry) => entry.kind === "native_history_process",
    );
    if (!item || item.kind !== "native_history_process") throw new Error("缺少过程入口");
    return item;
  };
  const original = process(page);
  const edited: NativeHistoryPage = {
    ...page,
    turns: [
      {
        ...page.turns[0],
        items: [
          { type: "user_message", messageId: "q", text: "改写的问题" },
          { type: "assistant_message", messageId: "a", text: "改写的回复" },
        ],
      },
    ],
  };
  expect(nativeHistoryDetailRevision(process(edited))).not.toBe(
    nativeHistoryDetailRevision(original),
  );
  const failed: NativeHistoryPage = {
    ...page,
    turns: [{ ...page.turns[0], error: "更新后的错误" }],
  };
  expect(nativeHistoryDetailRevision(process(failed))).not.toBe(
    nativeHistoryDetailRevision(original),
  );
  expect(nativeHistoryDetailRevision(process(structuredClone(page)))).toBe(
    nativeHistoryDetailRevision(original),
  );
});

test("外部回退移除已确认的实时旧尾部，但保留读取开始后收到的新事件与未确认输入", () => {
  const native = mergeNativeHistoryPage([], page, false, null);
  const deleted: StreamItem = {
    kind: "user_message",
    id: "deleted-q",
    messageId: "deleted-q",
    turnId: "deleted-turn",
    text: "已被另一客户端回退的问题",
    timestamp: new Date(6000),
    timelineCursor: { epoch: "epoch", seq: 10 },
  };
  const oldReply: StreamItem = {
    kind: "assistant_message",
    id: "deleted-answer",
    messageId: "deleted-answer",
    turnId: "deleted-turn",
    text: "已被回退的回复",
    timestamp: new Date(7000),
    timelineCursor: { epoch: "epoch", seq: 11 },
  };
  const pending: StreamItem = {
    kind: "user_message",
    id: "pending",
    clientMessageId: "pending",
    text: "尚在发送",
    optimistic: true,
    timestamp: new Date(8000),
  };
  const later: StreamItem = {
    kind: "user_message",
    id: "new-q",
    messageId: "new-q",
    text: "读取途中才到达的新消息",
    timestamp: new Date(9000),
    timelineCursor: { epoch: "epoch", seq: 12 },
  };
  const result = planNativeHistoryPage({
    items: [...native, deleted],
    head: [oldReply, pending, later],
    previous: { readId: "thread", firstTurnId: "turn", nextCursor: "older" },
    page,
    older: false,
    readCursor: { epoch: "epoch", endSeq: 11 },
  });
  expect(result?.tail.map((item) => item.id)).toEqual(native.map((item) => item.id));
  expect(result?.head).toEqual([pending, later]);
  const running = planNativeHistoryPage({
    items: [...native, deleted],
    head: [oldReply],
    previous: { readId: "thread", firstTurnId: "turn", nextCursor: "older" },
    page,
    older: false,
    readCursor: { epoch: "epoch", endSeq: 11 },
    activeTurnId: "deleted-turn",
  });
  expect(running?.tail.at(-1)).toBe(deleted);
  expect(running?.head).toEqual([oldReply]);
});

test("外部清空整个线程后，活动区不能残留旧回复，但保留快照请求之后的新回合", () => {
  const oldUser: StreamItem = {
    kind: "user_message",
    id: "old",
    messageId: "old",
    turnId: "old-turn",
    text: "旧问题",
    timestamp: new Date(1000),
    timelineCursor: { epoch: "epoch", seq: 1 },
  };
  const oldReply: StreamItem = {
    kind: "assistant_message",
    id: "old-a",
    messageId: "old-a",
    turnId: "old-turn",
    text: "旧回复",
    timestamp: new Date(2000),
    timelineCursor: { epoch: "epoch", seq: 2 },
  };
  const incoming: StreamItem = {
    kind: "user_message",
    id: "new",
    messageId: "new",
    turnId: "new-turn",
    text: "新问题",
    timestamp: new Date(3000),
    timelineCursor: { epoch: "epoch", seq: 3 },
  };
  const emptied: NativeHistoryPage = { ...page, turns: [], nextCursor: null };
  const result = planNativeHistoryPage({
    items: [oldUser],
    head: [oldReply, incoming],
    previous: undefined,
    page: emptied,
    older: false,
    readCursor: { epoch: "epoch", endSeq: 2 },
  });
  expect(result?.tail).toEqual([]);
  expect(result?.head).toEqual([incoming]);
});

test("用户行已转为原生摘要后，独立活动区里的同轮旧过程也一并移除", () => {
  const native = mergeNativeHistoryPage([], page, false, null);
  const oldPartial: StreamItem = {
    kind: "assistant_message",
    id: "partial",
    messageId: "partial",
    text: "旧流式过程",
    turnId: "turn",
    timestamp: new Date(2000),
    timelineCursor: { epoch: "epoch", seq: 4 },
  };
  const result = planNativeHistoryPage({
    items: native,
    head: [oldPartial],
    previous: { readId: "thread", firstTurnId: "turn", nextCursor: "older" },
    page,
    older: false,
  });
  expect(result?.head).toEqual([]);
  expect(result?.tail.map((item) => item.id)).toEqual(native.map((item) => item.id));
});
