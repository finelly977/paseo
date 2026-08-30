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
  it("按当前语言显示完整的处理耗时", () => {
    expect(formatCompletedTurnDuration(128_000, "zh-CN")).toBe("2分钟8秒");
    expect(formatCompletedTurnDuration(128_000, "en")).toBe("2 min 8 sec");
  });

  it("最终回复由多个分块组成时使用首个分块判断是否复用 Markdown 横线", () => {
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
      visibleItems: [conclusion, divider, process],
    });

    expect(model.toggleByItemId.get(process.id)).toEqual({
      turnId: conclusion.id,
      durationMs: 7_000,
      isFollowedByDivider: true,
    });
  });

  it("最终回复不以横线开头时保留收起入口自己的分界线", () => {
    const process = processItem("process");
    const conclusion = assistantBlock({
      id: "answer",
      text: "最终结论",
      blockGroupId: "answer",
      blockIndex: 0,
      seconds: 8,
    });
    const host: TurnFooterHost = {
      itemId: conclusion.id,
      items: [process, conclusion],
      timing: undefined,
      startIndex: 1,
      processItemIds: [process.id],
    };

    const model = buildCompletedTurnProcessModel({
      hosts: [host],
      visibleItems: [process, conclusion],
    });

    expect(model.toggleByItemId.get(process.id)).toEqual({
      turnId: conclusion.id,
      durationMs: undefined,
      isFollowedByDivider: false,
    });
  });
});
