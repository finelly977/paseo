import type { Query } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import type { AgentLaunchContext } from "../../agent-sdk-types.js";
import { ClaudeAgentClient } from "./agent.js";
import type { ClaudeQueryInput } from "./query.js";

function createQueryMock(events: unknown[]): Query {
  let index = 0;
  return {
    next: vi.fn(async () =>
      index < events.length
        ? { done: false, value: events[index++] }
        : { done: true, value: undefined },
    ),
    return: vi.fn(async () => ({ done: true, value: undefined })),
    interrupt: vi.fn(async () => undefined),
    close: vi.fn(() => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    supportedModels: vi.fn(async () => [{ value: "opus", displayName: "Opus" }]),
    supportedCommands: vi.fn(async () => []),
    rewindFiles: vi.fn(async () => ({ canRewind: true })),
    [Symbol.asyncIterator]() {
      return this;
    },
  } as Query;
}

describe("Claude SDK env", () => {
  test.each(["相对路径", "绝对路径"])("保留 %s 设置文件内容并仅覆盖会话强度", async (kind) => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-claude-thinking-"));
    const settingsPath = path.join(cwd, "fixed-effort.json");
    const original = JSON.stringify({ env: { CLAUDE_CODE_EFFORT_LEVEL: "max", KEEP_ENV: "kept" } });
    await fs.writeFile(settingsPath, original);
    const launches: ClaudeQueryInput[] = [];
    const session = await new ClaudeAgentClient({
      logger: createTestLogger(),
      resolveBinary: async () => "/test/claude/bin",
      queryFactory: (input) => {
        launches.push(input);
        return createQueryMock([
          {
            type: "system",
            subtype: "init",
            session_id: "settings-file-thinking-session",
            model: "anyrouter/claude-fable-5-1-reversed[1m]",
          },
          { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 },
        ]);
      },
    }).createSession({
      provider: "claude",
      cwd,
      model: "anyrouter/claude-fable-5-1-reversed[1m]",
      thinkingOptionId: "low",
      extra: { claude: { settings: kind === "相对路径" ? "fixed-effort.json" : settingsPath } },
    });
    try {
      await session.run("读取设置文件");
      expect(launches[0].options.settings).toEqual({
        env: { CLAUDE_CODE_EFFORT_LEVEL: "low", KEEP_ENV: "kept" },
      });
      expect(await fs.readFile(settingsPath, "utf8")).toBe(original);
    } finally {
      await session.close();
      await fs.unlink(settingsPath);
      await fs.rmdir(cwd);
    }
  });

  test("关闭思考时清除固定强度，不保留额外 SDK 强度", async () => {
    const launches: ClaudeQueryInput[] = [];
    const session = await new ClaudeAgentClient({
      logger: createTestLogger(),
      resolveBinary: async () => "/test/claude/bin",
      runtimeSettings: { env: { CLAUDE_CODE_EFFORT_LEVEL: "max" } },
      queryFactory: (input) => {
        launches.push(input);
        return createQueryMock([
          {
            type: "system",
            subtype: "init",
            session_id: "thinking-off-session",
            model: "claude-sonnet-5",
          },
          { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 },
        ]);
      },
    }).createSession({
      provider: "claude",
      cwd: process.cwd(),
      model: "claude-sonnet-5",
      thinkingOptionId: "off",
      extra: { claude: { effort: "high", settings: { env: { CLAUDE_CODE_EFFORT_LEVEL: "max" } } } },
    });
    try {
      await session.run("关闭思考");
      expect(launches[0].options.thinking).toEqual({ type: "disabled" });
      expect(launches[0].options.effort).toBeUndefined();
      expect(launches[0].options.env?.CLAUDE_CODE_EFFORT_LEVEL).toBe("unset");
      expect(launches[0].options.settings).toEqual({ env: { CLAUDE_CODE_EFFORT_LEVEL: "unset" } });
    } finally {
      await session.close();
    }
  });

  test.each(["low", "medium", "high", "xhigh", "max", "ultracode"])(
    "会话选择的 %s 强度覆盖固定环境变量和内联设置",
    async (thinkingOptionId) => {
      const launches: ClaudeQueryInput[] = [];
      const queryFactory = vi.fn((input: ClaudeQueryInput) => {
        launches.push(input);
        return createQueryMock([
          {
            type: "system",
            subtype: "init",
            session_id: "third-party-thinking-session",
            model: "anyrouter/claude-fable-5-1-reversed[1m]",
          },
          { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 },
        ]);
      });
      const client = new ClaudeAgentClient({
        logger: createTestLogger(),
        queryFactory,
        resolveBinary: async () => "/test/claude/bin",
        runtimeSettings: { env: { CLAUDE_CODE_EFFORT_LEVEL: "max" } },
      });
      const session = await client.createSession({
        provider: "claude",
        cwd: process.cwd(),
        model: "anyrouter/claude-fable-5-1-reversed[1m]",
        thinkingOptionId,
        extra: {
          claude: {
            effort: "high",
            settings: { env: { CLAUDE_CODE_EFFORT_LEVEL: "max", KEEP_ENV: "kept" } },
          },
        },
      });
      try {
        await session.run("检查会话强度");
        const effort = thinkingOptionId === "ultracode" ? "xhigh" : thinkingOptionId;
        expect(launches[0].options.effort).toBe(effort);
        expect(launches[0].options.env?.CLAUDE_CODE_EFFORT_LEVEL).toBe(effort);
        expect(launches[0].options.settings).toMatchObject({
          env: { CLAUDE_CODE_EFFORT_LEVEL: effort, KEEP_ENV: "kept" },
        });
      } finally {
        await session.close();
      }
    },
  );

  test("下一回合采用新强度，清除会话选择后恢复原有设置", async () => {
    const launches: ClaudeQueryInput[] = [];
    const queryFactory = vi.fn((input: ClaudeQueryInput) => {
      launches.push(input);
      return createQueryMock([
        {
          type: "system",
          subtype: "init",
          session_id: "thinking-switch-session",
          model: "anyrouter/claude-fable-5-1-reversed[1m]",
        },
        { type: "result", subtype: "success", usage: {}, total_cost_usd: 0 },
      ]);
    });
    const session = await new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
      runtimeSettings: { env: { CLAUDE_CODE_EFFORT_LEVEL: "max" } },
    }).createSession({
      provider: "claude",
      cwd: process.cwd(),
      model: "anyrouter/claude-fable-5-1-reversed[1m]",
      extra: { claude: { settings: { env: { CLAUDE_CODE_EFFORT_LEVEL: "max" } } } },
    });
    try {
      await session.run("原有默认值");
      await session.setThinkingOption?.("low");
      await session.run("低强度");
      await session.setThinkingOption?.("high");
      await session.run("高强度");
      await session.setThinkingOption?.(null);
      await session.run("恢复默认值");
      expect(launches.map(({ options }) => options.effort)).toEqual([
        undefined,
        "low",
        "high",
        undefined,
      ]);
      expect(launches.map(({ options }) => options.env?.CLAUDE_CODE_EFFORT_LEVEL)).toEqual([
        "max",
        "low",
        "high",
        "max",
      ]);
      expect(launches.map(({ options }) => options.settings)).toEqual([
        { env: { CLAUDE_CODE_EFFORT_LEVEL: "max" } },
        { env: { CLAUDE_CODE_EFFORT_LEVEL: "low" } },
        { env: { CLAUDE_CODE_EFFORT_LEVEL: "high" } },
        { env: { CLAUDE_CODE_EFFORT_LEVEL: "max" } },
      ]);
    } finally {
      await session.close();
    }
  });

  test("forwards launch-context env through Claude process env", async () => {
    let capturedEnv: Record<string, string | undefined> | undefined;
    const launchContext: AgentLaunchContext = {
      env: {
        PASEO_AGENT_ID: "00000000-0000-4000-8000-000000000201",
        PASEO_TEST_FLAG: "launch-value",
      },
    };
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedEnv = options.env;
      return createQueryMock([
        {
          type: "system",
          subtype: "init",
          session_id: "managed-agent-env-session",
          permissionMode: "default",
          model: "opus",
        },
        {
          type: "assistant",
          message: { content: "done" },
        },
        {
          type: "result",
          subtype: "success",
          usage: {
            input_tokens: 1,
            cache_read_input_tokens: 0,
            output_tokens: 1,
          },
          total_cost_usd: 0,
        },
      ]);
    });

    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
      runtimeSettings: {
        env: {
          MCP_TIMEOUT: "claude-startup-timeout",
          MCP_TOOL_TIMEOUT: "claude-tool-timeout",
        },
      },
    });
    const session = await client.createSession(
      {
        provider: "claude",
        cwd: process.cwd(),
      },
      launchContext,
    );

    try {
      const result = await session.run("env check");
      expect(result.sessionId).toBe("managed-agent-env-session");
      expect(capturedEnv?.PASEO_AGENT_ID).toBe(launchContext.env?.PASEO_AGENT_ID);
      expect(capturedEnv?.PASEO_TEST_FLAG).toBe(launchContext.env?.PASEO_TEST_FLAG);
      expect(capturedEnv?.CLAUDE_CODE_ENTRYPOINT).toBe("cli");
      expect(capturedEnv?.MCP_TIMEOUT).toBe("claude-startup-timeout");
      expect(capturedEnv?.MCP_TOOL_TIMEOUT).toBe("claude-tool-timeout");
    } finally {
      await session.close();
    }
  });

  test("forwards launch-context env through Claude resume env", async () => {
    let capturedEnv: Record<string, string | undefined> | undefined;
    const launchContext: AgentLaunchContext = {
      env: {
        PASEO_AGENT_ID: "00000000-0000-4000-8000-000000000202",
        PASEO_TEST_FLAG: "resume-launch-value",
      },
    };
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedEnv = options.env;
      return createQueryMock([
        {
          type: "system",
          subtype: "init",
          session_id: "persisted-session",
          permissionMode: "default",
          model: "opus",
        },
        {
          type: "assistant",
          message: { content: "done" },
        },
        {
          type: "result",
          subtype: "success",
          usage: {
            input_tokens: 1,
            cache_read_input_tokens: 0,
            output_tokens: 1,
          },
          total_cost_usd: 0,
        },
      ]);
    });

    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    });
    const session = await client.resumeSession(
      {
        provider: "claude",
        sessionId: "persisted-session",
        metadata: {
          cwd: process.cwd(),
        },
      },
      {
        cwd: process.cwd(),
      },
      launchContext,
    );

    try {
      const result = await session.run("resume env check");
      expect(result.sessionId).toBe("persisted-session");
      expect(capturedEnv?.PASEO_AGENT_ID).toBe(launchContext.env?.PASEO_AGENT_ID);
      expect(capturedEnv?.PASEO_TEST_FLAG).toBe(launchContext.env?.PASEO_TEST_FLAG);
      expect(capturedEnv?.CLAUDE_CODE_ENTRYPOINT).toBe("cli");
    } finally {
      await session.close();
    }
  });
});
