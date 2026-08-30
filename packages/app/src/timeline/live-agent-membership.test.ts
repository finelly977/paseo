import { expect, test } from "vitest";
import { selectLiveAgentTimelineIds } from "./live-agent-membership";

test("初始化和运行中会话始终保持时间线订阅", () => {
  expect(
    selectLiveAgentTimelineIds([
      { id: "idle", status: "idle" },
      { id: "running-b", status: "running" },
      { id: "closed", status: "closed" },
      { id: "initializing", status: "initializing" },
      { id: "error", status: "error" },
      { id: "running-a", status: "running" },
    ]),
  ).toEqual(["initializing", "running-a", "running-b"]);
});
