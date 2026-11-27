const THINKING_EFFORT_RANK: Record<string, number> = {
  default: 0,
  auto: 5,
  off: 10,
  none: 10,
  disabled: 10,
  minimal: 20,
  min: 20,
  low: 30,
  medium: 40,
  med: 40,
  normal: 40,
  balanced: 40,
  high: 50,
  xhigh: 60,
  extrahigh: 60,
  veryhigh: 60,
  ultracode: 65,
  ultra: 65,
  max: 70,
  maximum: 70,
};

const UNKNOWN_THINKING_EFFORT_RANK = 62;

function compactThinkingKey(value: string | null | undefined): string {
  return (value ?? "").replace(/[\s_-]+/g, "").toLowerCase();
}

function getThinkingOptionRank(option: { id: string; label?: string | null }): number {
  const byId = THINKING_EFFORT_RANK[compactThinkingKey(option.id)];
  if (byId !== undefined) {
    return byId;
  }
  const byLabel = THINKING_EFFORT_RANK[compactThinkingKey(option.label)];
  if (byLabel !== undefined) {
    return byLabel;
  }
  return UNKNOWN_THINKING_EFFORT_RANK;
}

/**
 * 按思考深度从浅到深规范排序（Default/Off/Minimal → Low → Medium → High → Extra high → Ultra code → Max），
 * 确保 Max 始终位于最右侧最高档，未知自定义档位保留原相对顺序。
 */
export function sortProviderThinkingOptions<T extends { id: string; label?: string | null }>(
  options: readonly T[],
): T[] {
  if (options.length <= 1) {
    return [...options];
  }
  return options
    .map((option, index) => ({ option, index, rank: getThinkingOptionRank(option) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ option }) => option);
}
