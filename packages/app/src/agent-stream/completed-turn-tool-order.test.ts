import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { placeCompletedTurnToolsBeforeFinalReply } from "./completed-turn-tool-order";

const at = (seconds: number) => new Date(seconds * 1_000);
const assistant = (id: string, text: string, turnId: string): StreamItem => ({
  kind: "assistant_message",
  id,
  messageId: id,
  text,
  timestamp: at(2),
  turnId,
});
const tool = (id: string, turnId: string): StreamItem => ({
  kind: "tool_call",
  id,
  timestamp: at(3),
  turnId,
  payload: {
    source: "agent",
    data: {
      provider: "codex",
      callId: id,
      name: "Shell",
      status: "completed",
      error: null,
      detail: { type: "shell", command: id },
    },
  },
});

describe("已完成回合的命令位置", () => {
  it("把最终回复后迟到的命令放回最终回复之前", () => {
    const turnId = "turn";
    const user: StreamItem = {
      kind: "user_message",
      id: "user",
      text: "问题",
      timestamp: at(1),
      turnId,
    };
    const intro = assistant("intro", "我先检查", turnId);
    const final = assistant("final", "已修复", turnId);
    const lateTool = tool("late", turnId);
    expect(
      placeCompletedTurnToolsBeforeFinalReply({
        items: [user, intro, final, lateTool],
        isTurnActive: false,
      }).map((item) => item.id),
    ).toEqual(["user", "intro", "late", "final"]);
  });

  it("运行中不改写说明文字与后续命令的真实顺序", () => {
    const turnId = "turn";
    const items = [assistant("intro", "我先检查", turnId), tool("running", turnId)];
    expect(placeCompletedTurnToolsBeforeFinalReply({ items, isTurnActive: true })).toBe(items);
  });

  it("不同回合及非命令尾部不跨回合移动", () => {
    const items = [assistant("final", "完成", "one"), tool("next", "two")];
    expect(placeCompletedTurnToolsBeforeFinalReply({ items, isTurnActive: false })).toBe(items);
  });
});
