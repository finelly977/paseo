import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import type { TurnFooterHost } from "./layout";
import {
  buildCompletedTurnProcessModel,
  formatCompletedTurnDuration,
} from "./completed-turn-process";

const timestamp = (seconds: number) =>
  new Date(`2026-08-30T00:00:${String(seconds).padStart(2, "0")}Z`);

function assistantBlock(input: {
  id: string;
  text: string;
  blockGroupId: string;
  blockIndex: number;
  seconds: number;
}): Extract<StreamItem, { kind: "assistant_message" }> {
  return {
    kind: "assistant_message",
    id: input.id,
    text: input.text,
    timestamp: timestamp(input.seconds),
    blockGroupId: input.blockGroupId,
    blockIndex: input.blockIndex,
  };
}

function processItem(id: string): StreamItem {
  return {
    kind: "thought",
    id,
    text: "处理中",
    timestamp: timestamp(2),
    status: "ready",
  };
}

describe("完成回合过程收起展示", () => {
  it.each(["loading", "completed"] as const)(
    "普通时间线的 %s 压缩只在完成后纳入用时过程",
    (status) => {
      const compaction: StreamItem = {
        kind: "compaction",
        id: "compact",
        status,
        timestamp: timestamp(2),
      };
      const answer = assistantBlock({
        id: "answer",
        text: "最终结论",
        blockGroupId: "answer",
        blockIndex: 0,
        seconds: 8,
      });
      const items = [compaction, answer];
      const host: TurnFooterHost = {
        kind: "assistant",
        itemId: answer.id,
        items,
        startIndex: 1,
        processItemIds: [compaction.id],
      };
      const model = buildCompletedTurnProcessModel({ hosts: [host], chronologicalItems: items });
      expect(model.turnIdByProcessItemId.has("compact")).toBe(status === "completed");
      expect([...model.toggleByItemId.keys()]).toEqual(status === "completed" ? ["compact"] : []);
    },
  );
  it("耗时使用统一的英文短单位，不把未知耗时当作零", () => {
    expect(formatCompletedTurnDuration(128_000)).toBe("2m 8s");
    expect(formatCompletedTurnDuration(6_692_000)).toBe("1h 51m");
    expect(formatCompletedTurnDuration(32_000)).toBe("32s");
    expect(formatCompletedTurnDuration(0)).toBe("0s");
  });

  it("最终回复由多个分块组成时入口仍位于最早过程之前", () => {
    const process = processItem("process");
    const divider = assistantBlock({
      id: "answer-divider",
      text: "---",
      blockGroupId: "answer",
      blockIndex: 0,
      seconds: 7,
    });
    const conclusion = assistantBlock({
      id: "answer-conclusion",
      text: "最终结论",
      blockGroupId: "answer",
      blockIndex: 1,
      seconds: 8,
    });
    const host: TurnFooterHost = {
      kind: "assistant",
      itemId: conclusion.id,
      items: [process, divider, conclusion],
      timing: {
        startedAt: timestamp(1),
        completedAt: timestamp(8),
        durationMs: 7_000,
      },
      startIndex: 2,
      processItemIds: [process.id],
    };

    const model = buildCompletedTurnProcessModel({
      hosts: [host],
      chronologicalItems: [process, divider, conclusion],
    });

    expect(model.toggleByItemId.get(process.id)).toEqual({
      turnId: conclusion.id,
      durationMs: 7_000,
    });
  });

  it("入口保留真实耗时与回合身份", () => {
    const process = processItem("process");
    const conclusion = assistantBlock({
      id: "answer",
      text: "最终结论",
      blockGroupId: "answer",
      blockIndex: 0,
      seconds: 8,
    });
    const host: TurnFooterHost = {
      kind: "assistant",
      itemId: conclusion.id,
      items: [process, conclusion],
      timing: undefined,
      startIndex: 1,
      processItemIds: [process.id],
    };

    const model = buildCompletedTurnProcessModel({
      hosts: [host],
      chronologicalItems: [process, conclusion],
    });

    expect(model.toggleByItemId.get(process.id)).toEqual({
      turnId: conclusion.id,
      durationMs: undefined,
    });
  });

  it("同一最终回复分块横跨工具记录时，入口挂在最早的正文块且不隐藏正文", () => {
    const introduction = assistantBlock({
      id: "intro",
      text: "我会完成这项修改。",
      blockGroupId: "answer",
      blockIndex: 0,
      seconds: 1,
    });
    const tool = processItem("tool");
    const answer = assistantBlock({
      id: "final",
      text: "修改已完成。",
      blockGroupId: "answer",
      blockIndex: 1,
      seconds: 3,
    });
    const host: TurnFooterHost = {
      kind: "assistant",
      itemId: answer.id,
      items: [introduction, tool, answer],
      startIndex: 2,
      processItemIds: [tool.id],
    };
    const model = buildCompletedTurnProcessModel({
      hosts: [host],
      chronologicalItems: [introduction, tool, answer],
    });
    expect([...model.toggleByItemId.keys()]).toEqual([introduction.id]);
    expect([...model.turnIdByProcessItemId.keys()]).toEqual([tool.id]);
  });
});
