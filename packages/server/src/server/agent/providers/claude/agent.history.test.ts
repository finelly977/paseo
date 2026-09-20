import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { ClaudeAgentClient, extractUserMessageText } from "./agent.js";
import { claudeProjectDirSync } from "./project-dir.js";

describe("extractUserMessageText", () => {
  test("returns trimmed string content", () => {
    expect(extractUserMessageText("  Hello world  ")).toBe("Hello world");
  });

  test("combines multiple text blocks", () => {
    const content = [
      { type: "text", text: "First line" },
      { type: "text", text: "Second line" },
    ];

    expect(extractUserMessageText(content)).toBe("First line\n\nSecond line");
  });

  test("returns Claude slash command prompts without transcript tags", () => {
    const content =
      "<command-message>diagnose</command-message>\n<command-name>/diagnose</command-name>\n<command-args>recently the PR data does not update</command-args>";

    expect(extractUserMessageText(content)).toBe("/diagnose recently the PR data does not update");
  });

  test("returns the Claude slash command prompt when no args were recorded", () => {
    const content =
      "<command-message>caveman:caveman</command-message>\n<command-name>/caveman:caveman</command-name>";

    expect(extractUserMessageText(content)).toBe("/caveman:caveman");
  });

  test("returns null when no textual content is present", () => {
    const content = [
      { type: "image", source: "foo.png" },
      { type: "file", path: "bar.txt" },
    ];

    expect(extractUserMessageText(content)).toBeNull();
  });
});

describe("Claude persisted subagent history", () => {
  test("restores only direct children and keeps their complete timeline together", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-claude-subagents-"));
    const configDir = path.join(root, "claude");
    const cwd = path.join(root, "workspace");
    const sessionId = "history-subagent-session";
    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;

    try {
      process.env.CLAUDE_CONFIG_DIR = configDir;
      await mkdir(cwd, { recursive: true });
      const projectDir = claudeProjectDirSync(cwd, { configDir });
      const subagentDir = path.join(projectDir, sessionId, "subagents");
      await mkdir(subagentDir, { recursive: true });

      const parentEntries = [
        {
          type: "assistant",
          timestamp: "2026-09-20T01:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "direct-agent-call",
                name: "Agent",
                input: {
                  subagent_type: "general-purpose",
                  description: "Review the app",
                },
              },
            ],
          },
        },
        {
          type: "user",
          timestamp: "2026-09-20T01:00:01.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "direct-agent-call",
                content: "Async agent launched successfully.\nagentId: direct-native-id",
              },
            ],
          },
        },
      ];
      const directEntries = [
        {
          type: "user",
          isSidechain: true,
          agentId: "direct-native-id",
          timestamp: "2026-09-20T01:00:00.500Z",
          message: { role: "user", content: "Review the app" },
        },
        {
          type: "assistant",
          isSidechain: true,
          agentId: "direct-native-id",
          timestamp: "2026-09-20T01:00:02.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "nested-agent-call",
                name: "Agent",
                input: { subagent_type: "Explore", description: "Review settings" },
              },
            ],
          },
        },
        {
          type: "user",
          isSidechain: true,
          agentId: "direct-native-id",
          timestamp: "2026-09-20T01:00:03.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "nested-agent-call",
                content: "Async agent launched successfully.\nagentId: nested-native-id",
              },
            ],
          },
        },
        {
          type: "assistant",
          isSidechain: true,
          agentId: "direct-native-id",
          timestamp: "2026-09-20T01:00:04.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Direct child result" }],
          },
        },
      ];
      const nestedEntries = [
        {
          type: "user",
          isSidechain: true,
          agentId: "nested-native-id",
          timestamp: "2026-09-20T01:00:02.500Z",
          message: { role: "user", content: "Review settings" },
        },
        {
          type: "assistant",
          isSidechain: true,
          agentId: "nested-native-id",
          timestamp: "2026-09-20T01:00:03.500Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Nested child result" }],
          },
        },
      ];
      const serialize = (entries: readonly object[]) =>
        `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
      await writeFile(path.join(projectDir, `${sessionId}.jsonl`), serialize(parentEntries));
      await writeFile(
        path.join(subagentDir, "agent-direct-native-id.jsonl"),
        serialize(directEntries),
      );
      await writeFile(
        path.join(subagentDir, "agent-nested-native-id.jsonl"),
        serialize(nestedEntries),
      );

      const client = new ClaudeAgentClient({
        logger: createTestLogger(),
        resolveBinary: async () => "/test/claude/bin",
      });
      const session = await client.resumeSession({
        provider: "claude",
        sessionId,
        nativeHandle: sessionId,
        metadata: { provider: "claude", cwd },
      });
      const events = [];
      for await (const event of session.streamHistory()) {
        events.push(event);
      }
      await session.close();

      const providerEvents = events.flatMap((event) =>
        event.type === "provider_subagent" ? [event.event] : [],
      );
      const restoredIds = new Set(providerEvents.map((event) => event.id));
      expect(restoredIds).toEqual(new Set(["direct-agent-call"]));
      expect(providerEvents).toContainEqual({
        type: "upsert",
        id: "direct-agent-call",
        title: "Review the app",
        description: "Review the app",
        status: "running",
        toolCallId: "direct-agent-call",
        timestamp: "2026-09-20T01:00:00.500Z",
      });
      expect(providerEvents).toContainEqual({
        type: "timeline",
        id: "direct-agent-call",
        item: { type: "user_message", text: "Review the app" },
        timestamp: "2026-09-20T01:00:00.500Z",
      });
      expect(providerEvents).toContainEqual({
        type: "timeline",
        id: "direct-agent-call",
        item: expect.objectContaining({
          type: "assistant_message",
          text: "Direct child result",
        }),
        timestamp: "2026-09-20T01:00:04.000Z",
      });
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});
