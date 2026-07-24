import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  buildConversationHistoryIndex,
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
});
