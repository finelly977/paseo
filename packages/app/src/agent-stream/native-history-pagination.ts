import type { StreamItem } from "@/types/stream";

export function visibleNativeHistoryRows(input: {
  items: StreamItem[];
  collapsedHeights: ReadonlyMap<string, number>;
}): StreamItem[] {
  // 折叠过程不占原生虚拟列表单元，避免首批单元全是零高度而无法推进渲染窗口。
  return input.items.filter((item) => input.collapsedHeights.get(item.id) !== 0);
}

export function shouldLoadNativeHistory(input: {
  ready: boolean;
  hasOlder: boolean;
  loading: boolean;
  viewportHeight: number;
  contentHeight: number;
  offsetY: number;
}): boolean {
  return (
    input.ready &&
    input.hasOlder &&
    !input.loading &&
    input.viewportHeight > 0 &&
    input.contentHeight - input.viewportHeight - input.offsetY <= 96
  );
}
