import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  buildConversationHistoryIndex,
  buildConversationHistoryIndexFromSummaries,
  getHistoryIndexWaveScale,
  HISTORY_INDEX_MARKER_PITCH,
  resolveHistoryIndexRailLayout,
  sampleConversationHistoryIndex,
} from "./history-index-model";

function user(id: string, text: string): StreamItem {
  return {
    kind: "user_message",
    id,
    text,
    timestamp: new Date("2026-07-24T00:00:00.000Z"),
  };
}

function assistant(id: string, text: string): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text,
    timestamp: new Date("2026-07-24T00:00:01.000Z"),
  };
}

describe("conversation history index model", () => {
  it("builds a prompt title and assistant preview for each turn", () => {
    const entries = buildConversationHistoryIndex([
      user("u1", "提交推送\n请检查状态"),
      assistant("a1", "**已提交**并推送到 `origin/main`。"),
      user("u2", "继续检查"),
    ]);

    expect(entries).toEqual([
      {
        id: "u1",
        title: "提交推送",
        preview: "已提交并推送到 origin/main。",
        sourceIndex: 0,
      },
      { id: "u2", title: "继续检查", preview: "", sourceIndex: 2 },
    ]);
  });

  it("samples long histories evenly while preserving the endpoints", () => {
    const entries = Array.from({ length: 101 }, (_, index) => ({
      id: `u-${index}`,
      title: `消息 ${index}`,
      preview: "",
      sourceIndex: index,
    }));

    const sampled = sampleConversationHistoryIndex(entries, 10);
    expect(sampled).toHaveLength(10);
    expect(sampled[0]?.id).toBe("u-0");
    expect(sampled.at(-1)?.id).toBe("u-100");
  });

  it("keeps the first entry when only one marker is allowed", () => {
    const entries = [
      { id: "u-1", title: "一", preview: "", sourceIndex: 0 },
      { id: "u-2", title: "二", preview: "", sourceIndex: 1 },
    ];
    expect(sampleConversationHistoryIndex(entries, 1).map((entry) => entry.id)).toEqual(["u-1"]);
  });

  it("builds lightweight entries from the server conversation index", () => {
    expect(
      buildConversationHistoryIndexFromSummaries([
        {
          messageId: "user-42",
          clientMessageId: null,
          text: "检查历史索引\n只保留首行标题",
          assistantPreview: "已经完成 **检查**。",
          seqStart: 420,
        },
      ]),
    ).toEqual([
      {
        id: "user-42",
        title: "检查历史索引",
        preview: "已经完成 检查。",
        sourceIndex: 0,
        seqStart: 420,
      },
    ]);
  });

  it("keeps a short history compact instead of spreading it over the rail", () => {
    // Four turns in a tall viewport stay at the fixed pitch rather than being spaced
    // ~120px apart, and the rail is centred on a whole pixel.
    expect(
      resolveHistoryIndexRailLayout({ entryCount: 4, availableHeight: 400, markerHeight: 12 }),
    ).toEqual({
      markerCount: 4,
      railHeight: 3 * HISTORY_INDEX_MARKER_PITCH + 12,
      railTop: 182,
    });
  });

  it("drops markers rather than tightening the pitch when height runs out", () => {
    const layout = resolveHistoryIndexRailLayout({
      entryCount: 200,
      availableHeight: 100,
      markerHeight: 12,
    });
    expect(layout.markerCount).toBe(12);
    expect(layout.railHeight).toBe(11 * HISTORY_INDEX_MARKER_PITCH + 12);
    expect(layout.railHeight).toBeLessThanOrEqual(100);
  });

  it("caps the rail at the marker ceiling in a tall viewport", () => {
    expect(
      resolveHistoryIndexRailLayout({ entryCount: 500, availableHeight: 4000, markerHeight: 12 })
        .markerCount,
    ).toBe(60);
  });

  it("reports an empty rail before the band has been measured", () => {
    expect(
      resolveHistoryIndexRailLayout({ entryCount: 10, availableHeight: 0, markerHeight: 12 }),
    ).toEqual({ markerCount: 0, railHeight: 0, railTop: 0 });
  });

  it("creates a smooth local wave around the pointer", () => {
    expect(getHistoryIndexWaveScale(0.5, null)).toBe(1);
    expect(getHistoryIndexWaveScale(0.5, 0.5)).toBe(2.75);
    expect(getHistoryIndexWaveScale(0.43, 0.5)).toBeGreaterThan(1);
    expect(getHistoryIndexWaveScale(0.3, 0.5)).toBe(1);
    expect(getHistoryIndexWaveScale(0.43, 0.5)).toBeCloseTo(getHistoryIndexWaveScale(0.57, 0.5));
  });
});
