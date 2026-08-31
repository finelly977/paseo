import { describe, expect, it } from "vitest";
import { collectRuntimeProtectedAgentIds } from "./agent-runtime-protection.js";

function session(
  activity: {
    focusedAgentId: string | null;
    appVisible: boolean;
    appFocused: boolean;
  },
  viewedAgentIds: string[] = [],
) {
  return {
    getClientActivity: () => activity,
    getViewedTimelineAgentIds: () => viewedAgentIds,
  };
}

describe("智能体运行时自动回收保护", () => {
  it("合并定时任务目标和所有已连接客户端当前选中的会话", () => {
    const protectedAgentIds = collectRuntimeProtectedAgentIds({
      scheduledAgentIds: new Set(["scheduled-agent"]),
      sessions: [
        session({ focusedAgentId: "visible-agent", appVisible: true, appFocused: true }),
        session({ focusedAgentId: "background-agent", appVisible: false, appFocused: false }),
        session({ focusedAgentId: null, appVisible: true, appFocused: true }, ["split-pane-agent"]),
      ],
    });

    expect(protectedAgentIds).toEqual(
      new Set(["scheduled-agent", "visible-agent", "background-agent", "split-pane-agent"]),
    );
  });

  it("没有心跳状态的连接不会产生无效保护标识", () => {
    const protectedAgentIds = collectRuntimeProtectedAgentIds({
      scheduledAgentIds: [],
      sessions: [{ getClientActivity: () => null, getViewedTimelineAgentIds: () => [] }],
    });

    expect(protectedAgentIds).toEqual(new Set());
  });
});
