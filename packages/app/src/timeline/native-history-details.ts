import { create } from "zustand";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { NativeHistoryProcessItem } from "@/types/stream";

export interface NativeHistoryDetails {
  serverId: string;
  agentId: string;
  turnId: string;
  revision: string;
  items: AgentTimelineItem[];
  nextCursor: string | null;
  complete: boolean;
  loading: boolean;
  error: string | null;
}

export const useNativeHistoryDetails = create<{ entries: Map<string, NativeHistoryDetails> }>(
  () => ({ entries: new Map() }),
);
const pendingByClient = new WeakMap<object, Map<string, Promise<void>>>();
const releaseVersions = new Map<string, number>();
const expandedViews = new Map<string, Set<symbol>>();
export function registerExpandedNativeHistoryDetails(key: string): () => void {
  const views = expandedViews.get(key) ?? new Set<symbol>();
  const token = Symbol();
  views.add(token);
  expandedViews.set(key, views);
  return () => {
    views.delete(token);
    if (views.size === 0) expandedViews.delete(key);
  };
}
const parentKey = (serverId: string, agentId: string) => JSON.stringify([serverId, agentId]);
export const nativeHistoryDetailKey = (
  serverId: string,
  agentId: string,
  readId: string,
  turnId: string,
) => JSON.stringify([serverId, agentId, readId, turnId]);
export const nativeHistoryDetailRevision = (item: NativeHistoryProcessItem) =>
  JSON.stringify([item.status, item.durationMs, item.summaryMessageIds]);

/** 详情只驻留内存，随所属用户轮裁剪；释放代际阻止迟到读取重新填入缓存。 */
export function pruneNativeHistoryDetails(
  serverId: string,
  agentId: string,
  retained: Set<string>,
): void {
  useNativeHistoryDetails.setState((state) => {
    const entries = new Map(state.entries);
    for (const [key, entry] of entries)
      if (entry.serverId === serverId && entry.agentId === agentId && !retained.has(entry.turnId))
        entries.delete(key);
    return entries.size === state.entries.size ? state : { entries };
  });
}

export function releaseNativeHistoryDetails(serverId: string, agentId: string): void {
  const parent = parentKey(serverId, agentId);
  releaseVersions.set(parent, (releaseVersions.get(parent) ?? 0) + 1);
  pruneNativeHistoryDetails(serverId, agentId, new Set());
}

export async function loadNativeHistoryDetails(input: {
  serverId: string;
  agentId: string;
  readId: string;
  item: NativeHistoryProcessItem;
  client: Pick<DaemonClient, "readNativeHistoryTurn">;
  isCurrent(): boolean;
  settle(): Promise<void>;
  prepare(): void;
}): Promise<void> {
  const key = nativeHistoryDetailKey(
    input.serverId,
    input.agentId,
    input.readId,
    input.item.turnId,
  );
  const revision = nativeHistoryDetailRevision(input.item);
  const parent = parentKey(input.serverId, input.agentId);
  const version = releaseVersions.get(parent) ?? 0;
  const current = () => (releaseVersions.get(parent) ?? 0) === version && input.isCurrent();
  if (!current()) return;
  const existing = useNativeHistoryDetails.getState().entries.get(key);
  if (existing?.revision === revision && existing.complete) return;
  const requestKey = JSON.stringify([key, revision, version]);
  let pending = pendingByClient.get(input.client);
  if (!pending) {
    pending = new Map();
    pendingByClient.set(input.client, pending);
  }
  const inFlight = pending.get(requestKey);
  if (inFlight) return inFlight;
  let details: NativeHistoryDetails =
    existing?.revision === revision
      ? existing
      : {
          serverId: input.serverId,
          agentId: input.agentId,
          turnId: input.item.turnId,
          revision,
          items: [],
          nextCursor: null,
          complete: false,
          loading: false,
          error: null,
        };
  const publish = () => {
    if (!current()) return;
    const previous = useNativeHistoryDetails.getState().entries.get(key);
    const restoresReply =
      details.complete &&
      !previous?.complete &&
      (input.item.status === "interrupted" || input.item.status === "failed") &&
      details.items.some(
        (entry) =>
          entry.type === "assistant_message" &&
          entry.text.trim().length > 0 &&
          (entry.messageId === undefined ||
            !input.item.summaryMessageIds.includes(entry.messageId)),
      );
    // 收起的普通过程只有数据变化，不捕捉或回写滚动位置，避免后台预取干扰用户滚轮。
    if (expandedViews.has(key) || restoresReply) input.prepare();
    useNativeHistoryDetails.setState((state) => ({
      entries: new Map(state.entries).set(key, details),
    }));
  };
  const task = (async () => {
    details = { ...details, loading: true, error: null };
    publish();
    const cursors = new Set<string | null>();
    try {
      while (!details.complete && current()) {
        const cursor = details.nextCursor;
        if (cursors.has(cursor)) throw new Error("原生处理过程分页游标重复。");
        cursors.add(cursor);
        const page = await input.client.readNativeHistoryTurn({
          agentId: input.agentId,
          readId: input.readId,
          turnId: input.item.turnId,
          cursor,
        });
        if (!current()) return;
        if (page.nextCursor !== null && cursors.has(page.nextCursor))
          throw new Error("原生处理过程分页游标没有前进。");
        details = {
          ...details,
          items: [...details.items, ...page.items],
          nextCursor: page.nextCursor,
          complete: page.nextCursor === null,
          loading: page.nextCursor !== null,
        };
        publish();
        await input.settle();
      }
    } catch (error) {
      if (current()) {
        details = {
          ...details,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        };
        publish();
      }
      throw error;
    }
  })();
  pending.set(requestKey, task);
  const clear = () => {
    if (pending.get(requestKey) === task) pending.delete(requestKey);
  };
  void task.then(clear, clear);
  return task;
}
