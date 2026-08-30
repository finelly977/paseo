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
  visibleItems: readonly StreamItem[];
}): CompletedTurnProcessModel {
  const turnIdByProcessItemId = new Map<string, string>();
  const toggleByItemId = new Map<string, CompletedTurnProcessToggleModel>();
  const assistantById = new Map<string, AssistantMessageItem>();
  const firstAssistantByBlockGroupId = new Map<string, AssistantMessageItem>();
  for (const item of input.visibleItems) {
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
    const toggleItemId = host.processItemIds.at(-1);
    if (!toggleItemId) {
      continue;
    }

    const firstFinalBlock = findFirstFinalAssistantBlock({
      host,
      assistantById,
      firstAssistantByBlockGroupId,
    });
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

export function formatCompletedTurnDuration(durationMs: number, locale: string): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const seconds = totalSeconds % 60;
  const formatUnit = (value: number, unit: "hour" | "minute" | "second") => {
    const formatter = new Intl.NumberFormat(locale, {
      style: "unit",
      unit,
      unitDisplay: "short",
    });
    if (!locale.startsWith("zh")) {
      return formatter.format(value);
    }
    return formatter
      .formatToParts(value)
      .map((part) => (part.type === "unit" ? ` ${part.value}` : part.value))
      .join("");
  };
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(formatUnit(hours, "hour"));
    if (minutes > 0) parts.push(formatUnit(minutes, "minute"));
  } else if (totalMinutes > 0) {
    parts.push(formatUnit(totalMinutes, "minute"));
    if (seconds > 0) parts.push(formatUnit(seconds, "second"));
  } else {
    parts.push(formatUnit(totalSeconds, "second"));
  }

  return parts.join(" ");
}
