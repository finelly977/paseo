import type { StreamItem } from "@/types/stream";
import {
  isStandaloneMarkdownHorizontalRule,
  splitMarkdownBlocks,
} from "@/utils/split-markdown-blocks";
import type { TurnFooterHost } from "./layout";

export interface CompletedTurnProcessToggleModel {
  turnId: string;
  durationMs: number | undefined;
  isFollowedByDivider: boolean;
}

export interface CompletedTurnProcessModel {
  turnIdByProcessItemId: Map<string, string>;
  toggleByItemId: Map<string, CompletedTurnProcessToggleModel>;
}

type AssistantMessageItem = Extract<StreamItem, { kind: "assistant_message" }>;

function findFirstFinalAssistantBlock(input: {
  host: TurnFooterHost;
  assistantById: ReadonlyMap<string, AssistantMessageItem>;
  firstAssistantByBlockGroupId: ReadonlyMap<string, AssistantMessageItem>;
}): AssistantMessageItem | undefined {
  const finalAssistant = input.assistantById.get(input.host.itemId);
  if (!finalAssistant?.blockGroupId) {
    return finalAssistant;
  }
  return input.firstAssistantByBlockGroupId.get(finalAssistant.blockGroupId) ?? finalAssistant;
}

export function buildCompletedTurnProcessModel(input: {
  hosts: readonly TurnFooterHost[];
  chronologicalItems: readonly StreamItem[];
}): CompletedTurnProcessModel {
  const turnIdByProcessItemId = new Map<string, string>();
  const toggleByItemId = new Map<string, CompletedTurnProcessToggleModel>();
  const assistantById = new Map<string, AssistantMessageItem>();
  const firstAssistantByBlockGroupId = new Map<string, AssistantMessageItem>();
  const indexByItemId = new Map<string, number>();
  for (const [index, item] of input.chronologicalItems.entries()) {
    indexByItemId.set(item.id, index);
    if (item.kind !== "assistant_message") continue;
    assistantById.set(item.id, item);
    if (!item.blockGroupId) continue;
    const firstBlock = firstAssistantByBlockGroupId.get(item.blockGroupId);
    if (!firstBlock || (item.blockIndex ?? 0) < (firstBlock.blockIndex ?? 0)) {
      firstAssistantByBlockGroupId.set(item.blockGroupId, item);
    }
  }

  for (const host of input.hosts) {
    if (host.processItemIds.length === 0) {
      continue;
    }
    for (const itemId of host.processItemIds) {
      turnIdByProcessItemId.set(itemId, host.itemId);
    }
    const firstProcessItemId = host.processItemIds.at(-1);
    if (!firstProcessItemId) {
      continue;
    }

    const firstFinalBlock = findFirstFinalAssistantBlock({
      host,
      assistantById,
      firstAssistantByBlockGroupId,
    });
    const firstFinalIndex = firstFinalBlock ? indexByItemId.get(firstFinalBlock.id) : undefined;
    const firstProcessIndex = indexByItemId.get(firstProcessItemId);
    // 有些回合先给出正文，再执行收尾工具；入口必须位于两者中较早的一行。
    const toggleItemId =
      firstFinalBlock &&
      firstFinalIndex !== undefined &&
      firstProcessIndex !== undefined &&
      firstFinalIndex < firstProcessIndex
        ? firstFinalBlock.id
        : firstProcessItemId;
    const firstMarkdownBlock = firstFinalBlock
      ? splitMarkdownBlocks(firstFinalBlock.text)[0]
      : undefined;
    toggleByItemId.set(toggleItemId, {
      turnId: host.itemId,
      durationMs: host.timing?.durationMs,
      isFollowedByDivider:
        firstMarkdownBlock !== undefined && isStandaloneMarkdownHorizontalRule(firstMarkdownBlock),
    });
  }

  return { turnIdByProcessItemId, toggleByItemId };
}

export function formatCompletedTurnDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
  } else if (totalMinutes > 0) {
    parts.push(`${totalMinutes}m`);
    if (seconds > 0) parts.push(`${seconds}s`);
  } else {
    parts.push(`${totalSeconds}s`);
  }

  return parts.join(" ");
}
