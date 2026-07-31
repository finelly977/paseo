import type { StreamItem } from "@/types/stream";

export const DEFAULT_CONVERSATION_HISTORY_LOAD_COUNT = 50;
export const MIN_CONVERSATION_HISTORY_LOAD_COUNT = 1;
export const MAX_CONVERSATION_HISTORY_LOAD_COUNT = 1_000;
export const DEFAULT_TOTAL_CONVERSATION_HISTORY_LIMIT = 500;
export const MIN_TOTAL_CONVERSATION_HISTORY_LIMIT = 1;
export const MAX_TOTAL_CONVERSATION_HISTORY_LIMIT = 10_000;

export interface ConversationHistoryMemoryEntry {
  key: string;
  items: readonly StreamItem[];
  openedAt: number;
  current: boolean;
}

export function countConversationTurns(items: readonly StreamItem[]): number {
  let count = 0;
  for (const item of items) {
    if (item.kind === "user_message") {
      count += 1;
    }
  }
  return count;
}

export function trimConversationHistory(
  items: StreamItem[],
  conversationLimit: number,
): StreamItem[] {
  const limit = Math.max(0, Math.floor(conversationLimit));
  if (limit === 0) {
    return [];
  }

  let remaining = limit;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.kind !== "user_message") {
      continue;
    }
    remaining -= 1;
    if (remaining === 0) {
      return index === 0 ? items : items.slice(index);
    }
  }
  return items;
}

export function allocateConversationHistoryBudget(input: {
  entries: readonly ConversationHistoryMemoryEntry[];
  totalLimit: number;
}): Map<string, number> {
  const ordered = [...input.entries].sort((left, right) => {
    if (left.current !== right.current) {
      return left.current ? -1 : 1;
    }
    return right.openedAt - left.openedAt || left.key.localeCompare(right.key);
  });
  let remaining = Math.max(0, Math.floor(input.totalLimit));
  const allocations = new Map<string, number>();
  for (const entry of ordered) {
    const turns = countConversationTurns(entry.items);
    const retained = Math.min(turns, remaining);
    allocations.set(entry.key, retained);
    remaining -= retained;
  }
  return allocations;
}
