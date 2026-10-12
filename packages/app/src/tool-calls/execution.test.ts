import { describe, expect, it } from "vitest";
import type { ToolCallItem, StreamItem } from "@/types/stream";
import { activeToolCallIds, resolveToolCallStatus } from "./execution";

function tool(id: string, turnId: string, exitCode?: number): ToolCallItem {
  return {
    kind: "tool_call",
    id,
    turnId,
    timestamp: new Date(0),
    payload: {
      source: "agent",
      data: {
        provider: "codex",
        callId: id,
        name: "exec_command",
        status: "running",
        error: null,
        detail: { type: "shell", command: "echo test", exitCode },
      },
    },
  };
}

describe("工具运行状态展示", () => {
  it("回合结束后停止缺失结束结果的工具动效，不伪造输出", () => {
    const call = tool("one", "turn-1");
    expect([
      ...activeToolCallIds({ tail: [call], head: [], running: false, turnId: null }),
    ]).toEqual([]);
    expect(call.payload.data.status).toBe("running");
    expect(call.payload.source === "agent" && call.payload.data.detail).toEqual({
      type: "shell",
      command: "echo test",
      exitCode: undefined,
    });
  });
  it("只允许当前原生回合继续动效，steer 消息不截断同回合命令", () => {
    const steer: StreamItem = {
      kind: "user_message",
      id: "steer",
      text: "补充",
      timestamp: new Date(1),
      turnId: "turn-2",
    };
    const calls = [tool("old", "turn-1"), tool("current", "turn-2"), steer];
    expect([
      ...activeToolCallIds({ tail: calls, head: [], running: true, turnId: "turn-2" }),
    ]).toEqual(["current"]);
  });
  it("已有退出码的命令立即停止动效，并按真实退出码展示结果", () => {
    expect([
      ...activeToolCallIds({
        tail: [tool("done", "turn-1", 0)],
        head: [],
        running: true,
        turnId: "turn-1",
      }),
    ]).toEqual([]);
    expect(resolveToolCallStatus("running", { type: "shell", command: "test", exitCode: 0 })).toBe(
      "completed",
    );
    expect(resolveToolCallStatus("running", { type: "shell", command: "test", exitCode: 1 })).toBe(
      "failed",
    );
    expect(
      resolveToolCallStatus("running", { type: "shell", command: "test", exitCode: null }),
    ).toBe("running");
  });
});
