import { describe, expect, it } from "vitest";
import type { AgentScreenMissingState } from "@/hooks/use-agent-screen-state-machine";
import {
  clearHistorySyncErrorAfterSuccessfulSync,
  reconcileMissingAgentStateWithPresentAgent,
  shouldInitializeAgentPane,
  shouldResumeClosedRuntimeOnPaneEntry,
} from "./agent-panel-load-state";

describe("reconcileMissingAgentStateWithPresentAgent", () => {
  it("clears lookup-only states once the agent record is present", () => {
    expect(reconcileMissingAgentStateWithPresentAgent({ kind: "resolving" })).toEqual({
      kind: "idle",
    });
    expect(
      reconcileMissingAgentStateWithPresentAgent({
        kind: "not_found",
        message: "Agent not found: agent-1",
      }),
    ).toEqual({ kind: "idle" });
  });

  it("preserves history sync errors while the agent record is present", () => {
    const state: AgentScreenMissingState = {
      kind: "error",
      message: "Failed to get logs: session is archived",
    };

    expect(reconcileMissingAgentStateWithPresentAgent(state)).toBe(state);
  });
});

describe("clearHistorySyncErrorAfterSuccessfulSync", () => {
  it("clears a sync error after a later successful refresh", () => {
    expect(
      clearHistorySyncErrorAfterSuccessfulSync({
        kind: "error",
        message: "Failed to get logs: session is archived",
      }),
    ).toEqual({ kind: "idle" });
  });

  it("leaves non-error states alone", () => {
    const state: AgentScreenMissingState = { kind: "resolving" };

    expect(clearHistorySyncErrorAfterSuccessfulSync(state)).toBe(state);
  });
});

describe("shouldInitializeAgentPane", () => {
  it("已经回收但保留历史的会话再次打开时仍会恢复运行时", () => {
    expect(
      shouldInitializeAgentPane({
        hasAgentRecord: true,
        hasAuthoritativeHistory: true,
        shouldResumeClosedRuntime: true,
      }),
    ).toBe(true);
  });

  it("已加载历史的常驻会话不重复初始化", () => {
    expect(
      shouldInitializeAgentPane({
        hasAgentRecord: true,
        hasAuthoritativeHistory: true,
        shouldResumeClosedRuntime: false,
      }),
    ).toBe(false);
  });

  it("缺少智能体记录或权威历史时执行初始化", () => {
    expect(
      shouldInitializeAgentPane({
        hasAgentRecord: false,
        hasAuthoritativeHistory: true,
        shouldResumeClosedRuntime: false,
      }),
    ).toBe(true);
    expect(
      shouldInitializeAgentPane({
        hasAgentRecord: true,
        hasAuthoritativeHistory: false,
        shouldResumeClosedRuntime: false,
      }),
    ).toBe(true);
  });
});

describe("shouldResumeClosedRuntimeOnPaneEntry", () => {
  it("进入已经关闭的会话时恢复运行时", () => {
    expect(
      shouldResumeClosedRuntimeOnPaneEntry({
        visibleEntryKey: "server:agent",
        previousVisibleEntryKey: null,
        status: "closed",
      }),
    ).toBe(true);
  });

  it("当前面板内手动释放运行时后不会立即自动恢复", () => {
    expect(
      shouldResumeClosedRuntimeOnPaneEntry({
        visibleEntryKey: "server:agent",
        previousVisibleEntryKey: "server:agent",
        status: "closed",
      }),
    ).toBe(false);
  });
});
