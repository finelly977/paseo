import { expect, test } from "vitest";
import type { NativeHistoryProcessItem, StreamItem } from "@/types/stream";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import {
  hydrateNativeHistoryDetails,
  nativeHistoryInterruptedReply,
  presentNativeHistoryActiveTurn,
  presentNativeHistoryProcesses,
} from "./native-history-presentation";
import { nativeHistoryItems } from "./native-history";
import { buildConversationHistoryIndex } from "@/agent-stream/history-index-model";
import {
  prepareToolCallHistory,
  projectToolCallDetailLevel,
} from "@/tool-calls/detail-level/projection";

test("后台过程里的用户记录即使标识不同，也不新增用户气泡或历史刻度", () => {
  const tail = nativeHistoryItems(
    {
      readId: "read",
      cursor: null,
      nextCursor: null,
      turns: [
        {
          id: "turn",
          status: "inProgress",
          startedAt: 1,
          durationMs: null,
          error: null,
          items: [{ type: "user_message", messageId: "summary-user", text: "继续" }],
        },
      ],
    },
    null,
  );
  const process = tail.find((item) => item.kind === "native_history_process");
  if (!process || process.kind !== "native_history_process") throw new Error("缺少原生回合");
  const shown = presentNativeHistoryActiveTurn({
    tail,
    head: [],
    process,
    activeTurnId: "turn",
    details: [
      { type: "user_message", messageId: "detail-user", text: "继续" },
      { type: "assistant_message", messageId: "reply", text: "正在处理" },
    ],
  });
  expect(
    buildConversationHistoryIndex([...shown.tail, ...shown.head]).map((entry) => entry.id),
  ).toEqual(["summary-user"]);
});

test("同一时刻的不同压缩拥有独立身份，历史过程收起后压缩线仍然可见", () => {
  const process: NativeHistoryProcessItem = {
    kind: "native_history_process",
    id: "process",
    turnId: "turn",
    status: "completed",
    timestamp: new Date(1000),
    durationMs: 4000,
    error: null,
    summaryMessageIds: [],
    summaryRevision: "r",
  };
  const items: AgentTimelineItem[] = [
    { type: "compaction", compactionId: "one", status: "completed" },
    { type: "compaction", compactionId: "two", status: "completed" },
  ];
  expect(new Set(hydrateNativeHistoryDetails(process, items).map((item) => item.id)).size).toBe(2);
  const detailsByTurn = new Map([
    [
      "turn",
      {
        serverId: "host",
        agentId: "agent",
        turnId: "turn",
        revision: "r",
        items,
        nextCursor: null,
        complete: true,
        loading: false,
        error: null,
      },
    ],
  ]);
  const closed = presentNativeHistoryProcesses({
    tail: [process],
    expandedTurnIds: new Set(),
    detailsByTurn,
  });
  const opened = presentNativeHistoryProcesses({
    tail: [process],
    expandedTurnIds: new Set(["turn"]),
    detailsByTurn,
  });
  expect(closed.filter((item) => item.kind === "compaction").map((item) => item.id)).toEqual(
    opened.filter((item) => item.kind === "compaction").map((item) => item.id),
  );
  expect(closed.filter((item) => item.kind === "compaction")).toHaveLength(2);
});

test("当前轮后台补载同一次压缩时只显示一个标记，保留两次不同压缩", () => {
  const process: NativeHistoryProcessItem = {
    kind: "native_history_process",
    id: "process",
    turnId: "native-turn",
    status: "inProgress",
    timestamp: new Date(1000),
    durationMs: null,
    error: null,
    summaryMessageIds: [],
    summaryRevision: "summary",
  };
  const details: AgentTimelineItem[] = [
    { type: "compaction", compactionId: "first", status: "completed" },
    { type: "compaction", compactionId: "second", status: "completed" },
  ];
  const live = hydrateNativeHistoryDetails(process, details);
  for (const [index, entry] of live.entries()) {
    entry.id = `live:${index}`;
    entry.turnId = "live-turn";
  }
  const shown = presentNativeHistoryActiveTurn({
    tail: [process],
    head: live,
    process,
    details,
    activeTurnId: "live-turn",
  });
  expect([...shown.tail, ...shown.head].filter((entry) => entry.kind === "compaction")).toEqual(
    live,
  );
  const old = Object.assign({}, live[0], { id: "old", turnId: "older-turn" });
  const native = Object.assign({}, live[0], {
    id: "native-summary",
    turnId: "native-turn",
    nativeTurnId: "native-turn",
  });
  const mixed = presentNativeHistoryActiveTurn({
    tail: [old, process, native],
    head: live,
    process,
    details,
    activeTurnId: "live-turn",
  });
  expect([...mixed.tail, ...mixed.head]).toEqual([old, ...live]);
  const loading = hydrateNativeHistoryDetails(process, [
    { type: "compaction", compactionId: "first", status: "loading" },
  ]);
  const completed = presentNativeHistoryActiveTurn({
    tail: [process],
    head: loading,
    process,
    details: [details[0]],
    activeTurnId: "native-turn",
  });
  expect([...completed.tail, ...completed.head]).toMatchObject([
    { kind: "compaction", compactionId: "first", status: "completed", id: loading[0].id },
  ]);
});

test("展开历史过程后文字和命令进入外层流，每段命令保留独立可折叠分组", () => {
  const process: NativeHistoryProcessItem = {
    kind: "native_history_process",
    id: "native-process:done",
    turnId: "done",
    status: "completed",
    timestamp: new Date(1000),
    durationMs: 128000,
    error: null,
    summaryMessageIds: ["question", "final"],
    summaryRevision: "summary",
  };
  const command = (id: string): AgentTimelineItem => ({
    type: "tool_call",
    callId: id,
    name: "Shell",
    status: "completed",
    error: null,
    detail: { type: "shell", command: id, exitCode: 0 },
  });
  const items: AgentTimelineItem[] = [
    { type: "user_message", messageId: "question", text: "问题" },
    { type: "assistant_message", messageId: "comment-one", text: "第一段说明" },
    command("one"),
    command("two"),
    { type: "assistant_message", messageId: "comment-two", text: "第二段说明" },
    command("three"),
    { type: "assistant_message", messageId: "final", text: "最终回复" },
  ];
  const tail: StreamItem[] = [
    process,
    {
      kind: "assistant_message",
      id: "final",
      messageId: "final",
      text: "最终回复",
      timestamp: new Date(129000),
    },
  ];
  const detailsByTurn = new Map([
    [
      "done",
      {
        serverId: "host",
        agentId: "agent",
        turnId: "done",
        revision: "summary",
        items,
        nextCursor: null,
        complete: true,
        loading: false,
        error: null,
      },
    ],
  ]);
  expect(presentNativeHistoryProcesses({ tail, expandedTurnIds: new Set(), detailsByTurn })).toBe(
    tail,
  );
  const expanded = presentNativeHistoryProcesses({
    tail,
    expandedTurnIds: new Set(["done"]),
    detailsByTurn,
  });
  const grouped = projectToolCallDetailLevel({
    level: "overview",
    tail: expanded,
    head: [],
    preparedHistory: prepareToolCallHistory("overview", expanded),
    isTurnActive: false,
  });
  expect(grouped.groupsByHostId.size).toBe(2);
  expect(
    grouped.tail.filter((row) => row.kind === "assistant_message").map((row) => row.text),
  ).toEqual(["第一段说明", "第二段说明", "最终回复"]);
  expect(
    grouped.tail
      .filter((row) => row.kind === "tool_call")
      .map((row) => grouped.groupsByHostId.get(row.id)?.run.calls.length),
  ).toEqual([2, 1]);
  expect(presentNativeHistoryProcesses({ tail, expandedTurnIds: new Set(), detailsByTurn })).toBe(
    tail,
  );
});

test("当前轮与旧轮复用调用标识时，不误删当前工具或覆盖旧历史", () => {
  const process = {
    kind: "native_history_process" as const,
    id: "current-process",
    turnId: "current",
    status: "inProgress" as const,
    timestamp: new Date(2000),
    durationMs: null,
    error: null,
    summaryMessageIds: [],
    summaryRevision: "summary",
  };
  const tool: AgentTimelineItem = {
    type: "tool_call",
    callId: "reused",
    name: "Shell",
    status: "running",
    error: null,
    detail: { type: "shell", command: "新的命令" },
  };
  const older = nativeHistoryItems(
    {
      readId: "read",
      cursor: null,
      nextCursor: null,
      turns: [
        {
          id: "old",
          status: "completed",
          startedAt: 1,
          durationMs: 100,
          error: null,
          items: [{ ...tool, status: "completed" }],
        },
      ],
    },
    null,
  );
  const shown = presentNativeHistoryActiveTurn({
    tail: [...older, process],
    head: [],
    process,
    details: [tool],
    activeTurnId: "current",
  });
  expect(
    shown.tail.filter((entry) => entry.kind === "tool_call").map((entry) => entry.turnId),
  ).toEqual(["old", "current"]);
  expect(new Set(shown.tail.map((entry) => entry.id)).size).toBe(shown.tail.length);
});

test("中断或失败后恢复最后一段真实说明，正常回合及已显示的回复不重复", () => {
  const item: NativeHistoryProcessItem = {
    kind: "native_history_process",
    id: "process",
    turnId: "turn",
    status: "interrupted",
    durationMs: 7000,
    error: null,
    timestamp: new Date(1000),
    summaryMessageIds: ["q"],
    summaryRevision: "original",
  };
  const details: AgentTimelineItem[] = [
    { type: "assistant_message", messageId: "first", text: "开始检查" },
    { type: "assistant_message", messageId: "last", text: "停止前已经定位到问题" },
  ];
  expect(nativeHistoryInterruptedReply(item, details)).toMatchObject([
    { kind: "assistant_message", id: "last", text: "停止前已经定位到问题", timestampUnknown: true },
  ]);
  expect(nativeHistoryInterruptedReply({ ...item, status: "failed" }, details)).toHaveLength(1);
  expect(nativeHistoryInterruptedReply({ ...item, status: "completed" }, details)).toEqual([]);
  expect(
    nativeHistoryInterruptedReply({ ...item, summaryMessageIds: ["q", "last"] }, details),
  ).toEqual([]);
});

test("正在运行的原生回合直接展示正文和工具，不显示历史处理入口或重复实时段落", () => {
  const tail = nativeHistoryItems(
    {
      readId: "read",
      cursor: null,
      nextCursor: null,
      turns: [
        {
          id: "native-turn",
          status: "inProgress",
          startedAt: 1,
          durationMs: null,
          error: null,
          items: [{ type: "user_message", messageId: "question", text: "测试问题" }],
        },
      ],
    },
    null,
  );
  const process = tail.find((entry) => entry.kind === "native_history_process");
  if (!process || process.kind !== "native_history_process") throw new Error("缺少原生读取元数据");
  const head = [
    {
      kind: "assistant_message" as const,
      id: "live",
      messageId: "comment",
      turnId: "live-turn",
      text: "我先检查这个问题。\n\n正在继续。",
      timestamp: new Date(2000),
    },
  ];
  const details: AgentTimelineItem[] = [
    { type: "user_message", messageId: "question", text: "测试问题" },
    { type: "assistant_message", messageId: "comment", text: "我先检查这个问题。" },
    {
      type: "tool_call",
      callId: "shell",
      name: "Shell",
      status: "completed",
      error: null,
      detail: { type: "shell", command: "git status", output: "", exitCode: 0 },
    },
  ];
  const shown = presentNativeHistoryActiveTurn({
    tail,
    head,
    process,
    details,
    activeTurnId: "live-turn",
  });
  expect([...shown.tail, ...shown.head].map((entry) => entry.kind)).toEqual([
    "user_message",
    "assistant_message",
    "tool_call",
  ]);
  expect(shown.head[0]).toBe(head[0]);
  expect(shown.head[1].turnId).toBe("live-turn");
});

test("原生当前轮详情尚未返回时也不出现“处理中”折叠区，已结束的历史入口继续保留", () => {
  const current = {
    kind: "native_history_process" as const,
    id: "process",
    turnId: "turn",
    status: "inProgress" as const,
    durationMs: null,
    error: null,
    timestamp: new Date(1000),
    summaryMessageIds: [],
    summaryRevision: "summary",
  };
  const older = { ...current, id: "old-process", turnId: "old", status: "completed" as const };
  expect(
    presentNativeHistoryActiveTurn({
      tail: [older, current],
      head: [],
      process: current,
      details: [],
      activeTurnId: null,
    }).tail,
  ).toEqual([older]);
});

test("活动快照只补缺失前缀，实时段落继续增长时复用未变化的历史行", () => {
  const process = {
    kind: "native_history_process" as const,
    id: "process",
    turnId: "turn",
    status: "inProgress" as const,
    timestamp: new Date(1000),
    durationMs: null,
    error: null,
    summaryMessageIds: [],
    summaryRevision: "summary",
  };
  const tail = [process];
  const live = {
    kind: "assistant_message" as const,
    id: "live",
    messageId: "message",
    turnId: "turn",
    text: "已收到的后半句。",
    timestamp: new Date(2000),
  };
  const details: AgentTimelineItem[] = [
    { type: "assistant_message", messageId: "message", text: "之前缺少的前半句。已收到的后半句。" },
  ];
  const first = presentNativeHistoryActiveTurn({
    tail,
    head: [live],
    process,
    details,
    activeTurnId: "turn",
  });
  expect(first.head[0]).toMatchObject({ text: "之前缺少的前半句。已收到的后半句。" });
  const tool: AgentTimelineItem = {
    type: "tool_call",
    callId: "tool",
    name: "Shell",
    status: "completed",
    error: null,
    detail: { type: "shell", command: "git status" },
  };
  const cached = [tool];
  const one = presentNativeHistoryActiveTurn({
    tail,
    head: [live],
    process,
    details: cached,
    activeTurnId: "turn",
  });
  const two = presentNativeHistoryActiveTurn({
    tail,
    head: [{ ...live, text: "新的实时文字" }],
    process,
    details: cached,
    activeTurnId: "turn",
  });
  expect(two.tail).toBe(one.tail);
});

test("活动摘要与实时区包含同一条回复时只保留实时版本", () => {
  const items = nativeHistoryItems(
    {
      readId: "read",
      cursor: null,
      nextCursor: null,
      turns: [
        {
          id: "turn",
          status: "inProgress",
          startedAt: 1,
          durationMs: null,
          error: null,
          items: [{ type: "assistant_message", messageId: "message", text: "旧摘要" }],
        },
      ],
    },
    null,
  );
  const process = items.find((entry) => entry.kind === "native_history_process");
  if (!process || process.kind !== "native_history_process") throw new Error("缺少元数据");
  const head = [
    {
      kind: "assistant_message" as const,
      id: "live",
      messageId: "message",
      turnId: "turn",
      text: "最新实时内容",
      timestamp: new Date(2000),
    },
  ];
  const result = presentNativeHistoryActiveTurn({
    tail: items,
    head,
    process,
    details: [],
    activeTurnId: "turn",
  });
  expect(result.tail).toEqual([]);
  expect(result.head).toEqual(head);
});
