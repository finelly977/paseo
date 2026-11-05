import type { StreamItem } from "@/types/stream";

function isSameTurn(left: StreamItem, right: StreamItem): boolean {
  return left.turnId !== undefined && left.turnId === right.turnId;
}

function reorderTurn(items: readonly StreamItem[]): StreamItem[] | null {
  const finalAssistantIndex = items.findLastIndex((item) => item.kind === "assistant_message");
  if (finalAssistantIndex < 0 || finalAssistantIndex === items.length - 1) return null;

  const finalAssistant = items[finalAssistantIndex];
  if (!finalAssistant || finalAssistant.kind !== "assistant_message") return null;
  const trailing = items.slice(finalAssistantIndex + 1);
  if (
    trailing.length === 0 ||
    trailing.some((item) => item.kind !== "tool_call" || !isSameTurn(item, finalAssistant))
  )
    return null;

  const finalBlockStart = finalAssistant.blockGroupId
    ? items.findIndex(
        (item) =>
          item.kind === "assistant_message" &&
          item.blockGroupId === finalAssistant.blockGroupId &&
          isSameTurn(item, finalAssistant),
      )
    : finalAssistantIndex;
  if (finalBlockStart < 0) throw new Error("最终回复分块缺少起始条目");
  return [
    ...items.slice(0, finalBlockStart),
    ...trailing,
    ...items.slice(finalBlockStart, finalAssistantIndex + 1),
  ];
}

/**
 * 提供方偶尔会在最终回复之后补发遗漏的工具完成事件。回合结束后把这类尾部工具
 * 放回最终回复之前；运行中的说明文字和后续工具保持原始顺序。
 */
export function placeCompletedTurnToolsBeforeFinalReply(input: {
  items: StreamItem[];
  isTurnActive: boolean;
}): StreamItem[] {
  if (input.isTurnActive || input.items.length < 3) return input.items;

  const output: StreamItem[] = [];
  let segmentStart = 0;
  let changed = false;
  const flush = (end: number) => {
    const segment = input.items.slice(segmentStart, end);
    const reordered = reorderTurn(segment);
    output.push(...(reordered ?? segment));
    changed ||= reordered !== null;
    segmentStart = end;
  };

  for (let index = 1; index < input.items.length; index += 1) {
    if (input.items[index]?.kind === "user_message") flush(index);
  }
  flush(input.items.length);
  return changed ? output : input.items;
}
