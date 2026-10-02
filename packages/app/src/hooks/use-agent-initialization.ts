import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useSessionStore } from "@/stores/session-store";
import {
  createInitDeferred,
  getInitDeferred,
  getInitKey,
  INIT_TIMEOUT_MS,
  rejectInitDeferred,
  refreshInitTimeout,
} from "@/utils/agent-initialization";
import { getHostRuntimeStore, type HostRuntimeStore } from "@/runtime/host-runtime";
import { planInitialAgentTimelineSync, planTimelineTailFetch } from "@/timeline/timeline-sync-plan";
import type { AgentTimelineCursorRange } from "@/timeline/timeline-sync-plan";
import { i18n } from "@/i18n/i18next";

export type SetAgentInitializing = (agentId: string, initializing: boolean) => void;

export function createHistorySyncTimeoutError(): Error {
  return new Error(`History sync timed out after ${Math.round(INIT_TIMEOUT_MS / 1000)}s`);
}

export function refreshAgentInitializationTimeout(input: {
  key: string;
  agentId: string;
  setAgentInitializing: SetAgentInitializing;
}): void {
  refreshInitTimeout({
    key: input.key,
    onTimeout: () => {
      input.setAgentInitializing(input.agentId, false);
      rejectInitDeferred(input.key, createHistorySyncTimeoutError());
    },
  });
}

export interface EnsureAgentIsInitializedInput {
  serverId: string;
  agentId: string;
  client: Pick<DaemonClient, "fetchAgentTimeline"> | null;
  runtime: Pick<HostRuntimeStore, "fetchAgentTimeline">;
  setAgentInitializing: SetAgentInitializing;
  conversationLimit?: number;
  hostDisconnectedMessage?: string;
}

export function ensureAgentIsInitialized(input: EnsureAgentIsInitializedInput): Promise<void> {
  const { serverId, agentId, client, setAgentInitializing } = input;
  const key = getInitKey(serverId, agentId);
  const existing = getInitDeferred(key);
  if (existing) {
    return existing.promise;
  }

  const session = useSessionStore.getState().sessions[serverId];
  const cursor = session?.agentTimelineCursor.get(agentId);
  const hasAuthoritativeHistory = session?.agentAuthoritativeHistoryApplied.get(agentId) === true;
  const timelineRequest = planInitialAgentTimelineSync({
    cursor,
    hasAuthoritativeHistory,
    ...(input.conversationLimit !== undefined
      ? { conversationLimit: input.conversationLimit }
      : {}),
  });

  const deferred = createInitDeferred(key, timelineRequest.direction);
  refreshAgentInitializationTimeout({ key, agentId, setAgentInitializing });

  setAgentInitializing(agentId, true);

  if (!client) {
    setAgentInitializing(agentId, false);
    rejectInitDeferred(
      key,
      new Error(input.hostDisconnectedMessage ?? i18n.t("workspace.terminal.hostDisconnected")),
    );
    return deferred.promise;
  }

  input.runtime.fetchAgentTimeline(serverId, agentId, timelineRequest).catch((error) => {
    setAgentInitializing(agentId, false);
    rejectInitDeferred(key, error instanceof Error ? error : new Error(String(error)));
  });

  return deferred.promise;
}

export interface RefreshAgentInput {
  serverId: string;
  agentId: string;
  client: Pick<DaemonClient, "refreshAgent"> | null;
  runtime: Pick<HostRuntimeStore, "fetchAgentTimeline">;
  setAgentInitializing: SetAgentInitializing;
  conversationLimit?: number;
  hostDisconnectedMessage?: string;
  readCursor: () => AgentTimelineCursorRange | undefined;
}

const pendingRefreshes = new WeakMap<
  NonNullable<RefreshAgentInput["client"]>,
  Map<string, Promise<void>>
>();

export function refreshAgent(input: RefreshAgentInput): Promise<void> {
  const { serverId, agentId, client, runtime, setAgentInitializing } = input;
  if (!client) {
    return Promise.reject(
      new Error(input.hostDisconnectedMessage ?? i18n.t("workspace.terminal.hostDisconnected")),
    );
  }
  let pending = pendingRefreshes.get(client);
  if (!pending) {
    pending = new Map();
    pendingRefreshes.set(client, pending);
  }
  const key = getInitKey(serverId, agentId);
  const existing = pending.get(key);
  if (existing) return existing;
  setAgentInitializing(agentId, true);
  const refreshes = pending;
  const operation = (async () => {
    try {
      await client.refreshAgent(agentId);
      const cursor = input.readCursor();
      await runtime.fetchAgentTimeline(serverId, agentId, {
        ...planTimelineTailFetch(input.conversationLimit),
        ...(cursor ? { cursor: { epoch: cursor.epoch, seq: cursor.endSeq } } : {}),
      });
    } catch (error) {
      setAgentInitializing(agentId, false);
      throw error;
    } finally {
      refreshes.delete(key);
    }
  })();
  refreshes.set(key, operation);
  return operation;
}

export function createSetAgentInitializing(
  serverId: string,
  setInitializingAgents: ReturnType<typeof useSessionStore.getState>["setInitializingAgents"],
): SetAgentInitializing {
  return (agentId, initializing) => {
    setInitializingAgents(serverId, (prev) => {
      if (prev.get(agentId) === initializing) {
        return prev;
      }
      const next = new Map(prev);
      next.set(agentId, initializing);
      return next;
    });
  };
}

export function useAgentInitialization({
  serverId,
  client,
}: {
  serverId: string;
  client: DaemonClient | null;
}) {
  const { t } = useTranslation();
  const setInitializingAgents = useSessionStore((state) => state.setInitializingAgents);
  const conversationHistoryLoadCount = useSessionStore(
    (state) => state.conversationHistoryPolicy.perConversationLoadCount,
  );
  const supportsConversationHistoryLimit = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.conversationHistoryLimit === true,
  );
  const conversationLimit = supportsConversationHistoryLimit
    ? conversationHistoryLoadCount
    : undefined;
  const setAgentInitializing = useMemo(
    () => createSetAgentInitializing(serverId, setInitializingAgents),
    [serverId, setInitializingAgents],
  );

  const ensureAgentIsInitializedCallback = useCallback(
    (agentId: string): Promise<void> =>
      ensureAgentIsInitialized({
        serverId,
        agentId,
        client,
        runtime: getHostRuntimeStore(),
        setAgentInitializing,
        ...(conversationLimit !== undefined ? { conversationLimit } : {}),
        hostDisconnectedMessage: t("workspace.terminal.hostDisconnected"),
      }),
    [client, conversationLimit, serverId, setAgentInitializing, t],
  );

  const refreshAgentCallback = useCallback(
    (agentId: string): Promise<void> =>
      refreshAgent({
        serverId,
        agentId,
        client,
        runtime: getHostRuntimeStore(),
        setAgentInitializing,
        readCursor: () =>
          useSessionStore.getState().sessions[serverId]?.agentTimelineCursor.get(agentId),
        ...(conversationLimit !== undefined ? { conversationLimit } : {}),
        hostDisconnectedMessage: t("workspace.terminal.hostDisconnected"),
      }),
    [client, conversationLimit, serverId, setAgentInitializing, t],
  );

  return {
    ensureAgentIsInitialized: ensureAgentIsInitializedCallback,
    refreshAgent: refreshAgentCallback,
  };
}
