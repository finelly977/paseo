import { expect, test } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  fetchAgentTimelineOnce,
  releaseAgentTimelineReads,
  isReleasedAgentTimelineResponse,
  getAgentTimelineReadCursor,
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

test("滚动与自动预取读取同一原生页时，字段顺序不同也只发送一次", async () => {
  const gate = Promise.withResolvers<TimelinePage>();
  let requests = 0;
  const client = {
    fetchAgentTimeline: async () => {
      requests++;
      return gate.promise;
    },
  };
  const first = fetchAgentTimelineOnce(client, "agent", {
    direction: "before",
    limit: 20,
    projection: "projected",
    nativeHistory: { readId: "native", cursor: "older" },
  });
  const second = fetchAgentTimelineOnce(client, "agent", {
    nativeHistory: { cursor: "older", readId: "native" },
    projection: "projected",
    direction: "before",
    limit: 20,
  });
  expect(requests).toBe(1);
  gate.resolve({ hasNewer: false } as TimelinePage);
  await Promise.all([first, second]);
});

test("同一读取保留发送前的实时边界，不把后加入调用者的新事件算进旧快照", async () => {
  const gate = Promise.withResolvers<TimelinePage>();
  let requestId = "";
  const client = {
    fetchAgentTimeline: async (
      _agentId: string,
      request: Parameters<DaemonClient["fetchAgentTimeline"]>[1],
    ) => {
      if (!request?.requestId) throw new Error("缺少请求标识");
      requestId = request.requestId;
      return gate.promise;
    },
  };
  const first = fetchAgentTimelineOnce(
    client,
    "agent",
    { direction: "tail" },
    { epoch: "epoch", endSeq: 10 },
  );
  const second = fetchAgentTimelineOnce(
    client,
    "agent",
    { direction: "tail" },
    { epoch: "epoch", endSeq: 20 },
  );
  expect(getAgentTimelineReadCursor(client, requestId)).toEqual({ epoch: "epoch", endSeq: 10 });
  gate.resolve({ hasNewer: false } as TimelinePage);
  await Promise.all([first, second]);
  expect(getAgentTimelineReadCursor(client, requestId)).toBeUndefined();
});
