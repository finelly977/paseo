import type { StreamItem } from "@/types/stream";
import type { TurnFooterHost } from "./layout";

export interface CompletedTurnProcessToggleModel {
  turnId: string;
  durationMs: number | undefined;
}

export interface CompletedTurnProcessModel {
  turnIdByProcessItemId: Map<string, string>;
  toggleByItemId: Map<string, CompletedTurnProcessToggleModel>;
}

type AssistantMessageItem = Extract<StreamItem, { kind: "assistant_message" }>;

/** 只允许已经在当前面板看到的实时回合自动退场；打开历史或补页不重播。 */
export function findLiveProcessExit(
  providerTurnId: string,
  model: CompletedTurnProcessModel,
  newestFirstSegments: readonly (readonly StreamItem[])[],
) {
  for (const items of newestFirstSegments) {
    for (let index = items.length - 1; index >= 0; index--) {
      const item = items[index];
      if (item.kind === "user_message" && item.turnRole !== "steer") return null;
      const toggle = model.toggleByItemId.get(item.id);
      if (item.turnId !== providerTurnId || !toggle) continue;
      const rowIds = new Set<string>();
      for (const [rowId, turnId] of model.turnIdByProcessItemId) {
        if (turnId === toggle.turnId) rowIds.add(rowId);
      }
      return { turnId: toggle.turnId, rowIds };
    }
  }
  return null;
}

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
  const loadingCompactionIds = new Set(
    input.chronologicalItems.flatMap((item) =>
      item.kind === "compaction" && item.status === "loading" ? [item.id] : [],
    ),
  );
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
    const processItemIds = host.processItemIds.filter((id) => !loadingCompactionIds.has(id));
    if (processItemIds.length === 0) {
      continue;
    }
    for (const itemId of processItemIds) {
      turnIdByProcessItemId.set(itemId, host.itemId);
    }
    const firstProcessItemId = processItemIds.at(-1);
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
    toggleByItemId.set(toggleItemId, {
      turnId: host.itemId,
      durationMs: host.timing?.durationMs,
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
