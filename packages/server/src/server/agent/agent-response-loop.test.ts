import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  generateStructuredAgentResponse,
  getStructuredAgentResponse,
  generateStructuredAgentResponseWithFallback,
  StructuredAgentCleanupError,
  StructuredAgentFallbackError,
  StructuredAgentResponseError,
  type AgentCaller,
} from "./agent-response-loop.js";
import type { AgentManager } from "./agent-manager.js";

function createScriptedCaller(responses: string[]) {
  const prompts: string[] = [];
  const caller: AgentCaller = async (prompt) => {
    prompts.push(prompt);
    const index = prompts.length - 1;
    return responses[index] ?? responses[responses.length - 1] ?? "";
  };
  return { caller, prompts };
}

describe("getStructuredAgentResponse", () => {
  it("retries on invalid JSON and succeeds", async () => {
    const schema = z.object({ title: z.string() });
    const { caller, prompts } = createScriptedCaller(["not json", '{"title":"ok"}']);

    const result = await getStructuredAgentResponse({
      caller,
      prompt: "Provide a title",
      schema,
      maxRetries: 2,
    });

    expect(result).toEqual({ title: "ok" });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Previous response was invalid");
    expect(prompts[1]).toContain("Invalid JSON");
  });

  it("retries on schema mismatch with validation errors", async () => {
    const schema = z.object({ count: z.number() });
    const { caller, prompts } = createScriptedCaller(['{"count":"nope"}', '{"count":2}']);

    const result = await getStructuredAgentResponse({
      caller,
      prompt: "Provide a count",
      schema,
      maxRetries: 2,
    });

    expect(result).toEqual({ count: 2 });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("validation errors");
    expect(prompts[1]).toContain("count");
  });

  it("fails after maxRetries with last response and validation errors", async () => {
    const schema = z.object({ count: z.number() });
    const { caller } = createScriptedCaller(['{"count":"nope"}', '{"count":"still"}']);

    try {
      await getStructuredAgentResponse({
        caller,
        prompt: "Provide a count",
        schema,
        maxRetries: 1,
      });
      throw new Error("Expected getStructuredAgentResponse to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(StructuredAgentResponseError);
      expect(error).toEqual(
        expect.objectContaining({
          name: "StructuredAgentResponseError",
          lastResponse: '{"count":"still"}',
          validationErrors: expect.arrayContaining([expect.stringContaining("count")]),
        }),
      );
    }
  });

  it("retries on raw JSON Schema validation errors and succeeds", async () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    };
    const { caller, prompts } = createScriptedCaller(['{"name": 123}', '{"name": "ok"}']);

    const result = await getStructuredAgentResponse({
      caller,
      prompt: "Provide a name",
      schema,
      maxRetries: 2,
    });

    expect(result).toEqual({ name: "ok" });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("validation errors");
  });

  it("extracts JSON from markdown code fences", async () => {
    const schema = z.object({ message: z.string() });
    const { caller } = createScriptedCaller(['```json\n{"message": "hello"}\n```']);

    const result = await getStructuredAgentResponse({
      caller,
      prompt: "Provide a message",
      schema,
      maxRetries: 0,
    });

    expect(result).toEqual({ message: "hello" });
  });

  it("extracts JSON from plain code fences", async () => {
    const schema = z.object({ value: z.number() });
    const { caller } = createScriptedCaller(['```\n{"value": 42}\n```']);

    const result = await getStructuredAgentResponse({
      caller,
      prompt: "Provide a value",
      schema,
      maxRetries: 0,
    });

    expect(result).toEqual({ value: 42 });
  });
});

describe("generateStructuredAgentResponse", () => {
  const schema = z.object({ summary: z.string() });

  function createManager(options?: {
    runError?: Error;
    closeError?: Error;
    deleteError?: Error;
  }): AgentManager & {
    createAgent: ReturnType<typeof vi.fn>;
    closeAgent: ReturnType<typeof vi.fn>;
    deleteAgentState: ReturnType<typeof vi.fn>;
  } {
    const createAgent = vi.fn(async () => ({ id: "agent-1" }));
    const runAgent = vi.fn(async () => {
      if (options?.runError) {
        throw options.runError;
      }
      return { finalText: '{"summary":"完成"}', timeline: [] };
    });
    const closeAgent = vi.fn(async () => {
      if (options?.closeError) {
        throw options.closeError;
      }
    });
    const deleteAgentState = vi.fn(async () => {
      if (options?.deleteError) {
        throw options.deleteError;
      }
    });
    return {
      createAgent,
      runAgent,
      closeAgent,
      deleteAgentState,
    } as unknown as AgentManager & {
      createAgent: ReturnType<typeof vi.fn>;
      closeAgent: ReturnType<typeof vi.fn>;
      deleteAgentState: ReturnType<typeof vi.fn>;
    };
  }

  it("成功生成后关闭智能体并删除临时状态", async () => {
    const manager = createManager();

    await expect(
      generateStructuredAgentResponse({
        manager,
        agentConfig: { provider: "grok", cwd: "E:\\paseo", internal: true },
        persistSession: false,
        prompt: "返回摘要",
        schema,
      }),
    ).resolves.toEqual({ summary: "完成" });

    expect(manager.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "grok", internal: true }),
      undefined,
      { persistSession: false, workspaceId: undefined },
    );
    expect(manager.closeAgent).toHaveBeenCalledWith("agent-1");
    expect(manager.deleteAgentState).toHaveBeenCalledWith("agent-1");
  });

  it("关闭失败后仍删除临时状态并报告清理错误", async () => {
    const closeError = new Error("原生会话删除失败");
    const manager = createManager({ closeError });

    let thrown: unknown;
    try {
      await generateStructuredAgentResponse({
        manager,
        agentConfig: { provider: "grok", cwd: "E:\\paseo", internal: true },
        persistSession: false,
        prompt: "返回摘要",
        schema,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown).toMatchObject({
      message: "清理结构化智能体 agent-1 失败",
      errors: [closeError],
    });
    expect(manager.deleteAgentState).toHaveBeenCalledWith("agent-1");
  });

  it("生成和清理同时失败时保留全部错误", async () => {
    const generationError = new Error("生成失败");
    const closeError = new Error("关闭失败");
    const deleteError = new Error("删除状态失败");
    const manager = createManager({ runError: generationError, closeError, deleteError });

    let thrown: unknown;
    try {
      await generateStructuredAgentResponse({
        manager,
        agentConfig: { provider: "grok", cwd: "E:\\paseo", internal: true },
        persistSession: false,
        prompt: "返回摘要",
        schema,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown).toMatchObject({
      message: "生成并清理结构化智能体 agent-1 失败",
      errors: [generationError, closeError, deleteError],
    });
  });
});

describe("generateStructuredAgentResponseWithFallback", () => {
  const schema = z.object({ summary: z.string() });

  function createManager(
    availability: Array<{ provider: string; available: boolean; error: string | null }>,
  ): AgentManager & { checkedProviders: string[] } {
    const checkedProviders: string[] = [];
    const availabilityByProvider = new Map(availability.map((entry) => [entry.provider, entry]));
    return {
      checkedProviders,
      getProviderAvailability: async (provider: string) => {
        checkedProviders.push(provider);
        return (
          availabilityByProvider.get(provider) ?? {
            provider,
            available: false,
            error: `No client registered for provider '${provider}'`,
          }
        );
      },
    } as unknown as AgentManager & { checkedProviders: string[] };
  }

  it("uses the first available provider in the waterfall", async () => {
    const calls: Array<{ provider: string; model?: string; persistSession?: boolean }> = [];
    const manager = createManager([
      { provider: "claude", available: true, error: null },
      { provider: "codex", available: true, error: null },
      { provider: "opencode", available: true, error: null },
    ]);

    const result = await generateStructuredAgentResponseWithFallback({
      manager,
      cwd: "/tmp/project",
      prompt: "Return JSON",
      schema,
      providers: [
        { provider: "claude", model: "haiku" },
        { provider: "codex", model: "gpt-5.4-mini" },
      ],
      persistSession: false,
      runner: async (options) => {
        calls.push({
          provider: options.agentConfig.provider,
          model: options.agentConfig.model ?? undefined,
          persistSession: options.persistSession,
        });
        return { summary: "ok" };
      },
    });

    expect(result).toEqual({ summary: "ok" });
    expect(calls).toEqual([{ provider: "claude", model: "haiku", persistSession: false }]);
    expect(manager.checkedProviders).toEqual(["claude"]);
  });

  it("skips unavailable providers and uses the next available one", async () => {
    const calls: Array<{ provider: string; model?: string }> = [];
    const manager = createManager([
      { provider: "claude", available: false, error: "missing auth" },
      { provider: "codex", available: true, error: null },
      { provider: "opencode", available: true, error: null },
    ]);

    const result = await generateStructuredAgentResponseWithFallback({
      manager,
      cwd: "/tmp/project",
      prompt: "Return JSON",
      schema,
      providers: [
        { provider: "claude", model: "haiku" },
        { provider: "codex", model: "gpt-5.4-mini" },
      ],
      runner: async (options) => {
        calls.push({
          provider: options.agentConfig.provider,
          model: options.agentConfig.model ?? undefined,
        });
        return { summary: "ok" };
      },
    });

    expect(result).toEqual({ summary: "ok" });
    expect(calls).toEqual([{ provider: "codex", model: "gpt-5.4-mini" }]);
    expect(manager.checkedProviders).toEqual(["claude", "codex"]);
  });

  it("falls back when an available provider fails", async () => {
    const calls: Array<{ provider: string; model?: string }> = [];
    const manager = createManager([
      { provider: "claude", available: true, error: null },
      { provider: "codex", available: true, error: null },
      { provider: "opencode", available: true, error: null },
    ]);

    const result = await generateStructuredAgentResponseWithFallback({
      manager,
      cwd: "/tmp/project",
      prompt: "Return JSON",
      schema,
      providers: [
        { provider: "claude", model: "haiku" },
        { provider: "codex", model: "gpt-5.4-mini" },
      ],
      runner: async (options) => {
        calls.push({
          provider: options.agentConfig.provider,
          model: options.agentConfig.model ?? undefined,
        });
        if (options.agentConfig.provider === "claude") {
          throw new Error("claude failed");
        }
        return { summary: "ok" };
      },
    });

    expect(result).toEqual({ summary: "ok" });
    expect(calls).toEqual([
      { provider: "claude", model: "haiku" },
      { provider: "codex", model: "gpt-5.4-mini" },
    ]);
    expect(manager.checkedProviders).toEqual(["claude", "codex"]);
  });

  it("清理失败时停止回退，避免继续创建更多临时智能体", async () => {
    const manager = createManager([
      { provider: "grok", available: true, error: null },
      { provider: "codex", available: true, error: null },
    ]);
    const cleanupError = new StructuredAgentCleanupError({
      agentId: "agent-1",
      cleanupErrors: [new Error("Grok 原生会话删除失败")],
      generationOutcome: { ok: true, value: { summary: "已生成" } },
    });
    const runner = vi.fn(async () => {
      throw cleanupError;
    });

    await expect(
      generateStructuredAgentResponseWithFallback({
        manager,
        cwd: "/tmp/project",
        prompt: "Return JSON",
        schema,
        providers: [{ provider: "grok" }, { provider: "codex" }],
        runner,
      }),
    ).rejects.toBe(cleanupError);

    expect(runner).toHaveBeenCalledOnce();
    expect(manager.checkedProviders).toEqual(["grok"]);
  });

  it("throws a fallback error when all providers are unavailable or fail", async () => {
    const manager = createManager([
      { provider: "claude", available: false, error: "missing auth" },
      { provider: "codex", available: true, error: null },
      { provider: "opencode", available: false, error: "not installed" },
    ]);

    await expect(
      generateStructuredAgentResponseWithFallback({
        manager,
        cwd: "/tmp/project",
        prompt: "Return JSON",
        schema,
        providers: [
          { provider: "claude", model: "haiku" },
          { provider: "codex", model: "gpt-5.4-mini" },
          { provider: "opencode", model: "opencode/gpt-5-nano" },
        ],
        runner: async () => {
          throw new Error("failed");
        },
      }),
    ).rejects.toBeInstanceOf(StructuredAgentFallbackError);
  });
});
