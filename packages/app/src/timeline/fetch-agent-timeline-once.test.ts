import { expect, test } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  fetchAgentTimelineOnce,
  releaseAgentTimelineReads,
  isReleasedAgentTimelineResponse,
} from "./fetch-agent-timeline-once";

type TimelinePage = Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>;

test("concurrent identical timeline reads share one request", async () => {
  let resolvePage: (page: TimelinePage) => void = () => {};
  const page = new Promise<TimelinePage>((resolve) => {
    resolvePage = resolve;
  });
  const requests: Array<{ agentId: string; direction: string }> = [];
  const client = {
    fetchAgentTimeline: async (
      agentId: string,
      request: Parameters<DaemonClient["fetchAgentTimeline"]>[1],
    ) => {
      requests.push({ agentId, direction: request?.direction ?? "tail" });
      return page;
    },
  };
  const request = { direction: "tail" as const, limit: 100, projection: "projected" as const };

  const first = fetchAgentTimelineOnce(client, "agent", request);
  const second = fetchAgentTimelineOnce(client, "agent", request);
  resolvePage({ hasNewer: false } as TimelinePage);

  await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  expect(requests).toEqual([{ agentId: "agent", direction: "tail" }]);
});

test("释放后不复用旧请求，迟到响应在新一轮载入时仍被识别", async () => {
  const requests: string[] = [];
  const complete: Array<(page: TimelinePage) => void> = [];
  const client = {
    fetchAgentTimeline: (
      _agentId: string,
      request: Parameters<DaemonClient["fetchAgentTimeline"]>[1],
    ) => {
      if (!request?.requestId) throw new Error("测试需要请求标识");
      requests.push(request.requestId);
      return new Promise<TimelinePage>((resolve) => complete.push(resolve));
    },
  };
  const first = fetchAgentTimelineOnce(client, "agent", { direction: "tail" });
  releaseAgentTimelineReads(client, "agent");
  const second = fetchAgentTimelineOnce(client, "agent", { direction: "tail" });
  expect(requests).toHaveLength(2);
  expect(isReleasedAgentTimelineResponse(client, requests[0])).toBe(true);
  expect(isReleasedAgentTimelineResponse(client, requests[1])).toBe(false);
  const page = { hasNewer: false } as TimelinePage;
  complete[0](page);
  complete[1](page);
  await Promise.all([first, second]);
});
