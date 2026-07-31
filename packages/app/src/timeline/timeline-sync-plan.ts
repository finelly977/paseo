import { TIMELINE_FETCH_PAGE_SIZE } from "@/timeline/timeline-fetch-policy";

export interface TimelineSyncCursor {
  epoch: string;
  seq: number;
}

export interface AgentTimelineCursorRange {
  epoch: string;
  startSeq: number;
  endSeq: number;
}

export interface ProjectedTimelineTailFetchPlan {
  direction: "tail";
  limit: number;
  conversationLimit?: number;
  projection: "projected";
}

export interface ProjectedTimelineAfterFetchPlan {
  direction: "after";
  cursor: TimelineSyncCursor;
  limit: number;
  projection: "projected";
}

export interface ProjectedTimelineBeforeFetchPlan {
  direction: "before";
  cursor: TimelineSyncCursor;
  limit: number;
  projection: "projected";
}

export type ProjectedTimelineFetchPlan =
  | ProjectedTimelineTailFetchPlan
  | ProjectedTimelineAfterFetchPlan
  | ProjectedTimelineBeforeFetchPlan;

export type ProjectedTimelineForwardFetchPlan =
  | ProjectedTimelineTailFetchPlan
  | ProjectedTimelineAfterFetchPlan;

export function planInitialAgentTimelineSync(input: {
  cursor: AgentTimelineCursorRange | undefined;
  hasAuthoritativeHistory: boolean;
  conversationLimit?: number;
}): ProjectedTimelineForwardFetchPlan {
  if (input.hasAuthoritativeHistory && input.cursor) {
    return planTimelineCatchUpAfter({ epoch: input.cursor.epoch, seq: input.cursor.endSeq });
  }

  return planTimelineTailFetch(input.conversationLimit);
}

export function planResumeTimelineSync(input: {
  cursor: AgentTimelineCursorRange | undefined;
  conversationLimit?: number;
}): ProjectedTimelineForwardFetchPlan {
  if (input.cursor) {
    return planTimelineCatchUpAfter({ epoch: input.cursor.epoch, seq: input.cursor.endSeq });
  }

  return planTimelineTailFetch(input.conversationLimit);
}

export function planTimelineCatchUpAfter(cursor: TimelineSyncCursor) {
  return {
    direction: "after",
    cursor,
    limit: TIMELINE_FETCH_PAGE_SIZE,
    projection: "projected",
  } as const;
}

export function planTimelineTailFetch(conversationLimit?: number) {
  return {
    direction: "tail",
    limit: TIMELINE_FETCH_PAGE_SIZE,
    ...(conversationLimit !== undefined ? { conversationLimit } : {}),
    projection: "projected",
  } as const;
}

export function planTimelineOlderFetch(cursor: TimelineSyncCursor) {
  return {
    direction: "before",
    cursor,
    limit: TIMELINE_FETCH_PAGE_SIZE,
    projection: "projected",
  } as const;
}

export function isTimelineCatchUpComplete(input: {
  direction: "tail" | "before" | "after";
  hasNewer: boolean;
  error: string | null;
}): boolean {
  if (input.error) {
    return false;
  }

  return input.direction !== "after" || !input.hasNewer;
}
