import { i18n } from "@/i18n/i18next";
import type { StreamItem } from "@/types/stream";

export const MAX_HISTORY_INDEX_MARKERS = 60;
const HISTORY_INDEX_WAVE_RADIUS = 0.14;
const HISTORY_INDEX_WAVE_PEAK_SCALE = 2.75;

export function getStreamItemDomId(itemId: string): string {
  return `paseo-stream-item-${encodeURIComponent(itemId)}`;
}

export interface ConversationHistoryIndexEntry {
  id: string;
  title: string;
  preview: string;
  sourceIndex: number;
  seqStart?: number;
}

export interface ConversationHistoryIndexSummary {
  messageId: string | null;
  clientMessageId: string | null;
  text: string;
  assistantPreview: string;
  seqStart: number;
}

function normalizePreviewText(text: string): string {
  let normalized = text.replace(/\r\n/g, "\n");
  normalized = normalized.replace(/^\s*```[^\n]*$/gm, "");
  normalized = normalized.replace(/^\s*~~~[^\n]*$/gm, "");
  normalized = normalized.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  normalized = normalized.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  normalized = normalized.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  normalized = normalized.replace(/^\s{0,3}>+\s?/gm, "");
  normalized = normalized.replace(/^\s{0,3}(?:[*+-]|\d+\.)\s+/gm, "");
  normalized = normalized.replace(/`([^`]+)`/g, "$1");
  normalized = normalized.replace(/\*\*([^*]+)\*\*/g, "$1");
  normalized = normalized.replace(/__([^_]+)__/g, "$1");
  normalized = normalized.replace(/\*([^*\n]+)\*/g, "$1");
  normalized = normalized.replace(/_([^_\n]+)_/g, "$1");
  normalized = normalized.replace(/~~([^~]+)~~/g, "$1");
  return normalized.replace(/\s+/g, " ").trim();
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function getUserTitle(item: Extract<StreamItem, { kind: "user_message" }>): string {
  const firstLine = item.text.split(/\r?\n/u).find((line) => line.trim().length > 0) ?? "";
  return (
    truncate(normalizePreviewText(firstLine), 72) || i18n.t("agentStream.historyIndex.untitled")
  );
}

function getTurnPreview(items: readonly StreamItem[], userIndex: number): string {
  const parts: string[] = [];
  for (let index = userIndex + 1; index < items.length; index += 1) {
    const item = items[index];
    if (item?.kind === "user_message") {
      break;
    }
    if (item?.kind === "assistant_message" && item.text.trim()) {
      parts.push(normalizePreviewText(item.text));
      if (parts.join(" ").length >= 220) {
        break;
      }
    }
  }
  return truncate(parts.join(" ").trim(), 220);
}

export function buildConversationHistoryIndex(
  items: readonly StreamItem[],
): ConversationHistoryIndexEntry[] {
  const entries: ConversationHistoryIndexEntry[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item?.kind !== "user_message") {
      continue;
    }
    entries.push({
      id: item.id,
      title: getUserTitle(item),
      preview: getTurnPreview(items, index),
      sourceIndex: index,
      ...(item.timelineCursor ? { seqStart: item.timelineCursor.seq } : {}),
    });
  }
  return entries;
}

export function buildConversationHistoryIndexFromSummaries(
  summaries: readonly ConversationHistoryIndexSummary[],
): ConversationHistoryIndexEntry[] {
  return summaries.map((summary, index) => ({
    id: summary.messageId ?? summary.clientMessageId ?? `timeline-user-${summary.seqStart}`,
    title:
      truncate(normalizePreviewText(summary.text.split(/\r?\n/u)[0] ?? ""), 72) ||
      i18n.t("agentStream.historyIndex.untitled"),
    preview: truncate(normalizePreviewText(summary.assistantPreview), 220),
    sourceIndex: index,
    seqStart: summary.seqStart,
  }));
}

/**
 * 将超长历史压缩为固定数量的刻度，保留首尾并按原始位置均匀采样。
 * 点击刻度仍使用原消息 ID，因此不会丢失跳转目标。
 */
export function sampleConversationHistoryIndex(
  entries: readonly ConversationHistoryIndexEntry[],
  maxMarkers = MAX_HISTORY_INDEX_MARKERS,
): ConversationHistoryIndexEntry[] {
  if (maxMarkers < 1 || entries.length === 0) {
    return [];
  }
  if (entries.length <= maxMarkers) {
    return [...entries];
  }
  if (maxMarkers === 1) {
    const first = entries[0];
    return first ? [first] : [];
  }
  const sampled: ConversationHistoryIndexEntry[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < maxMarkers; index += 1) {
    const sourceIndex = Math.round((index * (entries.length - 1)) / (maxMarkers - 1));
    const entry = entries[sourceIndex];
    if (entry && !seen.has(entry.id)) {
      seen.add(entry.id);
      sampled.push(entry);
    }
  }
  return sampled;
}

export function getHistoryIndexWaveScale(
  markerFraction: number,
  pointerFraction: number | null,
): number {
  if (pointerFraction === null) {
    return 1;
  }
  const distance = Math.abs(markerFraction - pointerFraction);
  if (distance >= HISTORY_INDEX_WAVE_RADIUS) {
    return 1;
  }
  const normalizedDistance = distance / HISTORY_INDEX_WAVE_RADIUS;
  const influence = (Math.cos(normalizedDistance * Math.PI) + 1) / 2;
  return 1 + (HISTORY_INDEX_WAVE_PEAK_SCALE - 1) * influence;
}
