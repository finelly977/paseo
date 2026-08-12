import { describe, expect, test } from "vitest";

import {
  GrokNativeSessionDeleteError,
  deleteGrokNativeSession,
  type GrokCommandExecutor,
} from "./grok-native-session.js";

describe("Grok 原生会话删除", () => {
  test("使用已配置的启动器和环境永久删除指定会话", async () => {
    const calls: Array<{
      command: string;
      args: string[];
      options: Parameters<GrokCommandExecutor>[2];
    }> = [];
    const execute: GrokCommandExecutor = async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: "Deleted session session-1\n", stderr: "" };
    };

    await deleteGrokNativeSession({
      command: ["custom-grok", "agent", "stdio"],
      env: { GROK_CONFIG: "isolated" },
      sessionId: "session-1",
      execute,
    });

    expect(calls).toEqual([
      {
        command: "custom-grok",
        args: ["sessions", "delete", "session-1"],
        options: {
          envOverlay: expect.objectContaining({
            GROK_CONFIG: "isolated",
          }),
          maxBuffer: 1_048_576,
          timeout: 15_000,
        },
      },
    ]);
  });

  test("保留包运行器前缀并只替换 ACP 子命令", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const execute: GrokCommandExecutor = async (command, args) => {
      calls.push({ command, args });
      return { stdout: "Deleted session session-2\n", stderr: "" };
    };

    await deleteGrokNativeSession({
      command: ["npx", "-y", "@xai-official/grok", "agent", "stdio"],
      sessionId: "session-2",
      execute,
    });

    expect(calls).toEqual([
      {
        command: "npx",
        args: ["-y", "@xai-official/grok", "sessions", "delete", "session-2"],
      },
    ]);
  });

  test("拒绝无法可靠转换为删除命令的 Grok 配置", async () => {
    await expect(
      deleteGrokNativeSession({
        command: ["grok-wrapper", "serve"],
        sessionId: "session-3",
        execute: async () => ({ stdout: "", stderr: "" }),
      }),
    ).rejects.toMatchObject({
      name: "GrokNativeSessionDeleteError",
      sessionId: "session-3",
    });
  });

  test("删除命令失败时保留原始错误并明确指出目标会话", async () => {
    const commandError = new Error("命令超时");

    await expect(
      deleteGrokNativeSession({
        command: ["grok", "agent", "stdio"],
        sessionId: "session-4",
        execute: async () => {
          throw commandError;
        },
      }),
    ).rejects.toEqual(
      new GrokNativeSessionDeleteError("session-4", "Grok 原生会话删除失败：命令超时", {
        cause: commandError,
      }),
    );
  });
});
