import { describe, expect, it } from "vitest";
import { shouldLoadNativeHistory, visibleNativeHistoryRows } from "./native-history-pagination";
import type { StreamItem } from "@/types/stream";

describe("原生历史分页", () => {
  it("大量折叠过程不阻塞较早消息进入首屏渲染窗口，展开后仍可恢复", () => {
    const items: StreamItem[] = Array.from({ length: 300 }, (_, index) => ({
      id: `process-${index}`,
      kind: "assistant_message",
      text: `${index}`,
      timestamp: new Date(0),
    }));
    const older: StreamItem = {
      id: "older",
      kind: "assistant_message",
      text: "较早回答",
      timestamp: new Date(0),
    };
    const heights = new Map(items.map((item) => [item.id, 0]));
    heights.set(items[0].id, 40);
    expect(
      visibleNativeHistoryRows({ items: [...items, older], collapsedHeights: heights }),
    ).toEqual([items[0], older]);
    expect(visibleNativeHistoryRows({ items, collapsedHeights: new Map() })).toHaveLength(300);
  });
  const input = {
    ready: true,
    hasOlder: true,
    loading: false,
    viewportHeight: 800,
    contentHeight: 300,
    offsetY: 0,
  };
  it("折叠工具后内容不足一屏时无需滚动即可补页", () => {
    expect(shouldLoadNativeHistory(input)).toBe(true);
    expect(shouldLoadNativeHistory({ ...input, contentHeight: 800 })).toBe(true);
  });
  it("倒置列表仅在最早消息附近加载，不在最新消息处加载长历史", () => {
    expect(shouldLoadNativeHistory({ ...input, contentHeight: 2000 })).toBe(false);
    expect(shouldLoadNativeHistory({ ...input, contentHeight: 2000, offsetY: 1150 })).toBe(true);
  });
  it.each([{ ready: false }, { hasOlder: false }, { loading: true }, { viewportHeight: 0 }])(
    "未就绪、已到头、请求中或隐藏列表不得请求：%j",
    (override) => {
      expect(shouldLoadNativeHistory({ ...input, ...override })).toBe(false);
    },
  );
});
