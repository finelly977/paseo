import { expect, test } from "vitest";
import { rebaseHistoryPreview } from "./history-preview-rebase";
import type { StreamItem } from "@/types/stream";
import type { AgentConversationIndexEntry } from "@/stores/session-store";

function world() {
  const items: StreamItem[] = [
    {
      kind: "user_message",
      id: "stable-q",
      text: "原生最新问题",
      timestamp: new Date(0),
      timelineCursor: { epoch: "preview", seq: 1 },
    },
    {
      kind: "assistant_message",
      id: "stable-a",
      text: "原生最新回复",
      timestamp: new Date(0),
      timelineCursor: { epoch: "preview", seq: 2 },
    },
  ];
  const state = {
    agentTimelineCursor: new Map([["agent", { epoch: "preview", startSeq: 1, endSeq: 2 }]]),
    agentTimelineHasOlder: new Map([["agent", false]]),
    agentStreamTail: new Map([["agent", items]]),
    agentStreamHead: new Map<string, StreamItem[]>(),
    agentConversationIndex: new Map<string, AgentConversationIndexEntry[]>([
      [
        "agent",
        [
          {
            messageId: "q",
            clientMessageId: null,
            text: "原生最新问题",
            assistantPreview: "",
            timestamp: new Date(0).toISOString(),
            seqStart: 1,
          },
        ],
      ],
    ]),
    agentConversationIndexVersion: new Map([["agent", "old-version"]]),
    releasedAgentIds: new Set<string>(),
  };
  const rebase = {
    previousEpoch: "preview",
    minSeq: 1,
    positions: [
      { previousSeq: 1, seq: 101 },
      { previousSeq: 2, seq: 102 },
    ],
  };
  return { state, rebase, items };
}

test("后台补齐只校准位置，保留原生首屏的行身份、正文及阅读窗口", () => {
  const { state, rebase, items } = world();
  const result = rebaseHistoryPreview(state, "agent", "complete", rebase);
  expect(result?.agentStreamTail.get("agent")).toEqual([
    { ...items[0], timelineCursor: { epoch: "complete", seq: 101 } },
    { ...items[1], timelineCursor: { epoch: "complete", seq: 102 } },
  ]);
  expect(result?.agentTimelineCursor.get("agent")).toEqual({
    epoch: "complete",
    startSeq: 101,
    endSeq: 102,
  });
  expect(result?.agentConversationIndex.get("agent")?.map((entry) => entry.seqStart)).toEqual([
    101,
  ]);
  expect(result?.agentConversationIndexVersion.has("agent")).toBe(false);
  expect(result?.agentTimelineHasOlder.get("agent")).toBe(true);
  expect(state.agentTimelineCursor.get("agent")?.epoch).toBe("preview");
});

test("原生首屏已经覆盖全部历史时，补齐后不再提供更早页", () => {
  const { state, rebase } = world();
  const result = rebaseHistoryPreview(state, "agent", "complete", { ...rebase, minSeq: 101 });
  expect(result?.agentTimelineHasOlder.get("agent")).toBe(false);
});

test("迟到补齐不能恢复已释放会话，也不能覆盖已经替换的代际", () => {
  const { state, rebase } = world();
  state.releasedAgentIds.add("agent");
  expect(rebaseHistoryPreview(state, "agent", "complete", rebase)).toBeNull();
  state.releasedAgentIds.clear();
  state.agentTimelineCursor.set("agent", { epoch: "newer", startSeq: 1, endSeq: 2 });
  expect(rebaseHistoryPreview(state, "agent", "complete", rebase)).toBeNull();
});
