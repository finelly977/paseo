import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { buildAgentStreamRenderModel } from "./model";

function createTimestamp(seed: number): Date {
  return new Date(`2026-01-01T00:00:${seed.toString().padStart(2, "0")}.000Z`);
}

function userMessage(id: string, seed: number): StreamItem {
  return {
    kind: "user_message",
    id,
    text: id,
    timestamp: createTimestamp(seed),
  };
}

function assistantMessage(id: string, seed: number): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: createTimestamp(seed),
  };
}

describe("buildAgentStreamRenderModel", () => {
  it.each(["gpt-6.1-sol", "openai/GPT-5.4", "proxy:openai/gpt-5.4-mini"])(
    "当前使用 %s 时历史和实时思考均不显示，原始记录和耗时保持不变",
    (selectedModel) => {
      const thought: StreamItem = {
        kind: "thought",
        id: "thinking",
        text: "**内部摘要**",
        timestamp: createTimestamp(2),
        status: "ready",
      };
      const toolThought: StreamItem = {
        kind: "tool_call",
        id: "thinking-tool",
        timestamp: createTimestamp(3),
        payload: {
          source: "agent",
          data: {
            provider: "codex",
            callId: "thinking-tool",
            name: "thinking",
            status: "completed",
            error: null,
            detail: { type: "plain_text", text: "思考摘要" },
          },
        },
      };
      const tail = [userMessage("user", 1), thought];
      const head = [toolThought, assistantMessage("answer", 4)];
      const input = {
        agentStatus: "idle",
        tail,
        head,
        platform: "web" as const,
        isMobileBreakpoint: false,
      };
      const original = buildAgentStreamRenderModel(input);
      const hidden = buildAgentStreamRenderModel({ ...input, model: selectedModel });
      expect(hidden.history.map((item) => item.id)).toEqual(["user"]);
      expect(hidden.segments.liveHead.map((item) => item.id)).toEqual(["answer"]);
      expect(hidden.turnTiming).toBe(original.turnTiming);
      expect(tail).toEqual([userMessage("user", 1), thought]);
      expect(head).toEqual([toolThought, assistantMessage("answer", 4)]);
      const restored = buildAgentStreamRenderModel({ ...input, model: "claude-opus-4-6" });
      expect(restored.history).toBe(original.history);
      expect(restored.segments.liveHead).toBe(original.segments.liveHead);
      expect(buildAgentStreamRenderModel({ ...input, model: selectedModel }).history).toBe(
        hidden.history,
      );
    },
  );

  it.each(["claude-opus-4-6", "deepseek-V4-Pro", "grok-4.6", "gemini-3.8-pro", "not-gpt-6", null])(
    "非 GPT 或未确认的模型 %s 保留思考",
    (selectedModel) => {
      const tail: StreamItem[] = [
        {
          kind: "thought",
          id: "thought",
          text: "思考",
          timestamp: createTimestamp(2),
          status: "loading",
        },
      ];
      const model = buildAgentStreamRenderModel({
        agentStatus: "running",
        tail,
        head: [],
        platform: "web",
        isMobileBreakpoint: false,
        model: selectedModel,
      });
      expect(model.history).toBe(tail);
      expect(model.history.map((item) => item.id)).toEqual(["thought"]);
    },
  );

  it("原生端同样隐藏 GPT 思考，仅思考被隐藏时保留原始回合耗时", () => {
    const thought: StreamItem = {
      kind: "thought",
      id: "thought",
      text: "思考",
      timestamp: createTimestamp(4),
      status: "ready",
    };
    const tail = [userMessage("user", 1), assistantMessage("answer", 3), thought];
    const input = {
      agentStatus: "idle",
      tail,
      head: [],
      platform: "native" as const,
      isMobileBreakpoint: true,
    };
    const original = buildAgentStreamRenderModel(input);
    const visible = buildAgentStreamRenderModel({ ...input, model: "gpt-6" });
    expect(visible.segments.historyMounted.map((item) => item.id)).toEqual(["answer", "user"]);
    expect(visible.turnTiming).toBe(original.turnTiming);
    const prefiltered = buildAgentStreamRenderModel({
      ...input,
      tail: [tail[0], tail[1]],
      timingSource: input,
    });
    expect(prefiltered.turnTiming).toBe(original.turnTiming);
  });

  it("keeps head separate from committed history on desktop web", () => {
    const tail: StreamItem[] = [];
    for (let index = 0; index < 60; index += 1) {
      const seed = index * 2;
      tail.push(userMessage(`u${index}`, seed + 1));
      tail.push(assistantMessage(`a${index}`, seed + 2));
    }
    const head = [assistantMessage("live-a", 121)];

    const model = buildAgentStreamRenderModel({
      agentStatus: "running",
      tail,
      head,
      platform: "web",
      isMobileBreakpoint: false,
    });

    expect(model.segments.historyVirtualized.length).toBeGreaterThan(0);
    expect(model.segments.historyMounted.length).toBeGreaterThan(0);
    expect(model.segments.liveHead.map((item) => item.id)).toEqual(["live-a"]);
    expect(model.history).not.toContain(head[0]);
  });

  it("keeps the full committed tail mounted on mobile web", () => {
    const tail = [userMessage("u1", 1), assistantMessage("a1", 2)];
    const head = [assistantMessage("live-a", 3)];

    const model = buildAgentStreamRenderModel({
      agentStatus: "running",
      tail,
      head,
      platform: "web",
      isMobileBreakpoint: true,
    });

    expect(model.segments.historyVirtualized).toHaveLength(0);
    expect(model.segments.historyMounted).toBe(tail);
    expect(model.segments.liveHead).toBe(head);
  });

  it("reuses ordered committed history when only the live head changes", () => {
    const tail = [userMessage("u1", 1), assistantMessage("a1", 2)];
    const firstHead = [assistantMessage("live-a", 3)];
    const secondHead = [assistantMessage("live-b", 4)];

    const first = buildAgentStreamRenderModel({
      agentStatus: "running",
      tail,
      head: firstHead,
      platform: "native",
      isMobileBreakpoint: false,
    });
    const second = buildAgentStreamRenderModel({
      agentStatus: "running",
      tail,
      head: secondHead,
      platform: "native",
      isMobileBreakpoint: false,
    });

    expect(first.history).toBe(second.history);
    expect(first.segments.historyMounted).toBe(second.segments.historyMounted);
    expect(second.segments.liveHead.map((item) => item.id)).toEqual(["live-b"]);
  });

  it("derives running turn timing across committed history and live head", () => {
    const tail = [userMessage("u1", 1)];
    const head = [assistantMessage("live-a", 4)];

    const model = buildAgentStreamRenderModel({
      agentStatus: "running",
      tail,
      head,
      platform: "web",
      isMobileBreakpoint: false,
    });

    expect(model.turnTiming.runningStartedAt).toBe(tail[0]?.timestamp);
    expect(model.turnTiming.byAssistantId.has("live-a")).toBe(false);
  });

  it("maps completed turn timing to assistant ids across committed history and live head", () => {
    const tail = [userMessage("u1", 1)];
    const head = [assistantMessage("live-a", 4)];

    const model = buildAgentStreamRenderModel({
      agentStatus: "idle",
      tail,
      head,
      platform: "web",
      isMobileBreakpoint: false,
    });

    expect(model.turnTiming.runningStartedAt).toBe(null);
    expect(model.turnTiming.byAssistantId.get("live-a")).toEqual({
      startedAt: tail[0]?.timestamp,
      completedAt: head[0]?.timestamp,
      durationMs: 3000,
    });
  });

  it("derives the same timing for native inverted rendering", () => {
    const tail = [userMessage("u1", 1), assistantMessage("a1", 4)];

    const model = buildAgentStreamRenderModel({
      agentStatus: "idle",
      tail,
      head: [],
      platform: "native",
      isMobileBreakpoint: false,
    });

    expect(model.segments.historyMounted.map((item) => item.id)).toEqual(["a1", "u1"]);
    expect(model.turnTiming.byAssistantId.get("a1")).toEqual({
      startedAt: tail[0]?.timestamp,
      completedAt: tail[1]?.timestamp,
      durationMs: 3000,
    });
  });

  it("does not create completed timing for adjacent user messages", () => {
    const tail = [userMessage("u1", 1), userMessage("u2", 4)];

    const model = buildAgentStreamRenderModel({
      agentStatus: "idle",
      tail,
      head: [],
      platform: "web",
      isMobileBreakpoint: false,
    });

    expect(model.turnTiming.byAssistantId.size).toBe(0);
  });
});
