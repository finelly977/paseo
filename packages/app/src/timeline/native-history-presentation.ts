import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { hydrateStreamState, type NativeHistoryProcessItem, type StreamItem } from "@/types/stream";

export function nativeHistoryInterruptedReply(
  item: NativeHistoryProcessItem,
  details: AgentTimelineItem[],
): StreamItem[] {
  if (item.status !== "interrupted" && item.status !== "failed") return [];
  const reply = details.findLast(
    (entry) => entry.type === "assistant_message" && entry.text.trim().length > 0,
  );
  if (
    !reply ||
    reply.type !== "assistant_message" ||
    (reply.messageId !== undefined && item.summaryMessageIds.includes(reply.messageId))
  )
    return [];
  return hydrateNativeHistoryDetails(item, [reply]);
}

export function hydrateNativeHistoryDetails(
  item: NativeHistoryProcessItem,
  details: AgentTimelineItem[],
): StreamItem[] {
  const rows = hydrateStreamState(
    details.map((entry) => ({
      event: { type: "timeline" as const, provider: "codex", item: entry, turnId: item.turnId },
      timestamp: item.timestamp,
    })),
    { source: "canonical" },
  );
  for (const row of rows) row.timestampUnknown = true; // 条目接口不提供每个操作的独立发生时间。
  return rows;
}
