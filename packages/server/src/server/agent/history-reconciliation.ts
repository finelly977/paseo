import { isDeepStrictEqual } from "node:util";

import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";

export interface ProviderHistoryTimelineEntry {
  item: AgentTimelineItem;
  timestamp?: string;
}

interface CanonicalCandidate {
  row: AgentTimelineRow;
  canonicalIndex: number;
  used: boolean;
}

interface ProviderHistoryMatch {
  row: AgentTimelineRow;
  canonicalIndex: number;
  canonicalIndexes: number[];
  transferProviderIdentity: boolean;
}

type AssistantMessageItem = Extract<AgentTimelineItem, { type: "assistant_message" }>;
type AssistantCanonicalCandidate = CanonicalCandidate & {
  row: AgentTimelineRow & { item: AssistantMessageItem };
};

const ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN = "\n\n---\n\n";

/** 按提供方顺序对齐规范时间线元数据，不凭空推断回合归属。 */
export function reconcileProviderHistory(
  canonicalRows: readonly AgentTimelineRow[],
  providerEntries: readonly ProviderHistoryTimelineEntry[],
  options?: { mode?: "incomplete" | "force" },
): AgentTimelineRow[] {
  if (providerEntries.length === 0) {
    return options?.mode === "force"
      ? []
      : canonicalRows.map((row, index) => ({ ...row, seq: index + 1 }));
  }
  const remaining = canonicalRows.map((row, canonicalIndex) => ({
    row,
    canonicalIndex,
    used: false,
  }));
  const structuralCounts = countStructuralOccurrences(canonicalRows, providerEntries);
  const providerRows = providerEntries.map((entry) => {
    const match = takeMatch(remaining, entry.item, structuralCounts);
    return { entry, match };
  });
  const rows: AgentTimelineRow[] = [];
  const emittedCanonicalIndexes = findRedundantProviderAssistantRows(remaining, providerRows);

  for (const { entry, match } of providerRows) {
    if (match) {
      for (const candidate of remaining) {
        if (candidate.canonicalIndex >= match.canonicalIndex) break;
        if (!emittedCanonicalIndexes.has(candidate.canonicalIndex)) {
          rows.push({ ...candidate.row });
          emittedCanonicalIndexes.add(candidate.canonicalIndex);
        }
      }
      rows.push(
        match.transferProviderIdentity ? mergeMatchedRow(match.row, entry) : { ...match.row },
      );
      for (const canonicalIndex of match.canonicalIndexes) {
        emittedCanonicalIndexes.add(canonicalIndex);
      }
      continue;
    }
    rows.push({
      seq: 0,
      timestamp: entry.timestamp ?? new Date(0).toISOString(),
      item: entry.item,
    });
  }

  if (options?.mode !== "force") {
    for (const candidate of remaining) {
      if (!emittedCanonicalIndexes.has(candidate.canonicalIndex)) {
        rows.push({ ...candidate.row });
      }
    }
  }
  rows.forEach((row, index) => {
    row.seq = index + 1;
  });
  return rows;
}

function takeMatch(
  remaining: CanonicalCandidate[],
  provider: AgentTimelineItem,
  structuralCounts: Map<string, { canonical: number; provider: number }>,
): ProviderHistoryMatch | null {
  const strong = remaining.find(
    (candidate) => !candidate.used && hasSharedIdentity(candidate.row, provider),
  );
  if (strong) {
    strong.used = true;
    return {
      row: strong.row,
      canonicalIndex: strong.canonicalIndex,
      canonicalIndexes: [strong.canonicalIndex],
      transferProviderIdentity: true,
    };
  }

  const assistantChunks =
    provider.type === "assistant_message"
      ? findAssistantMessageChunkMatch(remaining, provider)
      : null;
  if (assistantChunks) {
    for (const candidate of assistantChunks) {
      candidate.used = true;
    }
    const lastChunk = assistantChunks.at(-1)!;
    return {
      row: lastChunk.row,
      canonicalIndex: lastChunk.canonicalIndex,
      canonicalIndexes: assistantChunks.map((candidate) => candidate.canonicalIndex),
      transferProviderIdentity: false,
    };
  }

  const structural = remaining.find(
    (candidate) => !candidate.used && structurallyMatches(candidate.row.item, provider),
  );
  if (!structural) return null;
  structural.used = true;
  const key = structuralKey(provider);
  const counts = structuralCounts.get(key)!;
  return {
    row: structural.row,
    canonicalIndex: structural.canonicalIndex,
    canonicalIndexes: [structural.canonicalIndex],
    transferProviderIdentity: counts.canonical === 1 && counts.provider === 1,
  };
}

function findAssistantMessageChunkMatch(
  remaining: CanonicalCandidate[],
  provider: AssistantMessageItem,
): AssistantCanonicalCandidate[] | null {
  const matchingGroups = collectAssistantMessageGroups(remaining).filter(
    (group) =>
      group.every((candidate) => !candidate.used) &&
      normalizeAssistantMessageText(group.map((candidate) => candidate.row.item.text).join("")) ===
        normalizeAssistantMessageText(provider.text),
  );
  const firstGroup = matchingGroups[0];
  if (!firstGroup) {
    return null;
  }
  if (firstGroup.some((candidate) => candidate.row.turnId !== undefined)) {
    return firstGroup;
  }
  const firstItem = firstGroup[0]!.row.item;
  if (provider.messageId === undefined || firstItem.messageId !== provider.messageId) {
    return firstGroup;
  }
  // 旧版本可能先写入一条没有回合归属的提供方完整消息，随后又保留同一用户
  // 回合内的实时片段。此时优先保留带回合归属的实时记录；跨用户回合不跳转。
  const firstGroupEnd = firstGroup.at(-1)!.canonicalIndex;
  return (
    matchingGroups.find(
      (group) =>
        group.some((candidate) => candidate.row.turnId !== undefined) &&
        !hasUserMessageBetween(remaining, firstGroupEnd, group.at(-1)!.canonicalIndex),
    ) ?? firstGroup
  );
}

function collectAssistantMessageGroups(
  candidates: readonly CanonicalCandidate[],
): AssistantCanonicalCandidate[][] {
  const groups: AssistantCanonicalCandidate[][] = [];
  for (const candidate of candidates) {
    if (candidate.row.item.type !== "assistant_message") {
      continue;
    }
    const assistantCandidate = candidate as AssistantCanonicalCandidate;
    const currentGroup = groups.at(-1);
    const previous = currentGroup?.at(-1);
    if (currentGroup && previous && continuesAssistantMessage(previous, assistantCandidate)) {
      currentGroup.push(assistantCandidate);
    } else {
      groups.push([assistantCandidate]);
    }
  }
  return groups;
}

function continuesAssistantMessage(
  previous: AssistantCanonicalCandidate,
  current: AssistantCanonicalCandidate,
): boolean {
  if (previous.canonicalIndex + 1 !== current.canonicalIndex) {
    return false;
  }
  const messageId = previous.row.item.messageId;
  return (
    messageId !== undefined &&
    current.row.item.messageId === messageId &&
    current.row.turnId === previous.row.turnId
  );
}

function normalizeAssistantMessageText(text: string): string {
  return text.startsWith(ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN)
    ? text.slice(ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN.length)
    : text;
}

function findRedundantProviderAssistantRows(
  candidates: readonly CanonicalCandidate[],
  providerRows: ReadonlyArray<{
    entry: ProviderHistoryTimelineEntry;
    match: ProviderHistoryMatch | null;
  }>,
): Set<number> {
  const redundant = new Set<number>();
  const groups = collectAssistantMessageGroups(candidates);
  for (const { entry, match } of providerRows) {
    if (
      entry.item.type !== "assistant_message" ||
      entry.item.messageId === undefined ||
      !match ||
      !match.canonicalIndexes.some(
        (canonicalIndex) => candidates[canonicalIndex]!.row.turnId !== undefined,
      )
    ) {
      continue;
    }
    for (const group of groups) {
      const first = group[0]!;
      const last = group.at(-1)!;
      if (
        group.some((candidate) => candidate.used) ||
        first.row.turnId !== undefined ||
        first.row.item.messageId !== entry.item.messageId ||
        normalizeAssistantMessageText(
          group.map((candidate) => candidate.row.item.text).join(""),
        ) !== normalizeAssistantMessageText(entry.item.text) ||
        hasUserMessageBetween(candidates, last.canonicalIndex, match.canonicalIndex)
      ) {
        continue;
      }
      // 只清理能由提供方消息标识、完整正文和同一用户回合共同证明的旧副本。
      for (const candidate of group) {
        redundant.add(candidate.canonicalIndex);
      }
    }
  }
  return redundant;
}

function hasUserMessageBetween(
  candidates: readonly CanonicalCandidate[],
  leftIndex: number,
  rightIndex: number,
): boolean {
  const start = Math.min(leftIndex, rightIndex) + 1;
  const end = Math.max(leftIndex, rightIndex);
  return candidates
    .slice(start, end)
    .some((candidate) => candidate.row.item.type === "user_message");
}

function mergeMatchedRow(
  canonical: AgentTimelineRow,
  provider: ProviderHistoryTimelineEntry,
): AgentTimelineRow {
  return {
    ...canonical,
    item: mergeCanonicalIdentity(canonical.item, provider.item),
  };
}

function countStructuralOccurrences(
  canonicalRows: readonly AgentTimelineRow[],
  providerEntries: readonly ProviderHistoryTimelineEntry[],
): Map<string, { canonical: number; provider: number }> {
  const counts = new Map<string, { canonical: number; provider: number }>();
  for (const row of canonicalRows) {
    const key = structuralKey(row.item);
    const count = counts.get(key) ?? { canonical: 0, provider: 0 };
    count.canonical += 1;
    counts.set(key, count);
  }
  for (const entry of providerEntries) {
    const key = structuralKey(entry.item);
    const count = counts.get(key) ?? { canonical: 0, provider: 0 };
    count.provider += 1;
    counts.set(key, count);
  }
  return counts;
}

function structuralKey(item: AgentTimelineItem): string {
  return item.type === "user_message"
    ? `user:${item.text}`
    : `${item.type}:${JSON.stringify(item)}`;
}

function hasSharedIdentity(row: AgentTimelineRow, provider: AgentTimelineItem): boolean {
  if (row.item.type !== "user_message" || provider.type !== "user_message") return false;
  const identities = [row.item.clientMessageId, row.item.messageId, row.providerMessageId].filter(
    Boolean,
  );
  return identities.some(
    (identity) => identity === provider.clientMessageId || identity === provider.messageId,
  );
}

function structurallyMatches(left: AgentTimelineItem, right: AgentTimelineItem): boolean {
  if (left.type === "user_message" && right.type === "user_message")
    return left.text === right.text;
  return isDeepStrictEqual(left, right);
}

function mergeCanonicalIdentity(
  canonical: AgentTimelineItem,
  provider: AgentTimelineItem,
): AgentTimelineItem {
  if (canonical.type !== "user_message" || provider.type !== "user_message") return provider;
  return {
    ...provider,
    ...(canonical.clientMessageId ? { clientMessageId: canonical.clientMessageId } : {}),
    ...(canonical.messageId ? { messageId: canonical.messageId } : {}),
  };
}
