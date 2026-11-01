import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useSessionStore } from "@/stores/session-store";
import {
  loadNativeHistoryDetails,
  nativeHistoryDetailKey,
  nativeHistoryDetailRevision,
  pruneNativeHistoryDetails,
  useNativeHistoryDetails,
} from "./native-history-details";

/** 正文目标轮数就绪后才工作；保存原始详情，不挂载折叠中的命令视图。 */
export function createNativeHistoryDetailsPrefetch(input: {
  serverId: string;
  client: Pick<DaemonClient, "readNativeHistoryTurn">;
  prepare(agentId: string): void;
}) {
  const ready = new Set<string>();
  const running = new Set<string>();
  let active = true;
  const canRun = (agentId: string) => active && ready.has(agentId);
  const schedule = (agentId: string) => {
    const retained =
      useSessionStore.getState().sessions[input.serverId]?.agentStreamTail.get(agentId) ?? [];
    pruneNativeHistoryDetails(
      input.serverId,
      agentId,
      new Set(
        retained.flatMap((entry) => (entry.nativeTurnId === undefined ? [] : [entry.nativeTurnId])),
      ),
    );
    if (!active || !ready.has(agentId) || running.has(agentId)) return;
    running.add(agentId);
    void (async () => {
      try {
        while (canRun(agentId)) {
          const session = useSessionStore.getState().sessions[input.serverId];
          const native = session?.agentNativeHistory.get(agentId);
          if (!session || !native || session.releasedAgentIds.has(agentId)) return;
          const process = (session.agentStreamTail.get(agentId) ?? []).findLast((entry) => {
            if (entry.kind !== "native_history_process" || entry.status === "inProgress")
              return false;
            const cached = useNativeHistoryDetails
              .getState()
              .entries.get(
                nativeHistoryDetailKey(input.serverId, agentId, native.readId, entry.turnId),
              );
            return (
              !cached ||
              cached.revision !== nativeHistoryDetailRevision(entry) ||
              (!cached.complete && !cached.error)
            );
          });
          if (!process || process.kind !== "native_history_process") return;
          try {
            await loadNativeHistoryDetails({
              ...input,
              agentId,
              readId: native.readId,
              item: process,
              isCurrent: () => {
                const current = useSessionStore.getState().sessions[input.serverId];
                return (
                  active &&
                  ready.has(agentId) &&
                  !current?.releasedAgentIds.has(agentId) &&
                  current?.agentNativeHistory.get(agentId)?.readId === native.readId &&
                  (current.agentStreamTail.get(agentId) ?? []).includes(process)
                );
              },
              prepare: () => input.prepare(agentId),
              settle: () => new Promise((resolve) => setTimeout(resolve, 32)),
            });
          } catch (error) {
            console.error("后台补齐原生处理过程失败", { agentId, error });
          }
        }
      } finally {
        running.delete(agentId);
      }
    })();
  };
  const unsubscribe = useSessionStore.subscribe((state, previous) => {
    const tail = state.sessions[input.serverId]?.agentStreamTail;
    const oldTail = previous.sessions[input.serverId]?.agentStreamTail;
    if (tail === oldTail) return;
    for (const agentId of ready)
      if (tail?.get(agentId) !== oldTail?.get(agentId)) schedule(agentId);
  });
  return {
    schedule,
    start(agentId: string) {
      ready.add(agentId);
      schedule(agentId);
    },
    beforeRead(agentId: string, direction: "tail" | "before" | "after") {
      if (direction !== "before") ready.delete(agentId);
    },
    dispose() {
      active = false;
      ready.clear();
      unsubscribe();
    },
  };
}
