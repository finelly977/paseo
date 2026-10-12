import type { StreamItem, ToolCallItem } from "@/types/stream";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";

export function resolveToolCallStatus(
  status: "executing" | "running" | "completed" | "failed" | "canceled",
  detail: ToolCallDetail | undefined,
) {
  if (status !== "running" && status !== "executing") return status;
  if (detail?.type === "shell" && typeof detail.exitCode === "number") {
    return detail.exitCode === 0 ? "completed" : "failed";
  }
  return status;
}

export function toolCallHasExitResult(item: ToolCallItem): boolean {
  if (item.payload.source !== "agent") return false;
  const detail = item.payload.data.detail;
  return detail.type === "shell" && typeof detail.exitCode === "number";
}

export function activeToolCallIds(input: {
  tail: StreamItem[];
  head: StreamItem[];
  running: boolean;
  turnId: string | null;
}): Set<string> {
  const ids = new Set<string>();
  if (!input.running) return ids;
  // 流式刷新只倒序检查当前回合，不在每个输出帧重新遍历完整历史。
  for (const segment of [input.head, input.tail]) {
    for (let index = segment.length - 1; index >= 0; index--) {
      const item = segment[index];
      if (item.kind === "user_message" && item.optimistic) continue;
      const hasTurnIdentity = input.turnId !== null && item.turnId !== undefined;
      if (hasTurnIdentity && item.turnId !== input.turnId) return ids;
      if (item.kind === "user_message" && !hasTurnIdentity) return ids;
      if (item.kind !== "tool_call" || toolCallHasExitResult(item)) continue;
      const status = item.payload.data.status;
      if (status === "running" || status === "executing") ids.add(item.id);
    }
  }
  return ids;
}
