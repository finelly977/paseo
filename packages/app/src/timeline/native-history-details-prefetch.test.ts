import { expect, test, vi } from "vitest";
import { useSessionStore } from "@/stores/session-store";
import type { NativeHistoryProcessItem } from "@/types/stream";
import { createNativeHistoryDetailsPrefetch } from "./native-history-details-prefetch";
import { nativeHistoryDetailKey, useNativeHistoryDetails } from "./native-history-details";

test("摘要先完成再预取，后来上翻的过程也自动读完，释放清除共享缓存", async () => {
  const host = "prefetch-host";
  const agent = "agent";
  const store = useSessionStore.getState();
  store.initializeSession(host, null);
  const item: NativeHistoryProcessItem = {
    kind: "native_history_process",
    id: "one",
    turnId: "one",
    status: "interrupted",
    durationMs: 1000,
    error: null,
    timestamp: new Date(1000),
    summaryMessageIds: [],
    summaryRevision: "original",
  };
  useSessionStore.getState().sessions[host].agentNativeHistory.set(agent, {
    readId: "read",
    nextCursor: "older",
    firstTurnId: "one",
  });
  store.setAgentStreamTail(host, new Map([[agent, [{ ...item, nativeTurnId: "one" }]]]));
  const calls: string[] = [];
  const scheduler = createNativeHistoryDetailsPrefetch({
    serverId: host,
    prepare: () => undefined,
    client: {
      readNativeHistoryTurn: async (request) => {
        calls.push(request.turnId);
        return { ...request, requestId: "request", error: null, items: [], nextCursor: null };
      },
    },
  });
  try {
    scheduler.afterRead({ agentId: agent, direction: "tail", turnIds: ["one"] });
    expect(calls).toEqual([]);
    scheduler.start(agent);
    await vi.waitFor(() => expect(calls).toEqual(["one"]));
    await vi.waitFor(() =>
      expect(
        useNativeHistoryDetails
          .getState()
          .entries.get(nativeHistoryDetailKey(host, agent, "read", "one"))?.complete,
      ).toBe(true),
    );
    store.setAgentStreamTail(
      host,
      new Map([
        [
          agent,
          [
            { ...item, id: "old", turnId: "old", nativeTurnId: "old" },
            ...(useSessionStore.getState().sessions[host].agentStreamTail.get(agent) ?? []),
          ],
        ],
      ]),
    );
    await vi.waitFor(() => expect(calls).toEqual(["one", "old"]));
    store.releaseAgentMemory(host, agent);
    expect(
      [...useNativeHistoryDetails.getState().entries.values()].filter(
        (entry) => entry.serverId === host,
      ),
    ).toEqual([]);
  } finally {
    scheduler.dispose();
    store.clearSession(host);
  }
});

test("重新核对最新页时，即使摘要标识和正文不变，也重新验证中断过程中的改写", async () => {
  const host = "revalidate-host";
  const agent = "agent";
  const store = useSessionStore.getState();
  store.initializeSession(host, null);
  const process: NativeHistoryProcessItem = {
    kind: "native_history_process",
    id: "process",
    turnId: "turn",
    status: "interrupted",
    durationMs: 1000,
    error: null,
    timestamp: new Date(1000),
    summaryMessageIds: ["user"],
    summaryRevision: "unchanged-summary",
  };
  useSessionStore.getState().sessions[host].agentNativeHistory.set(agent, {
    readId: "read",
    nextCursor: null,
    firstTurnId: "turn",
  });
  store.setAgentStreamTail(host, new Map([[agent, [{ ...process, nativeTurnId: "turn" }]]]));
  let text = "中断前的旧说明";
  const calls: string[] = [];
  const scheduler = createNativeHistoryDetailsPrefetch({
    serverId: host,
    prepare: () => undefined,
    client: {
      readNativeHistoryTurn: async (request) => {
        calls.push(request.turnId);
        return {
          ...request,
          requestId: "request",
          error: null,
          items: [{ type: "assistant_message", messageId: "partial", text }],
          nextCursor: null,
        };
      },
    },
  });
  const key = nativeHistoryDetailKey(host, agent, "read", "turn");
  try {
    scheduler.start(agent);
    await vi.waitFor(() =>
      expect(useNativeHistoryDetails.getState().entries.get(key)?.items).toEqual([
        { type: "assistant_message", messageId: "partial", text: "中断前的旧说明" },
      ]),
    );
    scheduler.beforeRead(agent, "tail");
    text = "另一客户端改写后的说明";
    scheduler.afterRead({ agentId: agent, direction: "tail", turnIds: ["turn"] });
    scheduler.start(agent);
    await vi.waitFor(() =>
      expect(useNativeHistoryDetails.getState().entries.get(key)?.items).toEqual([
        { type: "assistant_message", messageId: "partial", text: "另一客户端改写后的说明" },
      ]),
    );
    expect(calls).toEqual(["turn", "turn"]);
  } finally {
    scheduler.dispose();
    store.clearSession(host);
  }
});

test("同一摘要核对期间旧过程请求迟到，不发布旧说明并重新读取最新过程", async () => {
  const host = "refresh-race-host";
  const agent = "agent";
  const store = useSessionStore.getState();
  store.initializeSession(host, null);
  const process: NativeHistoryProcessItem = {
    kind: "native_history_process",
    id: "process",
    turnId: "turn",
    status: "interrupted",
    durationMs: 1000,
    error: null,
    timestamp: new Date(1000),
    summaryMessageIds: ["user"],
    summaryRevision: "unchanged",
  };
  useSessionStore.getState().sessions[host].agentNativeHistory.set(agent, {
    readId: "read",
    nextCursor: null,
    firstTurnId: "turn",
  });
  store.setAgentStreamTail(host, new Map([[agent, [{ ...process, nativeTurnId: "turn" }]]]));
  const oldRequest = Promise.withResolvers<void>();
  const calls: string[] = [];
  const scheduler = createNativeHistoryDetailsPrefetch({
    serverId: host,
    prepare: () => undefined,
    client: {
      readNativeHistoryTurn: async (request) => {
        const first = calls.length === 0;
        calls.push(request.turnId);
        if (first) await oldRequest.promise;
        const text = first ? "迟到的旧说明" : "最新说明";
        return {
          ...request,
          requestId: "request",
          error: null,
          items: [{ type: "assistant_message", messageId: "partial", text }],
          nextCursor: null,
        };
      },
    },
  });
  const key = nativeHistoryDetailKey(host, agent, "read", "turn");
  const observed: string[] = [];
  const unsubscribe = useNativeHistoryDetails.subscribe((state) => {
    const details = state.entries.get(key);
    if (!details) return;
    for (const entry of details.items)
      if (entry.type === "assistant_message") observed.push(entry.text);
  });
  try {
    scheduler.start(agent);
    expect(calls).toEqual(["turn"]);
    scheduler.beforeRead(agent, "tail");
    scheduler.afterRead({ agentId: agent, direction: "tail", turnIds: ["turn"] });
    scheduler.start(agent);
    oldRequest.resolve();
    await vi.waitFor(() =>
      expect(useNativeHistoryDetails.getState().entries.get(key)?.items).toEqual([
        { type: "assistant_message", messageId: "partial", text: "最新说明" },
      ]),
    );
    expect(calls).toEqual(["turn", "turn"]);
    expect(observed).not.toContain("迟到的旧说明");
  } finally {
    oldRequest.resolve();
    unsubscribe();
    scheduler.dispose();
    store.clearSession(host);
  }
});
