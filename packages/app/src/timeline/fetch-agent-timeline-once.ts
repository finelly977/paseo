import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

type TimelineClient = Pick<DaemonClient, "fetchAgentTimeline">;
type TimelineRequest = Parameters<TimelineClient["fetchAgentTimeline"]>[1];
type TimelinePage = Awaited<ReturnType<TimelineClient["fetchAgentTimeline"]>>;

interface TimelineRead {
  agentId: string;
  requestId: string;
  released: boolean;
  promise: Promise<TimelinePage>;
}

const inFlightByClient = new WeakMap<object, Map<string, TimelineRead>>();
const readsByClient = new WeakMap<object, Map<string, TimelineRead>>();
let nextRequestId = 0;

export function releaseAgentTimelineReads(client: TimelineClient, agentId: string): void {
  const inFlight = inFlightByClient.get(client);
  if (!inFlight) return;
  for (const [key, read] of inFlight) {
    if (read.agentId !== agentId) continue;
    read.released = true;
    inFlight.delete(key);
  }
}

export function isReleasedAgentTimelineResponse(
  client: TimelineClient,
  requestId: string,
): boolean {
  return readsByClient.get(client)?.get(requestId)?.released === true;
}

export function fetchAgentTimelineOnce(
  client: TimelineClient,
  agentId: string,
  request: TimelineRequest,
): Promise<TimelinePage> {
  let inFlight = inFlightByClient.get(client);
  if (!inFlight) {
    inFlight = new Map();
    inFlightByClient.set(client, inFlight);
  }

  const key = `${agentId}:${JSON.stringify(request)}`;
  const existing = inFlight.get(key);
  if (existing) return existing.promise;

  let reads = readsByClient.get(client);
  if (!reads) {
    reads = new Map();
    readsByClient.set(client, reads);
  }
  nextRequestId += 1;
  const requestId = request?.requestId ?? `timeline-${Date.now()}-${nextRequestId}`;
  const read: TimelineRead = {
    agentId,
    requestId,
    released: false,
    promise: client.fetchAgentTimeline(agentId, { ...request, requestId }),
  };
  reads.set(requestId, read);

  inFlight.set(key, read);
  const clear = () => {
    if (inFlight.get(key) === read) inFlight.delete(key);
    reads.delete(requestId);
  };
  void read.promise.then(clear, clear);
  return read.promise;
}
