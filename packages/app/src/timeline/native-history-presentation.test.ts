import { expect, test } from "vitest";
import type { NativeHistoryProcessItem } from "@/types/stream";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { nativeHistoryInterruptedReply } from "./native-history-presentation";

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
