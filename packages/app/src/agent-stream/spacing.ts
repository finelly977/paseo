import type { StreamItem } from "@/types/stream";
import { SPACING } from "@/styles/theme";
import { getStandaloneMarkdownImages } from "./provider-image-message-model";
import {
  isStandaloneMarkdownHorizontalRule,
  splitMarkdownBlocks,
} from "@/utils/split-markdown-blocks";

export function isSameAssistantBlockGroup(params: {
  item: StreamItem | null | undefined;
  other: StreamItem | null | undefined;
}): boolean {
  return (
    params.item?.kind === "assistant_message" &&
    params.other?.kind === "assistant_message" &&
    params.item.blockGroupId !== undefined &&
    params.item.blockGroupId === params.other.blockGroupId
  );
}

export function getAssistantBlockSpacing(params: {
  item: StreamItem;
  aboveItem: StreamItem | null | undefined;
  belowItem: StreamItem | null | undefined;
}): "default" | "compactTop" | "compactBottom" | "compactBoth" {
  if (params.item.kind !== "assistant_message") {
    return "default";
  }
  const compactTop = isSameAssistantBlockGroup({ item: params.item, other: params.aboveItem });
  const compactBottom = isSameAssistantBlockGroup({ item: params.item, other: params.belowItem });
  if (compactTop && compactBottom) return "compactBoth";
  if (compactTop) return "compactTop";
  if (compactBottom) return "compactBottom";
  return "default";
}

const isUserMessageItem = (item?: StreamItem | null) => item?.kind === "user_message";
const isToolSequenceItem = (item?: StreamItem | null) =>
  item?.kind === "tool_call" ||
  item?.kind === "thought" ||
  item?.kind === "todo_list" ||
  (item?.kind === "assistant_message" && getStandaloneMarkdownImages(item.text) !== null);
const isStreamDivider = (item: StreamItem) =>
  item.kind === "compaction" || item.kind === "native_history_process";

function hasAssistantDividerAtEdge(item: StreamItem, edge: "first" | "last"): boolean {
  if (item.kind !== "assistant_message") return false;
  const blocks = splitMarkdownBlocks(item.text);
  const block = edge === "first" ? blocks[0] : blocks.at(-1);
  return block !== undefined && isStandaloneMarkdownHorizontalRule(block);
}

export function getGapAboveStreamItem(
  item: StreamItem,
  aboveItem: StreamItem | null,
  messageSpacing: number,
): number {
  const startsUserTurn =
    item.kind === "user_message" && aboveItem !== null && aboveItem.kind !== "user_message";
  return startsUserTurn ? messageSpacing * 2 : 0;
}

export function getGapBetweenStreamItems(
  item: StreamItem | null,
  belowItem: StreamItem | null,
  messageSpacing: number = SPACING[3],
): number {
  if (!item || !belowItem) {
    return 0;
  }

  const compactSpacing = Math.round(messageSpacing / 3);
  const relatedSpacing = Math.round((messageSpacing * 2) / 3);

  // 新用户回合的留白由用户卡片自己持有，避免上一条记录折叠后丢失。
  if (isUserMessageItem(belowItem)) {
    return isUserMessageItem(item) ? compactSpacing : 0;
  }
  if (isUserMessageItem(item)) {
    return isToolSequenceItem(belowItem) ? relatedSpacing : messageSpacing;
  }
  if (hasAssistantDividerAtEdge(item, "last") || hasAssistantDividerAtEdge(belowItem, "first")) {
    return 0;
  }
  if (isToolSequenceItem(item) && isToolSequenceItem(belowItem)) {
    return 0;
  }
  if (isStreamDivider(item) || isStreamDivider(belowItem)) {
    return 0;
  }
  if (item.kind === "assistant_message" && isToolSequenceItem(belowItem)) {
    return compactSpacing;
  }
  if (isToolSequenceItem(item) && belowItem.kind === "assistant_message") {
    return compactSpacing;
  }
  if (isSameAssistantBlockGroup({ item, other: belowItem })) {
    // Split markdown blocks from one assistant turn should read as continuous prose.
    return relatedSpacing;
  }
  return messageSpacing;
}
