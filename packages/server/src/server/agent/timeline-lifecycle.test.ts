import { describe, expect, test } from "vitest";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { projectTimelineRows } from "./timeline-projection.js";

describe("历史生命周期投影", () => {
  test("两个明确不同回合中的同名调用保持隔离，后续结束能找到第二轮", () => {
    const rows: AgentTimelineRow[] = ["first", "second", "second"].map((turnId, index) => ({
      seq: index + 1,
      turnId,
      timestamp: new Date(index).toISOString(),
      item: {
        type: "tool_call",
        callId: "reused",
        name: "shell",
        status: index === 2 ? "completed" : "running",
        error: null,
        detail: { type: "shell", command: "echo done" },
      },
    }));
    const entries = projectTimelineRows({ rows, mode: "projected" });
    expect(
      entries.map((entry) => ({
        turnId: entry.turnId,
        status: entry.item.type === "tool_call" ? entry.item.status : null,
      })),
    ).toEqual([
      { turnId: "first", status: "running" },
      { turnId: "second", status: "completed" },
    ]);
  });
  test("原生历史缺少回合标识时合并同一命令，不保留独立旧运行态", () => {
    const command = {
      type: "tool_call",
      callId: "exec-native-id",
      name: "shell",
      status: "completed",
      error: null,
      detail: { type: "shell", command: "echo done", output: "done", exitCode: 0 },
    } satisfies AgentTimelineRow["item"];
    const rows: AgentTimelineRow[] = [
      { seq: 1, timestamp: new Date(0).toISOString(), item: command },
      {
        seq: 2,
        turnId: "live",
        timestamp: new Date(1).toISOString(),
        item: {
          ...command,
          status: "running",
          detail: { type: "shell", command: "echo done" },
        },
      },
      { seq: 3, turnId: "live", timestamp: new Date(2).toISOString(), item: command },
    ];
    const entries = projectTimelineRows({ rows, mode: "projected" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ turnId: "live", seqStart: 1, seqEnd: 3, item: command });
  });

  test("压缩开始和结束跨越正文时仍是一条权威状态", () => {
    const rows: AgentTimelineRow[] = [
      {
        seq: 1,
        turnId: "live",
        timestamp: new Date(0).toISOString(),
        item: { type: "compaction", status: "loading" },
      },
      {
        seq: 2,
        turnId: "live",
        timestamp: new Date(1).toISOString(),
        item: { type: "assistant_message", text: "继续回复" },
      },
      {
        seq: 3,
        turnId: "live",
        timestamp: new Date(2).toISOString(),
        item: { type: "compaction", status: "completed" },
      },
    ];
    const entries = projectTimelineRows({ rows, mode: "projected" });
    expect(entries.map((entry) => entry.item)).toEqual([
      { type: "compaction", status: "completed" },
      rows[1].item,
    ]);
    expect(entries[0].sourceSeqRanges).toEqual([
      { startSeq: 1, endSeq: 1 },
      { startSeq: 3, endSeq: 3 },
    ]);
  });
});
