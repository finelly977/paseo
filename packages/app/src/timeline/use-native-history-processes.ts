import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSessionStore } from "@/stores/session-store";
import type { NativeHistoryProcessItem, StreamItem } from "@/types/stream";
import {
  nativeHistoryDetailKey,
  nativeHistoryDetailRevision,
  useNativeHistoryDetails,
} from "./native-history-details";
import { presentNativeHistoryProcesses } from "./native-history-presentation";

const EMPTY_EXPANDED = new Set<string>();

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
  const [expansion, setExpansion] = useState({ owner, turnIds: EMPTY_EXPANDED });
  useEffect(() => {
    setExpansion((previous) =>
      previous.owner === owner ? previous : { owner, turnIds: EMPTY_EXPANDED },
    );
  }, [owner]);
  const expandedTurnIds = expansion.owner === owner ? expansion.turnIds : EMPTY_EXPANDED;
  const toggle = useCallback(
    (turnId: string) => {
      setExpansion((previous) => {
        const next = new Set(previous.owner === owner ? previous.turnIds : EMPTY_EXPANDED);
        if (next.has(turnId)) next.delete(turnId);
        else next.add(turnId);
        return { owner, turnIds: next };
      });
    },
    [owner],
  );
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
        if (
          !readId ||
          (!expandedTurnIds.has(process.turnId) &&
            process.status !== "interrupted" &&
            process.status !== "failed")
        )
          return undefined;
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
        expandedTurnIds,
        detailsByTurn: new Map(
          details.flatMap((entry, index) => (entry ? [[processes[index].turnId, entry]] : [])),
        ),
      }),
    [input.tail, expandedTurnIds, details, processes],
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
  return { tail, expandedTurnIds, expandedItemIds, toggle };
}
