import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  Options,
  Query,
  SpawnOptions as ClaudeSpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import * as spawnUtils from "../../../../utils/spawn.js";
import { ClaudeAgentClient } from "./agent.js";
import { claudeProjectDirSync } from "./project-dir.js";
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

function createChildProcessStub(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.stderr = new EventEmitter() as ChildProcess["stderr"];
  return child;
}

describe("Claude spawn override", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("bypasses the shell when spawning Claude Code", async () => {
    let capturedOptions: Options | undefined;
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      return createQueryMock([
        {
          type: "system",
          subtype: "init",
          session_id: "claude-spawn-shell-regression-session",
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
    const spawnSpy = vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(createChildProcessStub());
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "/test/claude/bin",
    });
    const session = await client.createSession({
      provider: "claude",
      cwd: process.cwd(),
    });

    try {
      await session.run("spawn shell regression");
      capturedOptions?.spawnClaudeCodeProcess?.({
        command: "node",
        args: ["claude.js", "--mcp-config", '{"mcpServers":{"paseo":{"type":"http"}}}'],
        cwd: process.cwd(),
        env: {},
        signal: new AbortController().signal,
      } satisfies ClaudeSpawnOptions);
    } finally {
      await session.close();
    }

    const claudeSpawnCall = spawnSpy.mock.calls.find(([, args]) => args[0] === "claude.js");
    expect(claudeSpawnCall).toBeDefined();
    const spawnOptions = claudeSpawnCall?.[2];
    expect(spawnOptions?.shell).toBe(false);
    expect(spawnOptions?.env?.CLAUDE_CODE_ENTRYPOINT).toBe("cli");
  });

  test("forces the CLI entrypoint when spawning the native Claude binary", async () => {
    let capturedOptions: Options | undefined;
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      return createQueryMock([
        {
          type: "system",
          subtype: "init",
          session_id: "claude-native-entrypoint-session",
          permissionMode: "default",
          model: "opus",
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
    const spawnSpy = vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(createChildProcessStub());
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "C:\\Claude\\claude.exe",
    });
    const session = await client.createSession({
      provider: "claude",
      cwd: process.cwd(),
    });

    try {
      await session.run("native entrypoint regression");
      capturedOptions?.spawnClaudeCodeProcess?.({
        command: "C:\\Claude\\claude.exe",
        args: ["--output-format", "stream-json"],
        cwd: process.cwd(),
        env: {},
        signal: new AbortController().signal,
      } satisfies ClaudeSpawnOptions);
    } finally {
      await session.close();
    }

    const nativeSpawnCall = spawnSpy.mock.calls.find(
      ([command]) => command === "C:\\Claude\\claude.exe",
    );
    expect(nativeSpawnCall).toBeDefined();
    expect(nativeSpawnCall?.[2]?.envOverlay?.CLAUDE_CODE_ENTRYPOINT).toBe("cli");
  });

  test("Claude 把非交互会话改成 sdk-cli 后立即转换原生记录", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-claude-live-entrypoint-"));
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-claude-live-workspace-"));
    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    const sessionId = "9a101043-226a-47e4-9908-184791f04ee7";
    let capturedOptions: Options | undefined;
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      return createQueryMock([
        {
          type: "system",
          subtype: "init",
          session_id: sessionId,
          permissionMode: "default",
          model: "opus",
        },
        {
          type: "result",
          subtype: "success",
          session_id: sessionId,
          uuid: "result-entrypoint-sync",
          usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
          total_cost_usd: 0,
        },
      ]);
    });
    vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(createChildProcessStub());
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "C:\\Claude\\claude.exe",
    });
    const session = await client.createSession({ provider: "claude", cwd });

    try {
      await (
        session as unknown as {
          ensureQuery(): Promise<Query>;
        }
      ).ensureQuery();
      capturedOptions?.spawnClaudeCodeProcess?.({
        command: "C:\\Claude\\claude.exe",
        args: ["--output-format", "stream-json"],
        cwd,
        env: { CLAUDE_CODE_ENTRYPOINT: "cli" },
        signal: new AbortController().signal,
      } satisfies ClaudeSpawnOptions);
      const projectDir = claudeProjectDirSync(cwd, { configDir });
      await fs.mkdir(projectDir, { recursive: true });
      const sessionPath = path.join(projectDir, `${sessionId}.jsonl`);
      await fs.writeFile(
        sessionPath,
        `${JSON.stringify({ type: "user", entrypoint: "sdk-cli", sessionId })}\n`,
        "utf8",
      );

      await expect(session.run("同步 CLI 可见性")).resolves.toMatchObject({ sessionId });
      const transcript = await fs.readFile(sessionPath, "utf8");
      expect(JSON.parse(transcript).entrypoint).toBe("cli");
    } finally {
      await session.close();
      if (previousConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
      }
      await fs.rm(configDir, { recursive: true, force: true });
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  test("原生 Claude 回合完成却没有会话文件时明确失败", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-claude-missing-transcript-"));
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-claude-missing-workspace-"));
    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    const sessionId = "97de07a5-b236-49e1-ad56-3373c00c2ae8";
    let capturedOptions: Options | undefined;
    const queryFactory = vi.fn(({ options }: ClaudeQueryInput) => {
      capturedOptions = options;
      return createQueryMock([
        {
          type: "system",
          subtype: "init",
          session_id: sessionId,
          permissionMode: "default",
          model: "opus",
        },
        {
          type: "result",
          subtype: "success",
          session_id: sessionId,
          uuid: "result-missing-transcript",
          usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
          total_cost_usd: 0,
        },
      ]);
    });
    vi.spyOn(spawnUtils, "spawnProcess").mockReturnValue(createChildProcessStub());
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory,
      resolveBinary: async () => "C:\\Claude\\claude.exe",
    });
    const session = await client.createSession({ provider: "claude", cwd });

    try {
      await (
        session as unknown as {
          ensureQuery(): Promise<Query>;
        }
      ).ensureQuery();
      capturedOptions?.spawnClaudeCodeProcess?.({
        command: "C:\\Claude\\claude.exe",
        args: ["--output-format", "stream-json"],
        cwd,
        env: { CLAUDE_CODE_ENTRYPOINT: "cli" },
        signal: new AbortController().signal,
      } satisfies ClaudeSpawnOptions);

      await expect(session.run("缺失会话文件")).rejects.toThrow(
        "Claude 已完成回合但未生成原生会话文件",
      );
    } finally {
      await session.close();
      if (previousConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
      }
      await fs.rm(configDir, { recursive: true, force: true });
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
