import { i18n } from "@/i18n/i18next";
import type { StreamItem } from "@/types/stream";

/** 波浪半径占可见轨道高度的比例：轨道内容再长也只按可见范围形成局部山峰。 */
const HISTORY_INDEX_WAVE_RADIUS_RATIO = 0.14;
/** 波浪半径下限，防止轨道过矮时山峰窄得只剩一根刻度。 */
const HISTORY_INDEX_WAVE_MIN_RADIUS_PX = 16;
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

/** 相邻刻度的固定像素间距：与历史条数无关，短会话也保持紧凑。 */
export const HISTORY_INDEX_MARKER_PITCH = 8;
export const HISTORY_INDEX_MAX_HEIGHT = 480;

export interface HistoryIndexRailLayout {
  markerCount: number;
  markerPitch: number;
  railHeight: number;
  contentHeight: number;
  railTop: number;
}

/**
 * 刻度间距固定，索引过长时由视图在固定最大高度内滚动，不压缩刻度，也不丢弃任何一轮对话。
 */
export function resolveHistoryIndexRailLayout(input: {
  entryCount: number;
  availableHeight: number;
  markerHeight: number;
}): HistoryIndexRailLayout {
  if (input.entryCount <= 0 || input.availableHeight <= 0) {
    return { markerCount: 0, markerPitch: 0, railHeight: 0, contentHeight: 0, railTop: 0 };
  }
  const markerCount = input.entryCount;
  const markerPitch = markerCount === 1 ? 0 : HISTORY_INDEX_MARKER_PITCH;
  const contentHeight = (markerCount - 1) * markerPitch + input.markerHeight;
  const railHeight = Math.min(input.availableHeight, HISTORY_INDEX_MAX_HEIGHT, contentHeight);
  return {
    markerCount,
    markerPitch,
    railHeight,
    contentHeight,
    // 居中偏移也取整，避免容器原点的小数像素让所有整数刻度重新落到半像素上。
    railTop: Math.round((input.availableHeight - railHeight) / 2),
  };
}

/**
 * 刻度与指针的距离按内容像素计算，但波浪半径只由可见轨道高度决定。
 * 轨道可滚动时内容高度远大于可见高度，若半径按全部内容比例计算，
 * 可见区域会被整体压进同一个波浪里，山峰动画因此不可见。
 */
export function getHistoryIndexWaveScale(
  markerOffsetPx: number,
  pointerOffsetPx: number | null,
  visiblePixelHeight: number,
): number {
  if (pointerOffsetPx === null || visiblePixelHeight <= 0) {
    return 1;
  }
  const distancePx = Math.abs(markerOffsetPx - pointerOffsetPx);
  const radiusPx = Math.max(
    HISTORY_INDEX_WAVE_MIN_RADIUS_PX,
    visiblePixelHeight * HISTORY_INDEX_WAVE_RADIUS_RATIO,
  );
  if (distancePx >= radiusPx) {
    return 1;
  }
  const normalizedDistance = distancePx / radiusPx;
  const influence = (Math.cos(normalizedDistance * Math.PI) + 1) / 2;
  return 1 + (HISTORY_INDEX_WAVE_PEAK_SCALE - 1) * influence;
}
