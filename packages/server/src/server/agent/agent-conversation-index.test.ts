import { describe, expect, test } from "vitest";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { buildAgentConversationIndex } from "./agent-conversation-index.js";

function row(seq: number, item: AgentTimelineRow["item"]): AgentTimelineRow {
  return { seq, item, timestamp: `2026-07-26T00:00:${String(seq).padStart(2, "0")}.000Z` };
}

describe("buildAgentConversationIndex", () => {
  test("返回全部对话并合并助手摘要", () => {
    const rows = Array.from({ length: 55 }, (_, index) => [
      row(index * 2 + 1, {
        type: "user_message" as const,
        text: `问题 ${index + 1}`,
        messageId: `user-${index + 1}`,
      }),
      row(index * 2 + 2, {
        type: "assistant_message" as const,
        text: `回答 ${index + 1}`,
      }),
    ]).flat();

    const index = buildAgentConversationIndex(rows);

    expect(index).toHaveLength(55);
    expect(index[0]).toMatchObject({
      messageId: "user-1",
      text: "问题 1",
      assistantPreview: "回答 1",
      seqStart: 1,
    });
    expect(index.at(-1)).toMatchObject({ messageId: "user-55", seqStart: 109 });
  });
});
