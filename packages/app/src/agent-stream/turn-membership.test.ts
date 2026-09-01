import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { buildAgentStreamRenderModel } from "./model";
import { layoutStream } from "./layout";
import { resolveStreamRenderStrategy } from "./strategy-resolver";
import { continuesTurn } from "./turn-membership";

function at(second: number): Date {
  return new Date(`2026-01-01T00:00:${second.toString().padStart(2, "0")}.000Z`);
}

function user(
  id: string,
  second: number,
  turnId: string,
  turnRole?: "start" | "steer",
): StreamItem {
  return {
    kind: "user_message",
    id,
    text: id,
    timestamp: at(second),
    turnId,
    ...(turnRole ? { turnRole } : {}),
  };
}

function assistant(id: string, second: number, turnId: string): StreamItem {
  return { kind: "assistant_message", id, text: id, timestamp: at(second), turnId };
}

function runningTool(id: string, second: number, turnId: string): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: at(second),
    turnId,
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: "Bash",
        status: "running",
        error: null,
        detail: { type: "unknown", input: null, output: null },
      },
    },
  };
}

function layoutFor(items: StreamItem[], isTurnActive: boolean) {
  const model = buildAgentStreamRenderModel({
    agentStatus: isTurnActive ? "running" : "idle",
    tail: items,
    head: [],
    platform: "web",
    isMobileBreakpoint: false,
  });
  return {
    model,
    layout: layoutStream({
      strategy: resolveStreamRenderStrategy({ platform: "web", isMobileBreakpoint: false }),
      agentStatus: isTurnActive ? "running" : "idle",
      isTurnActive,
      history: model.segments.historyMounted,
      liveHead: model.segments.liveHead,
      timingByAssistantId: model.turnTiming.byAssistantId,
      messageSpacing: 0,
    }),
  };
}

function completedFooterIds(layout: ReturnType<typeof layoutFor>["layout"]): string[] {
  return [
    ...layout.history.flatMap((row) => (row.completedFooter ? [row.completedFooter.itemId] : [])),
    ...layout.liveHead.flatMap((row) => (row.completedFooter ? [row.completedFooter.itemId] : [])),
    ...(layout.auxiliaryTurnFooter ? [layout.auxiliaryTurnFooter.itemId] : []),
  ];
}

describe("canonical turn membership", () => {
  it("stops tagged traversal at every mismatching turn ID", () => {
    expect(continuesTurn(assistant("first", 1, "turn-1"), runningTool("next", 2, "turn-2"))).toBe(
      false,
    );
    expect(continuesTurn(runningTool("first", 1, "turn-1"), assistant("next", 2, "turn-1"))).toBe(
      true,
    );
  });

  it("keeps an explicit historical steer in its provider turn when legacy rows have no turn ID", () => {
    const previous: StreamItem = {
      kind: "assistant_message",
      id: "preface",
      text: "preface",
      timestamp: at(1),
    };
    const steer: StreamItem = {
      kind: "user_message",
      id: "steer",
      text: "steer",
      timestamp: at(2),
      turnRole: "steer",
    };

    expect(continuesTurn(previous, steer)).toBe(true);
  });

  it("treats a user message without a role as a new turn even when Codex reused its turn ID", () => {
    expect(
      continuesTurn(
        assistant("first-done", 9, "codex-turn-0"),
        user("second-prompt", 20, "codex-turn-0"),
      ),
    ).toBe(false);
  });

  it.each([
    [
      "Claude",
      (turnId: string) => [
        user("prompt", 1, turnId, "start"),
        runningTool("sleep", 2, turnId),
        user("hello", 3, turnId, "steer"),
      ],
    ],
    [
      "Codex",
      (turnId: string) => [
        user("prompt", 1, turnId, "start"),
        assistant("preface", 2, turnId),
        runningTool("sleep", 3, turnId),
        user("hello", 4, turnId, "steer"),
      ],
    ],
  ] as const)("keeps %s-shaped active steers in one visible turn", (_provider, build) => {
    const turnId = "turn-1";
    const active = layoutFor(build(turnId), true);

    expect(completedFooterIds(active.layout)).toEqual([]);
    expect(active.model.turnTiming.runningStartedAt).toEqual(at(1));

    const completedItems = [...build(turnId), assistant("done", 9, turnId)];
    const completed = layoutFor(completedItems, false);
    expect(completedFooterIds(completed.layout)).toEqual(["done"]);
    expect(completed.model.turnTiming.byAssistantId.get("done")).toMatchObject({
      startedAt: at(1),
      completedAt: at(9),
      durationMs: 8000,
    });
  });

  it("splits persisted prompts without roles when an old Codex runtime reused its local turn ID", () => {
    const reusedTurnId = "codex-turn-0";
    const completed = layoutFor(
      [
        user("first-prompt", 1, reusedTurnId),
        runningTool("first-tool", 2, reusedTurnId),
        assistant("first-done", 9, reusedTurnId),
        user("second-prompt", 20, reusedTurnId),
        assistant("second-done", 24, reusedTurnId),
      ],
      false,
    );

    expect(completedFooterIds(completed.layout)).toEqual(["first-done", "second-done"]);
    expect(completed.model.turnTiming.byAssistantId.get("first-done")).toMatchObject({
      startedAt: at(1),
      completedAt: at(9),
      durationMs: 8000,
    });
    expect(completed.model.turnTiming.byAssistantId.get("second-done")).toMatchObject({
      startedAt: at(20),
      completedAt: at(24),
      durationMs: 4000,
    });
  });
});
