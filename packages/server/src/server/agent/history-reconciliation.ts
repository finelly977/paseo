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

interface HistoryMatchIndex {
  identities: Map<string, CanonicalCandidate[]>;
  structures: Map<string, CanonicalCandidate[]>;
  assistantGroups: Map<string, AssistantCanonicalCandidate[][]>;
  userPrefix: number[];
}

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
  const index = buildHistoryMatchIndex(remaining);
  const providerRows = providerEntries.map((entry) => {
    const match = takeMatch(index, entry.item, structuralCounts);
    return { entry, match };
  });
  const rows: AgentTimelineRow[] = [];
  const emittedCanonicalIndexes = findRedundantProviderAssistantRows(
    remaining,
    providerRows,
    index,
  );
  let prefixEnd = 0;

  for (const { entry, match } of providerRows) {
    if (match) {
      while (prefixEnd < match.canonicalIndex) {
        const candidate = remaining[prefixEnd++]!;
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
  rows.forEach((row, position) => {
    row.seq = position + 1;
  });
  return rows;
}

function takeMatch(
  index: HistoryMatchIndex,
  provider: AgentTimelineItem,
  structuralCounts: Map<string, { canonical: number; provider: number }>,
): ProviderHistoryMatch | null {
  let strong: CanonicalCandidate | undefined;
  if (provider.type === "user_message") {
    for (const identity of [provider.clientMessageId, provider.messageId]) {
      if (!identity) continue;
      const candidate = index.identities.get(identity)?.find((entry) => !entry.used);
      if (candidate && (!strong || candidate.canonicalIndex < strong.canonicalIndex)) {
        strong = candidate;
      }
    }
  }
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
    provider.type === "assistant_message" ? findAssistantMessageChunkMatch(index, provider) : null;
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

  const structural = index.structures
    .get(structuralLookupKey(provider))
    ?.find((candidate) => !candidate.used && structurallyMatches(candidate.row.item, provider));
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
  index: HistoryMatchIndex,
  provider: AssistantMessageItem,
): AssistantCanonicalCandidate[] | null {
  const groups = index.assistantGroups.get(normalizeAssistantMessageText(provider.text)) ?? [];
  const matchingGroups = groups.filter((group) => group.every((candidate) => !candidate.used));
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
        !hasUserMessageBetween(index.userPrefix, firstGroupEnd, group.at(-1)!.canonicalIndex),
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
  index: HistoryMatchIndex,
): Set<number> {
  const redundant = new Set<number>();
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
    const groups = index.assistantGroups.get(normalizeAssistantMessageText(entry.item.text)) ?? [];
    for (const group of groups) {
      const first = group[0]!;
      const last = group.at(-1)!;
      if (
        group.some((candidate) => candidate.used) ||
        first.row.turnId !== undefined ||
        first.row.item.messageId !== entry.item.messageId ||
        hasUserMessageBetween(index.userPrefix, last.canonicalIndex, match.canonicalIndex)
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
  userPrefix: readonly number[],
  leftIndex: number,
  rightIndex: number,
): boolean {
  const start = Math.min(leftIndex, rightIndex) + 1;
  const end = Math.max(leftIndex, rightIndex);
  return start < end && userPrefix[end]! > userPrefix[start]!;
}

function buildHistoryMatchIndex(candidates: CanonicalCandidate[]): HistoryMatchIndex {
  const index: HistoryMatchIndex = {
    identities: new Map(),
    structures: new Map(),
    assistantGroups: new Map(),
    userPrefix: [0],
  };
  for (const candidate of candidates) {
    const { row } = candidate;
    const isUser = row.item.type === "user_message";
    index.userPrefix.push(index.userPrefix.at(-1)! + Number(isUser));
    if (row.item.type === "user_message") {
      const identities = new Set([
        row.item.clientMessageId,
        row.item.messageId,
        row.providerMessageId,
      ]);
      for (const identity of identities) {
        if (!identity) continue;
        const matches = index.identities.get(identity) ?? [];
        matches.push(candidate);
        index.identities.set(identity, matches);
      }
    }
    const key = structuralLookupKey(row.item);
    const matches = index.structures.get(key) ?? [];
    matches.push(candidate);
    index.structures.set(key, matches);
  }
  // 分组只取决于规范记录的相邻位置，不随匹配过程改变；正文只拼接一次。
  for (const group of collectAssistantMessageGroups(candidates)) {
    const text = normalizeAssistantMessageText(
      group.map((candidate) => candidate.row.item.text).join(""),
    );
    const matches = index.assistantGroups.get(text) ?? [];
    matches.push(group);
    index.assistantGroups.set(text, matches);
  }
  return index;
}

function structuralLookupKey(item: AgentTimelineItem): string {
  // 非用户条目仍由深比较判定，保留对象字段顺序不同但内容相同的匹配语义。
  switch (item.type) {
    case "user_message":
      return `user:${item.text}`;
    case "tool_call":
      return `tool:${item.callId}`;
    case "assistant_message":
      return `assistant:${item.text}`;
    default:
      return item.type;
  }
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
  const turnRole = provider.turnRole ?? canonical.turnRole;
  return {
    ...provider,
    ...(canonical.clientMessageId ? { clientMessageId: canonical.clientMessageId } : {}),
    ...(canonical.messageId ? { messageId: canonical.messageId } : {}),
    ...(turnRole ? { turnRole } : {}),
  };
}
