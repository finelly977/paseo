import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import type { ConversationHistoryIndexEntry } from "./history-index-model";
import {
  buildConversationHistoryIndex,
  buildConversationHistoryIndexFromSummaries,
  getHistoryIndexWaveScale,
  HISTORY_INDEX_MAX_HEIGHT,
  HISTORY_INDEX_MARKER_PITCH,
  mergeConversationHistoryIndexEntries,
  resolveHistoryIndexRailLayout,
} from "./history-index-model";

function loadedEntry(id: string, seq?: number): ConversationHistoryIndexEntry {
  return {
    id,
    title: `Turn ${id}`,
    preview: "",
    sourceIndex: 0,
    ...(seq === undefined ? {} : { seqStart: seq }),
  };
}

function summaryEntry(id: string, seq: number): ConversationHistoryIndexEntry {
  return { id, title: `Turn ${id}`, preview: "", sourceIndex: 0, seqStart: seq };
}

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
      markerPitch: HISTORY_INDEX_MARKER_PITCH,
      railHeight: 3 * HISTORY_INDEX_MARKER_PITCH + 12,
      contentHeight: 3 * HISTORY_INDEX_MARKER_PITCH + 12,
      railTop: 182,
    });
  });

  it("保持固定刻度并限制轨道高度", () => {
    const layout = resolveHistoryIndexRailLayout({
      entryCount: 200,
      availableHeight: 100,
      markerHeight: 12,
    });
    expect(layout.markerCount).toBe(200);
    expect(layout.markerPitch).toBe(HISTORY_INDEX_MARKER_PITCH);
    expect(layout.contentHeight).toBe(199 * HISTORY_INDEX_MARKER_PITCH + 12);
    expect(layout.railHeight).toBe(100);
  });

  it("长索引不超过固定最大高度", () => {
    const layout = resolveHistoryIndexRailLayout({
      entryCount: 200,
      availableHeight: 1000,
      markerHeight: 12,
    });

    expect(layout.railHeight).toBe(HISTORY_INDEX_MAX_HEIGHT);
    expect(layout.railTop).toBe((1000 - HISTORY_INDEX_MAX_HEIGHT) / 2);
  });

  it("reports an empty rail before the band has been measured", () => {
    expect(
      resolveHistoryIndexRailLayout({ entryCount: 10, availableHeight: 0, markerHeight: 12 }),
    ).toEqual({ markerCount: 0, markerPitch: 0, railHeight: 0, contentHeight: 0, railTop: 0 });
  });

  it("creates a smooth local wave around the pointer", () => {
    // 指针未悬停：无波浪
    expect(getHistoryIndexWaveScale(100, null, 480)).toBe(1);
    // 指针正好在刻度上：最大缩放；半径按可见高度 480px 的 0.14 ≈ 67px
    expect(getHistoryIndexWaveScale(100, 100, 480)).toBe(2.75);
    expect(getHistoryIndexWaveScale(100, 140, 480)).toBeGreaterThan(1);
    // 半径外：无波浪
    expect(getHistoryIndexWaveScale(100, 200, 480)).toBe(1);
    // 对称性
    expect(getHistoryIndexWaveScale(100, 140, 480)).toBeCloseTo(
      getHistoryIndexWaveScale(100, 60, 480),
    );
  });

  it("scales the wave by the visible rail height, not the full content height", () => {
    // 可见高度 1604px → 半径 ≈ 225px：200px 距离仍在波浪内
    expect(getHistoryIndexWaveScale(0, 200, 1604)).toBeGreaterThan(1);
    // 可见高度 480px → 半径 ≈ 67px：200px 距离已在波浪外
    expect(getHistoryIndexWaveScale(0, 200, 480)).toBe(1);
    // 同一物理距离下，可见高度越大半径越大，刻度离波峰中心越近、缩放越大
    expect(getHistoryIndexWaveScale(0, 50, 1604)).toBeGreaterThan(
      getHistoryIndexWaveScale(0, 50, 480),
    );
  });

  it("merge 本地与索引完全同步时只保留索引条目", () => {
    const merged = mergeConversationHistoryIndexEntries({
      summaries: [summaryEntry("a", 1), summaryEntry("b", 2), summaryEntry("c", 3)],
      loaded: [loadedEntry("a", 1), loadedEntry("b", 2), loadedEntry("c", 3)],
    });
    expect(merged.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(merged.map((entry) => entry.sourceIndex)).toEqual([0, 1, 2]);
  });

  it("merge 索引滞后时把本地更新的消息追加到尾部", () => {
    const merged = mergeConversationHistoryIndexEntries({
      summaries: [summaryEntry("a", 1), summaryEntry("b", 2)],
      loaded: [loadedEntry("a", 1), loadedEntry("b", 2), loadedEntry("c", 3)],
    });
    expect(merged.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(merged[2]?.seqStart).toBe(3);
  });

  it("merge 对话进行中未确认的投影消息（无游标）保留在尾部", () => {
    const merged = mergeConversationHistoryIndexEntries({
      summaries: [summaryEntry("a", 1), summaryEntry("b", 2)],
      loaded: [loadedEntry("a", 1), loadedEntry("b", 2), loadedEntry("proj-c")],
    });
    expect(merged.map((entry) => entry.id)).toEqual(["a", "b", "proj-c"]);
  });

  it("merge 投影消息已被索引采用时不重复追加", () => {
    const merged = mergeConversationHistoryIndexEntries({
      summaries: [summaryEntry("a", 1), summaryEntry("b", 2), summaryEntry("c", 3)],
      loaded: [loadedEntry("a", 1), loadedEntry("b", 2), loadedEntry("c")],
    });
    expect(merged.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(merged).toHaveLength(3);
  });

  it("merge 切回会话时索引已含最新消息、本地尾部无游标也不重复", () => {
    const merged = mergeConversationHistoryIndexEntries({
      summaries: [
        summaryEntry("a", 1),
        summaryEntry("b", 2),
        summaryEntry("c", 3),
        summaryEntry("d", 4),
      ],
      loaded: [loadedEntry("a", 1), loadedEntry("b", 2), loadedEntry("c", 3), loadedEntry("d")],
    });
    expect(merged.map((entry) => entry.id)).toEqual(["a", "b", "c", "d"]);
    expect(merged).toHaveLength(4);
  });

  it("merge 旧历史无游标且已被索引采用时跳过，不会出现在尾部", () => {
    const merged = mergeConversationHistoryIndexEntries({
      summaries: [
        summaryEntry("old-a", 1),
        summaryEntry("b", 2),
        summaryEntry("c", 3),
        summaryEntry("d", 4),
      ],
      loaded: [loadedEntry("old-a"), loadedEntry("b", 2), loadedEntry("c", 3), loadedEntry("d", 4)],
    });
    expect(merged.map((entry) => entry.id)).toEqual(["old-a", "b", "c", "d"]);
    expect(merged.at(-1)?.id).toBe("d");
  });

  it("merge 索引为空时直接返回本地条目", () => {
    const merged = mergeConversationHistoryIndexEntries({
      summaries: [],
      loaded: [loadedEntry("a", 1), loadedEntry("proj-b")],
    });
    expect(merged.map((entry) => entry.id)).toEqual(["a", "proj-b"]);
  });
});
