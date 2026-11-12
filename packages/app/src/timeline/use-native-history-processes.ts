import { useMemo } from "react";
import { useProcessExpansion } from "@/agent-stream/process-expansion";
import { useShallow } from "zustand/react/shallow";
import { useSessionStore } from "@/stores/session-store";
import type { NativeHistoryProcessItem, StreamItem } from "@/types/stream";
import {
  nativeHistoryDetailKey,
  nativeHistoryDetailRevision,
  useNativeHistoryDetails,
} from "./native-history-details";
import { presentNativeHistoryProcesses } from "./native-history-presentation";

export function useNativeHistoryProcesses(input: {
  serverId: string;
  agentId: string;
  tail: StreamItem[];
}) {
  const readId = useSessionStore(
    (state) =>
      state.sessions[input.serverId]?.agentNativeHistory.get(input.agentId)?.readId ?? null,
  );
  const owner = JSON.stringify([input.serverId, input.agentId, readId]);
  const expansion = useProcessExpansion(owner);
  const { expandedTurnIds, retainedTurnIds, toggle } = expansion;
  const processes = useMemo(
    () =>
      input.tail.filter(
        (item): item is NativeHistoryProcessItem =>
          item.kind === "native_history_process" && item.status !== "inProgress",
      ),
    [input.tail],
  );
  const details = useNativeHistoryDetails(
    useShallow((state) =>
      processes.map((process) => {
        if (!readId) return undefined;
        const entry = state.entries.get(
          nativeHistoryDetailKey(input.serverId, input.agentId, readId, process.turnId),
        );
        return entry?.revision === nativeHistoryDetailRevision(process) ? entry : undefined;
      }),
    ),
  );
  const tail = useMemo(
    () =>
      presentNativeHistoryProcesses({
        tail: input.tail,
        expandedTurnIds: retainedTurnIds,
        detailsByTurn: new Map(
          details.flatMap((entry, index) => (entry ? [[processes[index].turnId, entry]] : [])),
        ),
      }),
    [input.tail, retainedTurnIds, details, processes],
  );
  const expandedItemIds = useMemo(
    () =>
      new Set(
        processes
          .filter((process) => expandedTurnIds.has(process.turnId))
          .map((process) => process.id),
      ),
    [processes, expandedTurnIds],
  );
  return { ...expansion, tail, expandedItemIds, toggle };
}
