import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { resolveAssistantTurnForkBoundary, resolveNativeTurnError } from "./turn-boundary";
import { resolveStreamRenderStrategy } from "./strategy-resolver";
import { orderTailForStreamRenderStrategy } from "./strategy";

it.each(["web", "android"] as const)("%s 的错误归属回合底部，不能带到下一轮", (platform) => {
  const strategy = resolveStreamRenderStrategy({ platform, isMobileBreakpoint: false });
  const process: StreamItem = {
    kind: "native_history_process",
    id: "process",
    turnId: "native",
    nativeTurnId: "native",
    timestamp: new Date(1000),
    status: "failed",
    durationMs: 4000,
    summaryMessageIds: [],
    summaryRevision: "r",
    error: "额度不足",
  };
  const last: StreamItem = {
    kind: "assistant_message",
    id: "last",
    nativeTurnId: "native",
    text: "中断前的说明",
    timestamp: new Date(3000),
  };
  const items = orderTailForStreamRenderStrategy({ strategy, streamItems: [process, last] });
  expect(resolveNativeTurnError({ strategy, items, startIndex: items.indexOf(last) })).toBe(
    "额度不足",
  );
  expect(resolveNativeTurnError({ strategy, items, startIndex: items.indexOf(process) })).toBe(
    "额度不足",
  );
  const next = userMessage("next", 5);
  const nextReply = assistantMessage("reply", 6);
  const nextItems = orderTailForStreamRenderStrategy({
    strategy,
    streamItems: [process, last, next, nextReply],
  });
  expect(
    resolveNativeTurnError({
      strategy,
      items: nextItems,
      startIndex: nextItems.indexOf(nextReply),
    }),
  ).toBeNull();
});

function timestamp(seed: number): Date {
  return new Date(`2026-01-01T00:00:${seed.toString().padStart(2, "0")}.000Z`);
}

function userMessage(id: string, seed: number): Extract<StreamItem, { kind: "user_message" }> {
  return {
    kind: "user_message",
    id,
    text: id,
    timestamp: timestamp(seed),
  };
}

function assistantMessage(
  id: string,
  seed: number,
  messageId?: string,
): Extract<StreamItem, { kind: "assistant_message" }> {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: timestamp(seed),
    ...(messageId ? { messageId } : {}),
  };
}

describe("resolveAssistantTurnForkBoundary", () => {
  it("无消息 ID 的原生中断预览使用回合边界，不借用其他回复", () => {
    const preview = { ...assistantMessage("preview", 2), nativeTurnId: "interrupted-turn" };
    expect(
      resolveAssistantTurnForkBoundary({
        items: [preview],
        startIndex: 0,
        supportsTimelineCursor: true,
        supportsNativeTurn: true,
      }),
    ).toEqual({ boundaryTurnId: "interrupted-turn" });
    expect(
      resolveAssistantTurnForkBoundary({
        items: [preview],
        startIndex: 0,
        supportsTimelineCursor: true,
        supportsNativeTurn: false,
      }),
    ).toBeUndefined();
  });
  it("forks a failed assistant turn from its Paseo timeline cursor without a provider message id", () => {
    const failedTurn = {
      ...assistantMessage("assistant-error", 2),
      timelineCursor: { epoch: "timeline-1", seq: 42 },
    };

    expect(
      resolveAssistantTurnForkBoundary({
        items: [userMessage("user-1", 1), failedTurn],
        startIndex: 1,
        supportsTimelineCursor: true,
      }),
    ).toEqual({
      boundaryCursor: { epoch: "timeline-1", seq: 42 },
    });
  });

  it("includes the provider message id with a supported timeline cursor", () => {
    const selected = {
      ...assistantMessage("assistant-1", 2, "msg-assistant-1"),
      timelineCursor: { epoch: "timeline-1", seq: 42 },
    };

    expect(
      resolveAssistantTurnForkBoundary({
        items: [selected],
        startIndex: 0,
        supportsTimelineCursor: true,
      }),
    ).toEqual({
      boundaryCursor: { epoch: "timeline-1", seq: 42 },
      boundaryMessageId: "msg-assistant-1",
    });
  });

  it("falls back to the provider message id when timeline cursors are unsupported", () => {
    const selected = {
      ...assistantMessage("assistant-1", 2, "msg-assistant-1"),
      timelineCursor: { epoch: "timeline-1", seq: 42 },
    };

    expect(
      resolveAssistantTurnForkBoundary({
        items: [selected],
        startIndex: 0,
        supportsTimelineCursor: false,
      }),
    ).toEqual({ boundaryMessageId: "msg-assistant-1" });
  });

  it("does not borrow a provider message id from another assistant in the same turn", () => {
    const first = assistantMessage("assistant-1", 2, "msg-assistant-1");
    const selected = assistantMessage("assistant-2", 3);

    expect(
      resolveAssistantTurnForkBoundary({
        items: [userMessage("user-1", 1), first, selected],
        startIndex: 2,
        supportsTimelineCursor: false,
      }),
    ).toBeUndefined();
  });

  it("requires the selected item to be an assistant message", () => {
    expect(
      resolveAssistantTurnForkBoundary({
        items: [userMessage("user-1", 1), assistantMessage("assistant-1", 2, "msg-assistant-1")],
        startIndex: 0,
        supportsTimelineCursor: false,
      }),
    ).toBeUndefined();
  });

  it("does not offer an unavailable boundary", () => {
    expect(
      resolveAssistantTurnForkBoundary({
        items: [assistantMessage("assistant-1", 2)],
        startIndex: 0,
        supportsTimelineCursor: false,
      }),
    ).toBeUndefined();
  });
});
