import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  getAssistantBlockSpacing,
  getGapBetweenStreamItems,
  isSameAssistantBlockGroup,
} from "./spacing";

function assistantBlock(params: {
  id: string;
  blockGroupId: string;
  blockIndex: number;
  text?: string;
}): Extract<StreamItem, { kind: "assistant_message" }> {
  return {
    kind: "assistant_message",
    id: params.id,
    blockGroupId: params.blockGroupId,
    blockIndex: params.blockIndex,
    text: params.text ?? "",
    timestamp: new Date("2026-05-01T00:00:00.000Z"),
  };
}

function toolCallBlock(id: string): Extract<StreamItem, { kind: "tool_call" }> {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date("2026-05-01T00:00:00.000Z"),
    payload: {
      source: "orchestrator",
      data: {
        toolCallId: id,
        toolName: "bash",
        arguments: "cmd",
        result: null,
        status: "executing",
      },
    },
  };
}

describe("isSameAssistantBlockGroup", () => {
  it("returns true for two assistant blocks with the same blockGroupId", () => {
    const a = assistantBlock({ id: "a", blockGroupId: "group-1", blockIndex: 0 });
    const b = assistantBlock({ id: "b", blockGroupId: "group-1", blockIndex: 1 });
    expect(isSameAssistantBlockGroup({ item: a, other: b })).toBe(true);
  });

  it("returns false for blocks from different groups", () => {
    const a = assistantBlock({ id: "a", blockGroupId: "group-1", blockIndex: 0 });
    const b = assistantBlock({ id: "b", blockGroupId: "group-2", blockIndex: 0 });
    expect(isSameAssistantBlockGroup({ item: a, other: b })).toBe(false);
  });

  it("returns false when one item is not an assistant_message", () => {
    const a = assistantBlock({ id: "a", blockGroupId: "group-1", blockIndex: 0 });
    const tc = toolCallBlock("tc-1");
    expect(isSameAssistantBlockGroup({ item: a, other: tc })).toBe(false);
  });

  it("returns false for null neighbors", () => {
    const a = assistantBlock({ id: "a", blockGroupId: "group-1", blockIndex: 0 });
    expect(isSameAssistantBlockGroup({ item: a, other: null })).toBe(false);
  });
});

describe("getAssistantBlockSpacing", () => {
  it("returns default for non-assistant items", () => {
    const tc = toolCallBlock("tc-1");
    expect(getAssistantBlockSpacing({ item: tc, aboveItem: null, belowItem: null })).toBe(
      "default",
    );
  });

  it("returns default when no same-group neighbors exist", () => {
    const a = assistantBlock({ id: "a", blockGroupId: "group-1", blockIndex: 0 });
    expect(getAssistantBlockSpacing({ item: a, aboveItem: null, belowItem: null })).toBe("default");
  });

  it("returns compactTop when the item above is in the same block group", () => {
    const above = assistantBlock({ id: "above", blockGroupId: "group-1", blockIndex: 0 });
    const item = assistantBlock({ id: "item", blockGroupId: "group-1", blockIndex: 1 });
    expect(getAssistantBlockSpacing({ item, aboveItem: above, belowItem: null })).toBe(
      "compactTop",
    );
  });

  it("returns compactBottom when the item below is in the same block group", () => {
    const item = assistantBlock({ id: "item", blockGroupId: "group-1", blockIndex: 0 });
    const below = assistantBlock({ id: "below", blockGroupId: "group-1", blockIndex: 1 });
    expect(getAssistantBlockSpacing({ item, aboveItem: null, belowItem: below })).toBe(
      "compactBottom",
    );
  });

  it("returns compactBoth when both neighbors are in the same block group", () => {
    const above = assistantBlock({ id: "above", blockGroupId: "group-1", blockIndex: 0 });
    const item = assistantBlock({ id: "item", blockGroupId: "group-1", blockIndex: 1 });
    const below = assistantBlock({ id: "below", blockGroupId: "group-1", blockIndex: 2 });
    expect(getAssistantBlockSpacing({ item, aboveItem: above, belowItem: below })).toBe(
      "compactBoth",
    );
  });

  it("spans the history/live-head boundary: tail gets compactBottom, head gets compactTop", () => {
    const tailBlock = assistantBlock({
      id: "group-1:block:0",
      blockGroupId: "group-1",
      blockIndex: 0,
      text: "First paragraph",
    });
    const headBlock = assistantBlock({
      id: "group-1:head",
      blockGroupId: "group-1",
      blockIndex: 1,
      text: "Second paragraph",
    });

    expect(
      getAssistantBlockSpacing({ item: tailBlock, aboveItem: null, belowItem: headBlock }),
    ).toBe("compactBottom");
    expect(
      getAssistantBlockSpacing({ item: headBlock, aboveItem: tailBlock, belowItem: null }),
    ).toBe("compactTop");
  });
});

describe("getGapBetweenStreamItems", () => {
  it("独立横线两侧由横线自身留白，不再叠加消息间距", () => {
    const divider = assistantBlock({
      id: "divider",
      blockGroupId: "answer",
      blockIndex: 0,
      text: "---",
    });
    const answer = assistantBlock({
      id: "answer",
      blockGroupId: "answer",
      blockIndex: 1,
      text: "正文",
    });

    expect(getGapBetweenStreamItems(toolCallBlock("tool"), divider, 24)).toBe(0);
    expect(getGapBetweenStreamItems(divider, answer, 24)).toBe(0);
  });

  it("横线与正文合在同一条消息时仍去掉边界重复间距", () => {
    const startsWithDivider = assistantBlock({
      id: "start",
      blockGroupId: "start",
      blockIndex: 0,
      text: "\n\n---\n\n接着说明",
    });
    const endsWithDivider = assistantBlock({
      id: "end",
      blockGroupId: "end",
      blockIndex: 0,
      text: "前面说明\n\n* * *\n\n",
    });
    const tool = toolCallBlock("tool");

    expect(getGapBetweenStreamItems(tool, startsWithDivider, 24)).toBe(0);
    expect(getGapBetweenStreamItems(endsWithDivider, tool, 24)).toBe(0);
    expect(getGapBetweenStreamItems(startsWithDivider, tool, 24)).toBe(8);
    expect(getGapBetweenStreamItems(tool, endsWithDivider, 24)).toBe(8);
  });

  it("代码里的横线、缩进代码和标题下划线不改变消息间距", () => {
    const tool = toolCallBlock("tool");
    for (const text of ["```\n---\n```", "    ---", "标题\n---"]) {
      const message = assistantBlock({ id: text, blockGroupId: "answer", blockIndex: 0, text });
      expect(getGapBetweenStreamItems(tool, message, 24)).toBe(8);
      expect(getGapBetweenStreamItems(message, tool, 24)).toBe(8);
    }
  });

  it("uses one compact turn gap without component-level spacing duplication", () => {
    expect(
      getGapBetweenStreamItems(
        assistantBlock({ id: "answer", blockGroupId: "answer", blockIndex: 0 }),
        { kind: "user_message", id: "next", text: "next", timestamp: new Date() },
      ),
    ).toBe(12);
  });

  it("keeps compaction separators closer to surrounding content", () => {
    expect(
      getGapBetweenStreamItems(
        assistantBlock({ id: "answer", blockGroupId: "answer", blockIndex: 0 }),
        { kind: "compaction", id: "compact", status: "completed", timestamp: new Date() },
      ),
    ).toBe(0);
  });

  it("按设置值等比例调整不同关系的消息间距", () => {
    const assistant = assistantBlock({ id: "answer", blockGroupId: "answer", blockIndex: 0 });
    const user = { kind: "user_message", id: "next", text: "next", timestamp: new Date() } as const;
    const tool = toolCallBlock("tool");

    expect(getGapBetweenStreamItems(assistant, user, 24)).toBe(24);
    expect(getGapBetweenStreamItems(assistant, tool, 24)).toBe(8);
    expect(getGapBetweenStreamItems(user, tool, 24)).toBe(16);
  });
});
