import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/stores/session-store";
import { TIMELINE_FETCH_PAGE_SIZE } from "@/timeline/timeline-fetch-policy";
import type { HostRuntimeStore } from "@/runtime/host-runtime";
import { getInitDeferred, getInitKey, resolveInitDeferred } from "@/utils/agent-initialization";
import {
  createSetAgentInitializing,
  ensureAgentIsInitialized,
  refreshAgentInitializationTimeout,
  refreshAgent,
  type RefreshAgentInput,
} from "./use-agent-initialization";

const serverId = "server-1";
const agentId = "agent-1";

class FakeDaemonClient {
  readonly refreshedAgentIds: string[] = [];

  refreshAgent: NonNullable<RefreshAgentInput["client"]>["refreshAgent"] = async (
    requestedAgentId,
  ) => {
    this.refreshedAgentIds.push(requestedAgentId);
    return {
      status: "agent_refreshed",
      agentId: requestedAgentId,
      requestId: "refresh-test",
      timelineSize: 0,
    };
  };
}

class FakeTimelineRuntime {
  readonly requests: Array<{
    serverId: string;
    agentId: string;
    request: Parameters<HostRuntimeStore["fetchAgentTimeline"]>[2];
  }> = [];

  fetchAgentTimeline: HostRuntimeStore["fetchAgentTimeline"] = async (
    requestedServerId,
    requestedAgentId,
    request,
  ) => {
    this.requests.push({ serverId: requestedServerId, agentId: requestedAgentId, request });
    return {
      requestId: "timeline-test",
      agentId: requestedAgentId,
      agent: null,
      direction: "tail",
      projection: "projected",
      epoch: "test-epoch",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 0, maxSeq: 0, nextSeq: 1 },
      startCursor: null,
      endCursor: null,
      hasOlder: false,
      hasNewer: false,
      entries: [],
      error: null,
    };
  };
}

function bindSetAgentInitializing() {
  return createSetAgentInitializing(serverId, useSessionStore.getState().setInitializingAgents);
}

afterEach(() => {
  resolveInitDeferred(getInitKey(serverId, agentId));
  useSessionStore.setState({ sessions: {}, agentLastActivity: new Map() });
  vi.restoreAllMocks();
});

describe("ensureAgentIsInitialized", () => {
  it("requests bounded projected catch-up after the current cursor when authoritative history is loaded", () => {
    const client = new FakeDaemonClient();
    const runtime = new FakeTimelineRuntime();
    useSessionStore.getState().initializeSession(serverId, client as never);
    useSessionStore
      .getState()
      .setAgentTimelineCursor(
        serverId,
        new Map([[agentId, { epoch: "epoch-1", startSeq: 1, endSeq: 42 }]]),
      );
    useSessionStore.getState().setAgentAuthoritativeHistoryApplied(serverId, agentId, true);

    void ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing: bindSetAgentInitializing(),
      conversationLimit: 50,
    });

    expect(runtime.requests).toEqual([
      {
        serverId,
        agentId,
        request: {
          direction: "after",
          cursor: { epoch: "epoch-1", seq: 42 },
          limit: TIMELINE_FETCH_PAGE_SIZE,
          projection: "projected",
        },
      },
    ]);
    expect(getInitDeferred(getInitKey(serverId, agentId))?.requestDirection).toBe("after");
  });

  it("requests a bounded projected tail when no authoritative cursor is available", () => {
    const client = new FakeDaemonClient();
    const runtime = new FakeTimelineRuntime();
    useSessionStore.getState().initializeSession(serverId, client as never);

    void ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing: bindSetAgentInitializing(),
      conversationLimit: 50,
    });

    expect(runtime.requests).toEqual([
      {
        serverId,
        agentId,
        request: {
          direction: "tail",
          limit: TIMELINE_FETCH_PAGE_SIZE,
          conversationLimit: 50,
          projection: "projected",
        },
      },
    ]);
    expect(getInitDeferred(getInitKey(serverId, agentId))?.requestDirection).toBe("tail");
  });

  it("times out initialization after 65 seconds", async () => {
    vi.useFakeTimers();
    const client = new FakeDaemonClient();
    const runtime = new FakeTimelineRuntime();
    useSessionStore.getState().initializeSession(serverId, client as never);

    const promise = ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing: bindSetAgentInitializing(),
    });

    vi.advanceTimersByTime(64_999);
    expect(getInitDeferred(getInitKey(serverId, agentId))).toBeDefined();

    vi.advanceTimersByTime(1);

    await expect(promise).rejects.toThrow("History sync timed out after 65s");
    expect(getInitDeferred(getInitKey(serverId, agentId))).toBeUndefined();
    expect(useSessionStore.getState().sessions[serverId]?.initializingAgents.get(agentId)).toBe(
      false,
    );
    vi.useRealTimers();
  });

  it("refreshes the initialization timeout after paged catch-up progress", async () => {
    vi.useFakeTimers();
    const client = new FakeDaemonClient();
    const runtime = new FakeTimelineRuntime();
    useSessionStore.getState().initializeSession(serverId, client as never);
    const setAgentInitializing = bindSetAgentInitializing();
    const key = getInitKey(serverId, agentId);

    const promise = ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing,
    });

    vi.advanceTimersByTime(64_999);
    refreshAgentInitializationTimeout({ key, agentId, setAgentInitializing });

    vi.advanceTimersByTime(1);
    expect(getInitDeferred(key)).toBeDefined();

    const rejection = expect(promise).rejects.toThrow("History sync timed out after 65s");

    vi.advanceTimersByTime(64_998);
    expect(getInitDeferred(key)).toBeDefined();

    vi.advanceTimersByTime(1);

    await rejection;
    expect(getInitDeferred(key)).toBeUndefined();
    vi.useRealTimers();
  });
});

describe("refreshAgent", () => {
  it("重复重载合并恢复和尾页请求，完成后读取最新本地游标", async () => {
    const release = Promise.withResolvers<void>();
    const refreshed: string[] = [];
    const client: NonNullable<RefreshAgentInput["client"]> = {
      refreshAgent: async (id) => {
        refreshed.push(id);
        await release.promise;
        return {
          status: "agent_refreshed",
          agentId: id,
          requestId: "shared-refresh",
          timelineSize: 0,
        };
      },
    };
    const runtime = new FakeTimelineRuntime();
    const initializing: boolean[] = [];
    let cursorSeq = 400;
    const input = {
      serverId,
      agentId,
      client,
      runtime,
      setAgentInitializing: (_id: string, value: boolean) => {
        initializing.push(value);
      },
      readCursor: () => ({ epoch: "old", startSeq: 1, endSeq: cursorSeq }),
    };
    const first = refreshAgent(input);
    const second = refreshAgent(input);
    cursorSeq = 410;
    release.resolve();
    await Promise.all([first, second]);
    expect(refreshed).toEqual([agentId]);
    expect(initializing).toEqual([true]);
    expect(runtime.requests).toEqual([
      {
        serverId,
        agentId,
        request: {
          direction: "tail",
          limit: 40,
          projection: "projected",
          cursor: { epoch: "old", seq: 410 },
        },
      },
    ]);
  });
  it("重载失败清除等待状态，同一连接下一次点击可以重试", async () => {
    let attempts = 0;
    const failure = new Error("提供方恢复失败");
    const client: NonNullable<RefreshAgentInput["client"]> = {
      refreshAgent: async (id) => {
        attempts += 1;
        if (attempts === 1) throw failure;
        return {
          status: "agent_refreshed",
          agentId: id,
          requestId: "retry-refresh",
          timelineSize: 0,
        };
      },
    };
    const runtime = new FakeTimelineRuntime();
    const initializing: boolean[] = [];
    const input: RefreshAgentInput = {
      serverId,
      agentId,
      client,
      runtime,
      setAgentInitializing: (_id, value) => {
        initializing.push(value);
      },
      readCursor: () => undefined,
    };
    await expect(refreshAgent(input)).rejects.toBe(failure);
    expect(initializing).toEqual([true, false]);
    expect(runtime.requests).toEqual([]);
    await refreshAgent(input);
    expect(attempts).toBe(2);
    expect(initializing).toEqual([true, false, true]);
    expect(runtime.requests).toHaveLength(1);
  });
  it("fetches a bounded projected tail after refreshing the agent", async () => {
    const client = new FakeDaemonClient();
    const runtime = new FakeTimelineRuntime();
    useSessionStore.getState().initializeSession(serverId, client as never);

    await refreshAgent({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing: bindSetAgentInitializing(),
      conversationLimit: 50,
      readCursor: () => undefined,
    });

    expect(client.refreshedAgentIds).toEqual([agentId]);
    expect(runtime.requests).toEqual([
      {
        serverId,
        agentId,
        request: {
          direction: "tail",
          limit: TIMELINE_FETCH_PAGE_SIZE,
          conversationLimit: 50,
          projection: "projected",
        },
      },
    ]);
  });
});
