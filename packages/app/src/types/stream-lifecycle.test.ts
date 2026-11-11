import { describe, expect, it } from "vitest";
import type { AgentStreamEventPayload } from "@getpaseo/protocol/messages";
import { applyStreamEvent, reduceStreamUpdate, type StreamItem } from "./stream";

function command(
  callId: string,
  status: "running" | "completed",
  turnId: string,
): AgentStreamEventPayload {
  return {
    type: "timeline",
    provider: "codex",
    turnId,
    item: {
      type: "tool_call",
      callId,
      name: "shell",
      status,
      error: null,
      detail: {
        type: "shell",
        command: callId,
        ...(status === "completed" ? { exitCode: 0, output: "done" } : {}),
      },
    },
  };
}

function compaction(
  status: "loading" | "completed",
): Extract<AgentStreamEventPayload, { type: "timeline" }> {
  return {
    type: "timeline",
    provider: "codex",
    turnId: "compact-turn",
    item: { type: "compaction", status },
  };
}

describe("运行中操作的权威结束状态", () => {
  it("同次压缩的重复开始、完成和迟到快照只更新原行，不合并另一压缩", () => {
    let tail: StreamItem[] = [];
    let head: StreamItem[] = [];
    const changes = [
      ["first", "loading"],
      ["first", "completed"],
      ["first", "completed"],
      ["first", "loading"],
      ["second", "loading"],
      ["second", "completed"],
    ] as const;
    for (const [index, [compactionId, status]] of changes.entries()) {
      const next = applyStreamEvent({
        tail,
        head,
        timestamp: new Date(index),
        timelineCursor: { epoch: "e", seq: index + 1 },
        event: {
          type: "timeline",
          provider: "codex",
          turnId: "turn",
          item: { type: "compaction", compactionId, status },
        },
      });
      tail = next.tail;
      head = next.head;
    }
    expect([...tail, ...head]).toMatchObject([
      {
        kind: "compaction",
        compactionId: "first",
        status: "completed",
        timelineCursor: { seq: 4 },
      },
      {
        kind: "compaction",
        compactionId: "second",
        status: "completed",
        timelineCursor: { seq: 6 },
      },
    ]);
  });
  it("另一回合的压缩完成不会结束当前压缩", () => {
    const current = reduceStreamUpdate([], compaction("loading"), new Date(0));
    const ended = reduceStreamUpdate(
      current,
      { ...compaction("completed"), turnId: "other-turn" },
      new Date(1),
    );
    expect(
      ended
        .filter((item) => item.kind === "compaction")
        .map((item) => ({ turnId: item.turnId, status: item.status })),
    ).toEqual([
      { turnId: "compact-turn", status: "loading" },
      { turnId: "other-turn", status: "completed" },
    ]);
  });
  it("交错命令的结束只更新对应调用的状态、回合与游标", () => {
    let state: StreamItem[] = [];
    for (const [index, event] of [
      command("async", "running", "first"),
      command("quick", "running", "second"),
      command("async", "completed", "first"),
    ].entries()) {
      state = reduceStreamUpdate(state, event, new Date(index), {
        timelineCursor: { epoch: "e", seq: index + 1 },
      });
    }
    expect(state).toEqual([
      expect.objectContaining({
        turnId: "first",
        timelineCursor: { epoch: "e", seq: 3 },
        payload: expect.objectContaining({
          data: expect.objectContaining({ callId: "async", status: "completed" }),
        }),
      }),
      expect.objectContaining({
        turnId: "second",
        timelineCursor: { epoch: "e", seq: 2 },
        payload: expect.objectContaining({
          data: expect.objectContaining({ callId: "quick", status: "running" }),
        }),
      }),
    ]);
  });

  it("压缩结束更新原条目的同步位置，不改写之后回复的回合", () => {
    const started = reduceStreamUpdate([], compaction("loading"), new Date(0), {
      timelineCursor: { epoch: "e", seq: 1 },
    });
    const answer = reduceStreamUpdate(
      started,
      {
        type: "timeline",
        provider: "codex",
        turnId: "answer-turn",
        item: { type: "assistant_message", text: "继续回复", messageId: "answer" },
      },
      new Date(1),
      { timelineCursor: { epoch: "e", seq: 2 } },
    );
    const ended = reduceStreamUpdate(answer, compaction("completed"), new Date(2), {
      timelineCursor: { epoch: "e", seq: 3 },
    });
    expect(ended[0]).toMatchObject({
      kind: "compaction",
      status: "completed",
      turnId: "compact-turn",
      timelineCursor: { epoch: "e", seq: 3 },
    });
    expect(ended[1].turnId).toBe("answer-turn");
  });
});
