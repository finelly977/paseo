import { useMemo } from "react";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { StreamItem } from "@/types/stream";
import { useSessionStore } from "@/stores/session-store";
import {
  nativeHistoryDetailKey,
  nativeHistoryDetailRevision,
  useNativeHistoryDetails,
} from "./native-history-details";
import { presentNativeHistoryActiveTurn } from "./native-history-presentation";

const EMPTY_DETAILS: AgentTimelineItem[] = [];
const EMPTY_HEAD: StreamItem[] = [];

export function useNativeHistoryActiveTurn(input: {
  serverId: string;
  agentId: string;
  tail: StreamItem[];
  head: StreamItem[] | undefined;
  activeTurnId: string | null;
}) {
  const process = input.tail.findLast(
    (entry): entry is Extract<StreamItem, { kind: "native_history_process" }> =>
      entry.kind === "native_history_process" && entry.status === "inProgress",
  );
  const readId = useSessionStore(
    (state) =>
      state.sessions[input.serverId]?.agentNativeHistory.get(input.agentId)?.readId ?? null,
  );
  const key =
    process && readId
      ? nativeHistoryDetailKey(input.serverId, input.agentId, readId, process.turnId)
      : "";
  const cached = useNativeHistoryDetails((state) => state.entries.get(key));
  const current =
    process && cached?.revision === nativeHistoryDetailRevision(process) ? cached : undefined;
  const details = current?.items ?? EMPTY_DETAILS;
  return useMemo(
    () =>
      presentNativeHistoryActiveTurn({
        tail: input.tail,
        head: input.head ?? EMPTY_HEAD,
        activeTurnId: input.activeTurnId,
        process,
        details,
        error: current?.error,
      }),
    [input.tail, input.head, input.activeTurnId, process, details, current?.error],
  );
}
