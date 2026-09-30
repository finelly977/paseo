import { describe, expect, test } from "vitest";
import type { AgentStreamEvent, ToolCallTimelineItem } from "../../agent-sdk-types.js";
import { settleCodexCommand } from "./command-lifecycle.js";
import { createFakeCodexAppServer, waitForNextTimelineItem } from "./test-utils/fake-app-server.js";
import { CodexAppServerAgentSession } from "../codex-app-server-agent.js";
import { createTestLogger } from "../../../../test-utils/test-logger.js";

const pending: ToolCallTimelineItem = {
  type: "tool_call",
  callId: "long-command",
  name: "Shell",
  status: "running",
  error: null,
  detail: {
    type: "shell",
    command: "long-command",
    cwd: "/workspace",
    output: null,
    exitCode: null,
  },
};

describe("Codex 命令生命周期", () => {
  test("读取已完成的旧回合时清除残留运行状态，未知回合不猜测", async () => {
    const appServer = createFakeCodexAppServer({
      "thread/read": () => ({
        thread: {
          historyMode: "legacy",
          turns: [
            {
              status: "completed",
              items: [
                {
                  type: "commandExecution",
                  id: "old-command",
                  command: "long-command",
                  status: "inProgress",
                },
              ],
            },
            {
              status: "inProgress",
              items: [
                {
                  type: "commandExecution",
                  id: "active-command",
                  command: "long-command",
                  status: "inProgress",
                },
              ],
            },
          ],
        },
      }),
    });
    const session = new CodexAppServerAgentSession(
      { provider: "codex", cwd: "/workspace", modeId: "auto", model: "gpt-5.4" },
      { sessionId: "old-thread" },
      createTestLogger(),
      () => appServer.spawnChild(),
    );
    try {
      await session.connect();
      const history = await Array.fromAsync(session.streamHistory());
      expect(history).toEqual([
        expect.objectContaining({
          item: expect.objectContaining({ callId: "old-command", status: "completed" }),
        }),
        expect.objectContaining({
          item: expect.objectContaining({ callId: "active-command", status: "running" }),
        }),
      ]);
    } finally {
      await session.close();
    }
  });

  test("回合结束收束命令调用，但不伪造退出码或输出", () => {
    expect(settleCodexCommand(pending, "completed")).toEqual({ ...pending, status: "completed" });
    expect(settleCodexCommand(pending, "interrupted")).toEqual({ ...pending, status: "canceled" });
    expect(settleCodexCommand(pending, "inProgress")).toBe(pending);
    expect(settleCodexCommand(pending, undefined)).toBe(pending);
    const failed = { ...pending, status: "failed" } satisfies ToolCallTimelineItem;
    expect(settleCodexCommand(failed, "completed")).toBe(failed);
  });

  test.each(["completed", "failed", "interrupted"])(
    "收到 %s 回合结束时先收束无结束事件的命令",
    async (status) => {
      const appServer = createFakeCodexAppServer();
      const session = new CodexAppServerAgentSession(
        { provider: "codex", cwd: "/workspace", modeId: "auto", model: "gpt-5.4" },
        null,
        createTestLogger(),
        () => appServer.spawnChild(),
      );
      const events: AgentStreamEvent[] = [];
      session.subscribe((event) => events.push(event));
      try {
        await session.connect();
        await session.startTurn("启动长期命令");
        const started = waitForNextTimelineItem(session);
        appServer.child.stdout.write(
          JSON.stringify({
            method: "codex/event/exec_command_begin",
            params: {
              threadId: "thread-1",
              msg: { type: "exec_command_begin", call_id: "long-command", command: "long-command" },
            },
          }) + "\n",
        );
        await expect(started).resolves.toMatchObject({
          item: { callId: "long-command", status: "running" },
        });
        const settled = waitForNextTimelineItem(session);
        appServer.completeTurn({ status });
        const expected = status === "completed" ? "completed" : "canceled";
        const settledEvent = await settled;
        expect(settledEvent).toMatchObject({
          item: { callId: "long-command", status: expected, detail: { command: "long-command" } },
        });
        expect(settledEvent).not.toHaveProperty("item.detail.exitCode");
        const lastTypes = events.slice(-2).map((event) => event.type);
        const terminal = {
          completed: "turn_completed",
          failed: "turn_failed",
          interrupted: "turn_canceled",
        }[status];
        expect(lastTypes).toEqual(["timeline", terminal]);
      } finally {
        await session.close();
      }
    },
  );
});
