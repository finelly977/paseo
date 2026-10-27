import { describe, expect, it } from "vitest";
import type { AgentStreamEventPayload } from "@getpaseo/protocol/messages";
import { selectProjectedTimelinePage } from "../../../server/src/server/agent/timeline-projection";
import type { AgentTimelineRow } from "../../../server/src/server/agent/agent-timeline-store-types";
import { applyStreamEvent, type StreamItem } from "@/types/stream";
import { processTimelineResponse } from "./session-stream-reducers";

describe("运行中生命周期分页同步", () => {
  it("补载覆盖已完成压缩的开始记录时，不留下旧加载标记", () => {
    const rows: AgentTimelineRow[] = [
      {
        seq: 1,
        turnId: "turn",
        timestamp: new Date(1).toISOString(),
        item: { type: "compaction", status: "loading" },
      },
      {
        seq: 2,
        turnId: "turn",
        timestamp: new Date(2).toISOString(),
        item: { type: "assistant_message", text: "继续回复" },
      },
      {
        seq: 3,
        turnId: "turn",
        timestamp: new Date(3).toISOString(),
        item: { type: "compaction", status: "completed" },
      },
    ];
    const current = applyStreamEvent({
      tail: [],
      head: [],
      timestamp: new Date(1),
      timelineCursor: { epoch: "e", seq: 1 },
      event: { type: "timeline", provider: "codex", turnId: "turn", item: rows[0].item },
    });
    const page = selectProjectedTimelinePage({
      rows,
      direction: "before",
      cursorSeq: 2,
      limit: 10,
    });
    const result = processTimelineResponse({
      currentTail: current.tail,
      currentHead: [],
      currentCursor: { epoch: "e", startSeq: 2, endSeq: 2 },
      isInitializing: false,
      hasActiveInitDeferred: false,
      initRequestDirection: "tail",
      payload: {
        agentId: "agent",
        direction: "before",
        projection: "projected",
        reset: false,
        epoch: "e",
        startCursor: page.startSeq === null ? null : { seq: page.startSeq },
        endCursor: page.endSeq === null ? null : { seq: page.endSeq },
        entries: page.entries.map((entry) => ({ ...entry, provider: "codex" })),
        error: null,
        hasNewer: page.hasNewer,
        hasOlder: page.hasOlder,
      },
    });
    expect(result.tail.filter((item) => item.kind === "compaction")).toEqual([
      expect.objectContaining({ status: "completed" }),
    ]);
  });

  it("同一活动回合多命令乱序结束，真正异步命令保留运行态", () => {
    let tail: StreamItem[] = [];
    let head: StreamItem[] = [];
    const events: AgentStreamEventPayload[] = [];
    for (let index = 0; index < 80; index++)
      events.push({
        type: "timeline",
        provider: "codex",
        turnId: "active",
        item: {
          type: "tool_call",
          callId: `exec-${index}`,
          name: "shell",
          status: "running",
          error: null,
          detail: { type: "shell", command: `cmd ${index}` },
        },
      });
    for (let index = 79; index >= 1; index--)
      events.push({
        type: "timeline",
        provider: "codex",
        turnId: "active",
        item: {
          type: "tool_call",
          callId: `exec-${index}`,
          name: "shell",
          status: "completed",
          error: null,
          detail: {
            type: "shell",
            command: `cmd ${index}`,
            output: `result ${index}`,
            exitCode: 0,
          },
        },
      });
    for (const [index, event] of events.entries()) {
      const next = applyStreamEvent({
        tail,
        head,
        event,
        timestamp: new Date(index),
        timelineCursor: { epoch: "e", seq: index + 1 },
      });
      tail = next.tail;
      head = next.head;
    }
    expect(
      tail
        .filter((item) => item.kind === "tool_call" && item.payload.data.status === "running")
        .map((item) => item.id),
    ).toEqual(["agent_tool_exec-0"]);
    expect(
      tail.filter((item) => item.kind === "tool_call" && item.payload.data.status === "completed"),
    ).toHaveLength(79);
    expect(tail).toHaveLength(80);
  });
});
