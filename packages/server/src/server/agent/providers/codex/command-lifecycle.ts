import type { ToolCallTimelineItem } from "../../agent-sdk-types.js";

export function settleCodexCommand(
  item: ToolCallTimelineItem,
  turnStatus: string | undefined,
): ToolCallTimelineItem {
  if (item.detail.type !== "shell") return item;
  if (item.status !== "running") return item;
  if (turnStatus === "completed") return { ...item, status: "completed" };
  if (turnStatus === "failed" || turnStatus === "interrupted")
    return { ...item, status: "canceled" };
  return item;
}
