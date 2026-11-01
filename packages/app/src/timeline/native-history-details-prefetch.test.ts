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
    scheduler.schedule(agent);
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
