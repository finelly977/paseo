import { useCallback, useMemo } from "react";
import { usePendingArchiveAgentIds } from "@/hooks/use-archive-agent";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { refreshProviderSubagents, useProviderSubagentStore } from "./provider-store";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import { useFetchQuery } from "@/data/query";
import { queryClient } from "@/data/query-client";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useProviderSubagentArchiveStore } from "./provider-subagent-archive-store";

export interface PaseoSubagentRow {
  kind: "paseo";
  id: Agent["id"];
  provider: Agent["provider"];
  title: Agent["title"];
  status: Agent["status"];
  requiresAttention: Agent["requiresAttention"];
  createdAt: Agent["createdAt"];
}

export interface ProviderSubagentRow {
  kind: "provider";
  id: string;
  parentAgentId: string;
  provider: ProviderSubagentDescriptorPayload["provider"];
  title: string | null;
  status: ProviderSubagentDescriptorPayload["status"];
  requiresAttention: boolean;
  createdAt: Date;
}

export type SubagentRow = PaseoSubagentRow | ProviderSubagentRow;

type SessionStoreSnapshot = ReturnType<typeof useSessionStore.getState>;
type ProviderSubagentStoreSnapshot = ReturnType<typeof useProviderSubagentStore.getState>;

interface SelectSubagentsParams {
  serverId: string;
  parentAgentId: string;
}

const EMPTY_SUBAGENT_ROWS: SubagentRow[] = [];
const EMPTY_PROVIDER_SUBAGENT_ROWS: ProviderSubagentRow[] = [];

function toSubagentRow(agent: Agent): SubagentRow {
  return {
    kind: "paseo",
    id: agent.id,
    provider: agent.provider,
    title: agent.title,
    status: agent.status,
    requiresAttention: agent.requiresAttention,
    createdAt: agent.createdAt,
  };
}

export function selectSubagentsForParent(
  state: SessionStoreSnapshot,
  params: SelectSubagentsParams,
  pendingArchiveIds: ReadonlySet<string>,
): SubagentRow[] {
  const agents = state.sessions[params.serverId]?.agents;
  if (!agents || agents.size === 0) {
    return EMPTY_SUBAGENT_ROWS;
  }

  const rows: SubagentRow[] = [];
  for (const agent of agents.values()) {
    if (
      agent.archivedAt ||
      pendingArchiveIds.has(agent.id) ||
      agent.parentAgentId !== params.parentAgentId
    ) {
      continue;
    }
    rows.push(toSubagentRow(agent));
  }

  if (rows.length === 0) {
    return EMPTY_SUBAGENT_ROWS;
  }

  rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  return rows;
}

export function selectProviderSubagentsForParent(
  state: ProviderSubagentStoreSnapshot,
  params: SelectSubagentsParams,
  supported: boolean,
  hiddenFromTrack: ReadonlySet<string>,
): ProviderSubagentRow[] {
  if (!supported) return EMPTY_PROVIDER_SUBAGENT_ROWS;
  const rows: ProviderSubagentRow[] = [];
  const prefix = `${params.serverId}\0${params.parentAgentId}\0`;
  for (const [key, subagent] of state.descriptors) {
    if (!key.startsWith(prefix) || hiddenFromTrack.has(key)) continue;
    rows.push({
      kind: "provider",
      id: subagent.id,
      parentAgentId: subagent.parentAgentId,
      provider: subagent.provider,
      title: subagent.title ?? subagent.description,
      status: subagent.status,
      requiresAttention: subagent.status === "failed",
      createdAt: new Date(subagent.createdAt),
    });
  }
  rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  return rows;
}

export function useSubagentsForParent(params: SelectSubagentsParams) {
  const pendingArchiveIds = usePendingArchiveAgentIds(params.serverId);
  const paseoRows = useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectSubagentsForParent(state, params, pendingArchiveIds),
    equal,
  );
  const supported = useSessionStore(
    (state) => state.sessions[params.serverId]?.serverInfo?.features?.providerSubagents === true,
  );
  const hiddenFromTrack = useProviderSubagentArchiveStore((state) => state.hiddenFromTrack);
  const archiveStateHydrated = useProviderSubagentArchiveStore((state) => state.hydrated);
  const providerRows = useStoreWithEqualityFn(
    useProviderSubagentStore,
    (state) =>
      selectProviderSubagentsForParent(
        state,
        params,
        supported && archiveStateHydrated,
        hiddenFromTrack,
      ),
    equal,
  );
  const client = useSessionStore((state) => state.sessions[params.serverId]?.client ?? null);
  const active = useRetainedPanelActive();
  const query = useFetchQuery(
    {
      queryKey: ["provider-subagent-list", params.serverId, params.parentAgentId],
      enabled: active && supported && archiveStateHydrated && client !== null,
      queryFn: async () => {
        if (!client) throw new Error("主机连接已断开，无法核对子智能体状态。");
        await refreshProviderSubagents(client, params.serverId, params.parentAgentId);
        return true;
      },
      dataShape: "value",
      staleTimeMs: 0,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      refetchInterval: providerRows.some((row) => row.status === "running") ? 10000 : false,
      refetchIntervalInBackground: false,
      retry: false,
    },
    queryClient,
  );
  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch({ cancelRefetch: false });
  }, [refetch]);
  const rows = useMemo(() => {
    if (providerRows.length === 0) return paseoRows;
    const combined = [...paseoRows, ...providerRows];
    combined.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    return combined;
  }, [paseoRows, providerRows]);
  return { rows, error: query.error, retry, isRefreshing: query.isFetching };
}
