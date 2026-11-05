import type {
  AgentStreamEventPayload,
  ProviderSubagentDescriptorPayload,
  SessionOutboundMessage,
} from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { create } from "zustand";
import { applyStreamEvent } from "@/types/stream";
import type { StreamItem } from "@/types/stream";
import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";
import { useProviderSubagentArchiveStore } from "./provider-subagent-archive-store";

type ProviderSubagentTimelineItem = Extract<
  Extract<SessionOutboundMessage, { type: "agent.provider_subagents.update" }>["payload"],
  { kind: "timeline" }
>["item"];

interface ProviderSubagentTimelineRow {
  provider: ProviderSubagentDescriptorPayload["provider"];
  item: ProviderSubagentTimelineItem;
  timestamp: string;
}

export interface ProviderSubagentTimelineState {
  tail: StreamItem[];
  head: StreamItem[];
  epoch: string | null;
  lastSeq: number;
  hasOlder: boolean;
  rows: Map<number, ProviderSubagentTimelineRow>;
}

interface ProviderSubagentState {
  releaseParent(serverId: string, parentAgentId: string): void;
  descriptors: Map<string, ProviderSubagentDescriptorPayload>;
  timelines: Map<string, ProviderSubagentTimelineState>;
  hideFinishedForParent(serverId: string, parentAgentId: string): void;
  replaceList(
    serverId: string,
    parentAgentId: string,
    subagents: ProviderSubagentDescriptorPayload[],
  ): void;
  applyUpdate(
    serverId: string,
    payload: Extract<
      SessionOutboundMessage,
      { type: "agent.provider_subagents.update" }
    >["payload"],
  ): void;
  replaceTimeline(
    serverId: string,
    payload: Extract<
      SessionOutboundMessage,
      { type: "agent.provider_subagents.timeline.get.response" }
    >["payload"],
  ): void;
}

export function providerSubagentKey(
  serverId: string,
  parentAgentId: string,
  subagentId: string,
): string {
  return `${serverId}\0${parentAgentId}\0${subagentId}`;
}

export function providerSubagentLifecycleStatus(
  status: ProviderSubagentDescriptorPayload["status"],
): AgentLifecycleStatus {
  if (status === "running") return "running";
  if (status === "failed") return "error";
  return "idle";
}

type ProviderSubagentListClient = Pick<DaemonClient, "listProviderSubagents">;

interface PendingProviderList {
  version: number;
  promise: Promise<void>;
}
const pendingListRequests = new WeakMap<
  ProviderSubagentListClient,
  Map<string, PendingProviderList>
>();
const parentReleases = new Map<string, number>();

export async function fetchProviderSubagentTimeline(
  client: Pick<DaemonClient, "fetchProviderSubagentTimeline">,
  serverId: string,
  parentAgentId: string,
  subagentId: string,
  options: Parameters<DaemonClient["fetchProviderSubagentTimeline"]>[2],
): Promise<void> {
  const requestKey = `${serverId}\0${parentAgentId}`;
  const releaseVersion = parentReleases.get(requestKey) ?? 0;
  const payload = await client.fetchProviderSubagentTimeline(parentAgentId, subagentId, options);
  if ((parentReleases.get(requestKey) ?? 0) !== releaseVersion) return;
  if (payload.error) throw new Error(payload.error);
  useProviderSubagentStore.getState().replaceTimeline(serverId, payload);
}

export function refreshProviderSubagents(
  client: ProviderSubagentListClient,
  serverId: string,
  parentAgentId: string,
): Promise<void> {
  const requestKey = `${serverId}\0${parentAgentId}`;
  const releaseVersion = parentReleases.get(requestKey) ?? 0;
  let clientRequests = pendingListRequests.get(client);
  if (!clientRequests) {
    clientRequests = new Map();
    pendingListRequests.set(client, clientRequests);
  }
  const pending = clientRequests.get(requestKey);
  if (pending?.version === releaseVersion) return pending.promise;

  const request = client
    .listProviderSubagents(parentAgentId)
    .then((payload) => {
      if ((parentReleases.get(requestKey) ?? 0) !== releaseVersion) return;
      if (payload.error) throw new Error(payload.error);
      useProviderSubagentStore.getState().replaceList(serverId, parentAgentId, payload.subagents);
      return undefined;
    })
    .finally(() => {
      if (clientRequests.get(requestKey)?.promise === request) clientRequests.delete(requestKey);
    });
  clientRequests.set(requestKey, { version: releaseVersion, promise: request });
  return request;
}

function parentPrefix(serverId: string, parentAgentId: string): string {
  return `${serverId}\0${parentAgentId}\0`;
}

function preferCurrentDescriptor(
  previous: ProviderSubagentDescriptorPayload | undefined,
  incoming: ProviderSubagentDescriptorPayload,
): ProviderSubagentDescriptorPayload {
  if (!previous) return incoming;
  if (previous.updatedAt > incoming.updatedAt) return previous;
  if (
    previous.updatedAt === incoming.updatedAt &&
    previous.status !== "running" &&
    incoming.status === "running"
  )
    return previous;
  return incoming;
}

const EMPTY_TIMELINE: ProviderSubagentTimelineState = {
  tail: [],
  head: [],
  epoch: null,
  lastSeq: 0,
  hasOlder: false,
  rows: new Map(),
};

function providerSubagentTerminalEvent(
  subagent: ProviderSubagentDescriptorPayload,
): AgentStreamEventPayload | null {
  if (subagent.status === "running") {
    return null;
  }
  if (subagent.status === "failed") {
    return { type: "turn_failed", provider: subagent.provider, error: "Subagent failed" };
  }
  if (subagent.status === "canceled") {
    return { type: "turn_canceled", provider: subagent.provider, reason: "canceled" };
  }
  return { type: "turn_completed", provider: subagent.provider };
}

function buildTimelineState(
  rows: ProviderSubagentTimelineState["rows"],
  epoch: string | null,
  descriptor?: ProviderSubagentDescriptorPayload,
  hasOlder = false,
): ProviderSubagentTimelineState {
  let timeline = { tail: [] as StreamItem[], head: [] as StreamItem[] };
  for (const [, row] of [...rows].sort(([left], [right]) => left - right)) {
    timeline = applyStreamEvent({
      ...timeline,
      event: { type: "timeline", provider: row.provider, item: row.item },
      timestamp: new Date(row.timestamp),
    });
  }
  const terminalEvent = descriptor ? providerSubagentTerminalEvent(descriptor) : null;
  if (terminalEvent && descriptor) {
    timeline = applyStreamEvent({
      ...timeline,
      event: terminalEvent,
      timestamp: new Date(descriptor.updatedAt),
    });
  }
  return {
    ...timeline,
    epoch,
    lastSeq: rows.size ? Math.max(...rows.keys()) : 0,
    hasOlder,
    rows,
  };
}

function buildTimelineResponseRows(
  existing: ProviderSubagentTimelineState | undefined,
  payload: Extract<
    SessionOutboundMessage,
    { type: "agent.provider_subagents.timeline.get.response" }
  >["payload"],
  provider: ProviderSubagentDescriptorPayload["provider"],
): ProviderSubagentTimelineState["rows"] {
  const rows = new Map<number, ProviderSubagentTimelineRow>();
  for (const row of payload.rows) {
    rows.set(row.seq, { provider, item: row.item, timestamp: row.timestamp });
  }
  if (payload.reset || existing?.epoch !== payload.epoch) {
    return rows;
  }
  if (payload.direction !== "tail") {
    return new Map([...existing.rows, ...rows]);
  }

  let nextSeq = payload.rows.length
    ? Math.max(...payload.rows.map((row) => row.seq)) + 1
    : payload.window.maxSeq + 1;
  for (const [seq, row] of [...existing.rows].sort(([left], [right]) => left - right)) {
    if (seq < nextSeq) continue;
    if (seq !== nextSeq) break;
    rows.set(seq, row);
    nextSeq += 1;
  }
  return rows;
}

export const useProviderSubagentStore = create<ProviderSubagentState>((set) => ({
  releaseParent(serverId, parentAgentId) {
    const requestKey = `${serverId}\0${parentAgentId}`;
    parentReleases.set(requestKey, (parentReleases.get(requestKey) ?? 0) + 1);
    set((state) => {
      const prefix = parentPrefix(serverId, parentAgentId);
      return {
        descriptors: new Map([...state.descriptors].filter(([key]) => !key.startsWith(prefix))),
        timelines: new Map([...state.timelines].filter(([key]) => !key.startsWith(prefix))),
      };
    });
  },
  descriptors: new Map(),
  timelines: new Map(),
  hideFinishedForParent(serverId, parentAgentId) {
    const prefix = parentPrefix(serverId, parentAgentId);
    const finishedKeys = [...useProviderSubagentStore.getState().descriptors].flatMap(
      ([key, subagent]) => (key.startsWith(prefix) && subagent.status !== "running" ? [key] : []),
    );
    useProviderSubagentArchiveStore.getState().hide(finishedKeys);
  },
  replaceList(serverId, parentAgentId, subagents) {
    const revealedKeys: string[] = [];
    set((state) => {
      const prefix = parentPrefix(serverId, parentAgentId);
      const descriptors = new Map(
        [...state.descriptors].filter(([key]) => !key.startsWith(prefix)),
      );
      for (const incoming of subagents) {
        const key = providerSubagentKey(serverId, parentAgentId, incoming.id);
        const subagent = preferCurrentDescriptor(state.descriptors.get(key), incoming);
        descriptors.set(key, subagent);
        if (subagent.status === "running") revealedKeys.push(key);
      }
      const retainedKeys = new Set(descriptors.keys());
      const timelines = new Map(
        [...state.timelines].filter(([key]) => !key.startsWith(prefix) || retainedKeys.has(key)),
      );
      for (const incoming of subagents) {
        const key = providerSubagentKey(serverId, parentAgentId, incoming.id);
        const subagent = descriptors.get(key);
        if (!subagent) throw new Error("子智能体列表缺少已接收的描述信息");
        const current = timelines.get(key);
        const previous = state.descriptors.get(key);
        if (current && previous?.status !== subagent.status) {
          timelines.set(
            key,
            buildTimelineState(current.rows, current.epoch, subagent, current.hasOlder),
          );
        }
      }
      return { descriptors, timelines };
    });
    for (const key of revealedKeys) useProviderSubagentArchiveStore.getState().reveal(key);
  },
  applyUpdate(serverId, payload) {
    let revealedKey: string | null = null;
    set((state) => {
      if (payload.kind === "upsert") {
        const key = providerSubagentKey(
          serverId,
          payload.subagent.parentAgentId,
          payload.subagent.id,
        );
        const descriptors = new Map(state.descriptors);
        const previous = descriptors.get(key);
        const subagent = preferCurrentDescriptor(previous, payload.subagent);
        descriptors.set(key, subagent);
        if (subagent.status === "running") revealedKey = key;
        let timelines = state.timelines;
        const current = state.timelines.get(key);
        if (current && previous?.status !== subagent.status) {
          timelines = new Map(state.timelines);
          timelines.set(
            key,
            buildTimelineState(current.rows, current.epoch, subagent, current.hasOlder),
          );
        }
        return { descriptors, timelines };
      }
      if (payload.kind === "remove") {
        const key = providerSubagentKey(serverId, payload.parentAgentId, payload.subagentId);
        const descriptors = new Map(state.descriptors);
        descriptors.delete(key);
        const timelines = new Map(state.timelines);
        timelines.delete(key);
        return { descriptors, timelines };
      }
      const key = providerSubagentKey(serverId, payload.parentAgentId, payload.subagentId);
      const existing = state.timelines.get(key);
      if (existing?.epoch && existing.epoch !== payload.epoch) {
        return state;
      }
      const current = existing ?? EMPTY_TIMELINE;
      if (payload.seq <= current.lastSeq) {
        return state;
      }
      const rows = new Map(current.rows);
      rows.set(payload.seq, {
        provider: payload.provider,
        item: payload.item,
        timestamp: payload.timestamp,
      });
      const descriptor = state.descriptors.get(key);
      const next =
        descriptor && descriptor.status !== "running"
          ? buildTimelineState(rows, payload.epoch, descriptor, current.hasOlder)
          : applyStreamEvent({
              tail: current.tail,
              head: current.head,
              event: { type: "timeline", provider: payload.provider, item: payload.item },
              timestamp: new Date(payload.timestamp),
            });
      const timelines = new Map(state.timelines);
      timelines.set(key, {
        ...next,
        epoch: payload.epoch,
        lastSeq: payload.seq,
        hasOlder: current.hasOlder,
        rows,
      });
      return { timelines };
    });
    if (revealedKey) useProviderSubagentArchiveStore.getState().reveal(revealedKey);
  },
  replaceTimeline(serverId, payload) {
    const provider = payload.provider;
    if (!provider) {
      return;
    }
    set((state) => {
      const key = providerSubagentKey(serverId, payload.parentAgentId, payload.subagentId);
      const existing = state.timelines.get(key);
      const rows = buildTimelineResponseRows(existing, payload, provider);
      const descriptor = state.descriptors.get(key);
      const timelines = new Map(state.timelines);
      timelines.set(key, buildTimelineState(rows, payload.epoch, descriptor, payload.hasOlder));
      return { timelines };
    });
  },
}));
