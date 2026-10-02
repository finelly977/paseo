import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { CLIENT_CAPS } from "@getpaseo/protocol/client-capabilities";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";

import { ClaudeAgentClient } from "../agent/providers/claude/agent.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

function sanitizeClaudeProjectPath(cwd: string): string {
  return cwd.replace(/[\\/._:]/g, "-");
}

interface ClaudeJsonlEntry {
  type: "user" | "assistant";
  uuid?: string;
  sessionId: string;
  cwd: string;
  message: { role: "user" | "assistant"; content: string };
}

function userEntry(
  sessionId: string,
  cwd: string,
  content: string,
  uuid: string,
): ClaudeJsonlEntry {
  return {
    type: "user",
    uuid,
    sessionId,
    cwd,
    message: { role: "user", content },
  };
}

function assistantEntry(sessionId: string, cwd: string, content: string): ClaudeJsonlEntry {
  return {
    type: "assistant",
    sessionId,
    cwd,
    message: { role: "assistant", content },
  };
}

function timelineText(entries: ReadonlyArray<{ item: { type: string; text?: string } }>): string {
  return entries
    .filter(
      (entry): entry is { item: { type: "user_message" | "assistant_message"; text: string } } =>
        entry.item.type === "user_message" || entry.item.type === "assistant_message",
    )
    .map((entry) => entry.item.text)
    .join("\n");
}

describe("daemon E2E - refresh rehydrates timeline from on-disk session", () => {
  let claudeConfigDir: string;
  let prevClaudeConfigDir: string | undefined;
  let cwd: string;
  let sessionFile: string;
  let daemon: TestPaseoDaemon | undefined;
  let client: DaemonClient | undefined;

  const sessionId = "external-edits-session";

  beforeEach(() => {
    prevClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    claudeConfigDir = mkdtempSync(path.join(tmpdir(), "claude-cfg-refresh-"));
    process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;

    cwd = mkdtempSync(path.join(tmpdir(), "claude-cwd-refresh-"));
    const projectsDir = path.join(claudeConfigDir, "projects", sanitizeClaudeProjectPath(cwd));
    mkdirSync(projectsDir, { recursive: true });
    sessionFile = path.join(projectsDir, `${sessionId}.jsonl`);

    const initial: ClaudeJsonlEntry[] = [
      userEntry(sessionId, cwd, "first hello", "user-uuid-1"),
      assistantEntry(sessionId, cwd, "first reply"),
    ];
    writeFileSync(
      sessionFile,
      `${initial.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
      "utf8",
    );
  });

  afterEach(async () => {
    await client?.close().catch(() => undefined);
    await daemon?.close().catch(() => undefined);
    client = undefined;
    daemon = undefined;
    rmSync(claudeConfigDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
    if (prevClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = prevClaudeConfigDir;
    }
  }, 60_000);

  test("重新加载完整读取外部新增历史，现代客户端只收到替换通知和尾页", async () => {
    const logger = pino({ level: "silent" });
    daemon = await createTestPaseoDaemon({
      agentClients: {
        claude: new ClaudeAgentClient({
          logger,
          resolveBinary: async () => "/test/claude/bin",
        }),
      },
      logger,
    });
    client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      clientId: "refresh-initiating",
      capabilities: {
        [CLIENT_CAPS.selectiveAgentTimeline]: true,
        [CLIENT_CAPS.timelineReplacementInvalidation]: true,
      },
    });
    await client.connect();
    await client.fetchAgents({
      subscribe: { subscriptionId: "refresh-rehydrate-test" },
    });

    const imported = await client.importAgent({ provider: "claude", sessionId, cwd });
    expect(imported.id).toBeTruthy();

    const before = await client.fetchAgentTimeline(imported.id, {
      direction: "tail",
      limit: 0,
      projection: "canonical",
    });
    const beforeText = timelineText(before.entries);
    expect(beforeText).toContain("first hello");
    expect(beforeText).toContain("first reply");
    const epochBefore = before.epoch;
    const countBefore = before.entries.length;

    const passive = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      clientId: "refresh-passive",
      capabilities: {
        [CLIENT_CAPS.selectiveAgentTimeline]: true,
        [CLIENT_CAPS.timelineReplacementInvalidation]: true,
      },
    });
    const unrelated = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      clientId: "refresh-unrelated",
      capabilities: {
        [CLIENT_CAPS.selectiveAgentTimeline]: true,
        [CLIENT_CAPS.timelineReplacementInvalidation]: true,
      },
    });
    const legacy = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      clientId: "refresh-legacy",
      capabilities: { [CLIENT_CAPS.timelineReplacementInvalidation]: false },
    });
    const connectedClients = [client, passive, unrelated, legacy];
    const received = connectedClients.map(() => new Array<SessionOutboundMessage>());
    const unsubscribe: Array<() => void> = [];
    for (const [index, connected] of connectedClients.entries()) {
      unsubscribe.push(connected.subscribeRawMessages((message) => received[index].push(message)));
    }
    try {
      await Promise.all([passive.connect(), unrelated.connect(), legacy.connect()]);
      await Promise.all([
        client.setAgentTimelineSubscription([imported.id]),
        passive.setAgentTimelineSubscription([imported.id]),
        unrelated.setAgentTimelineSubscription([]),
      ]);
      for (const messages of received) messages.length = 0;

      const additions = Array.from({ length: 50 }, (_, index) => [
        userEntry(sessionId, cwd, `外部用户消息 ${index}`, `external-user-${index}`),
        assistantEntry(sessionId, cwd, `外部助手回复 ${index}`),
      ]).flat();
      appendFileSync(
        sessionFile,
        `${additions.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
        "utf8",
      );

      await client.refreshAgent(imported.id);
      await Promise.all([client.ping(), passive.ping(), unrelated.ping(), legacy.ping()]);
      const replacementCounts: number[] = [];
      const replayCounts: number[] = [];
      for (const messages of received) {
        replacementCounts.push(
          messages.filter((message) => message.type === "agent.timeline.replacement").length,
        );
        replayCounts.push(
          messages.filter(
            (message) =>
              message.type === "agent_stream" && message.payload.event.type === "timeline",
          ).length,
        );
      }
      expect(replacementCounts).toEqual([0, 1, 0, 0]);
      expect(replayCounts).toEqual([0, 0, 0, 102]);

      if (!before.endCursor) throw new Error("Expected the initial history cursor");
      const tail = await client.fetchAgentTimeline(imported.id, {
        direction: "tail",
        limit: 40,
        cursor: before.endCursor,
        projection: "canonical",
      });
      expect(tail.entries).toHaveLength(40);
      expect(tail.epoch).not.toBe(epochBefore);
      expect(timelineText(tail.entries)).toContain("外部助手回复 49");

      const after = await client.fetchAgentTimeline(imported.id, {
        direction: "tail",
        limit: 0,
        projection: "canonical",
      });
      const afterText = timelineText(after.entries);
      expect(afterText).toContain("外部用户消息 0");
      expect(afterText).toContain("外部助手回复 49");
      expect(after.entries.length).toBeGreaterThan(countBefore);
      expect(after.epoch).not.toBe(epochBefore);
    } finally {
      for (const stop of unsubscribe) stop();
      await Promise.all([passive.close(), unrelated.close(), legacy.close()]);
    }
  }, 30_000);
});
