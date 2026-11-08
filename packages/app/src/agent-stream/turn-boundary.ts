import type { StreamItem, TimelinePosition } from "@/types/stream";

export type AssistantTurnForkBoundary =
  | { boundaryCursor: TimelinePosition; boundaryMessageId?: string }
  | { boundaryCursor?: undefined; boundaryMessageId: string }
  | { boundaryTurnId: string; boundaryCursor?: undefined; boundaryMessageId?: undefined };

export function resolveAssistantTurnForkBoundary(input: {
  items: readonly StreamItem[];
  startIndex: number;
  supportsTimelineCursor: boolean;
  supportsNativeTurn?: boolean;
}): AssistantTurnForkBoundary | undefined {
  const item = input.items[input.startIndex];
  if (item && item.kind !== "user_message" && input.supportsNativeTurn) {
    const turnId = item.kind === "native_history_process" ? item.turnId : item.nativeTurnId;
    if (turnId && !(item.kind === "native_history_process" && item.status === "inProgress"))
      return { boundaryTurnId: turnId };
  }
  if (item?.kind !== "assistant_message") {
    return undefined;
  }
  if (input.supportsTimelineCursor && item.timelineCursor) {
    return {
      boundaryCursor: item.timelineCursor,
      ...(item.messageId ? { boundaryMessageId: item.messageId } : {}),
    };
  }
  return item.messageId ? { boundaryMessageId: item.messageId } : undefined;
}
