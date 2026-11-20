import { describe, expect, it } from "vitest";
import {
  getMarkdownBlockGap,
  isStandaloneMarkdownHorizontalRule,
  splitMarkdownBlocks,
  splitMarkdownBlocksIncremental,
  type IncrementalMarkdownBlocksState,
} from "../split-markdown-blocks";

describe("splitMarkdownBlocks", () => {
  it("returns a single block for a single paragraph", () => {
    expect(splitMarkdownBlocks("Hello world")).toEqual(["Hello world"]);
  });

  it("splits two paragraphs separated by a double newline", () => {
    expect(splitMarkdownBlocks("First paragraph\n\nSecond paragraph")).toEqual([
      "First paragraph",
      "Second paragraph",
    ]);
  });

  it("keeps a fenced code block with internal double newlines as one block", () => {
    expect(splitMarkdownBlocks("```ts\nconst a = 1;\n\nconst b = 2;\n```")).toEqual([
      "```ts\nconst a = 1;\n\nconst b = 2;\n```",
    ]);
  });

  it("does not treat 4-space-indented backticks as a fence", () => {
    expect(splitMarkdownBlocks("Before\n\n    ```\n    code\n    ```\n\nAfter")).toEqual([
      "Before",
      "    ```\n    code\n    ```",
      "After",
    ]);
  });

  it("handles tilde fences", () => {
    expect(splitMarkdownBlocks("Before\n\n~~~\ncode\n~~~\n\nAfter")).toEqual([
      "Before",
      "~~~\ncode\n~~~",
      "After",
    ]);
  });

  it("splits mixed paragraph, code fence, and paragraph content into three blocks", () => {
    expect(
      splitMarkdownBlocks(
        "Intro paragraph\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nOutro paragraph",
      ),
    ).toEqual(["Intro paragraph", "```ts\nconst a = 1;\n\nconst b = 2;\n```", "Outro paragraph"]);
  });

  it("keeps everything from an unclosed fence start as one block for streaming content", () => {
    expect(splitMarkdownBlocks("Before fence\n\n```ts\nconst a = 1;\n\nconst b = 2;")).toEqual([
      "Before fence",
      "```ts\nconst a = 1;\n\nconst b = 2;",
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(splitMarkdownBlocks("")).toEqual([]);
  });

  it("splits a heading followed by a paragraph into two blocks", () => {
    expect(splitMarkdownBlocks("# Heading\n\nParagraph text")).toEqual([
      "# Heading",
      "Paragraph text",
    ]);
  });

  it("keeps consecutive list items together when there is no double newline", () => {
    expect(splitMarkdownBlocks("- First item\n- Second item\n- Third item")).toEqual([
      "- First item\n- Second item\n- Third item",
    ]);
  });

  it("treats triple newlines as a split point and filters empty blocks", () => {
    expect(splitMarkdownBlocks("First paragraph\n\n\nSecond paragraph")).toEqual([
      "First paragraph",
      "Second paragraph",
    ]);
  });

  it("识别独立 Markdown 横线且不把缩进代码误判为横线", () => {
    expect(isStandaloneMarkdownHorizontalRule("---")).toBe(true);
    expect(isStandaloneMarkdownHorizontalRule("* * *")).toBe(true);
    expect(isStandaloneMarkdownHorizontalRule("    ---")).toBe(false);
    expect(isStandaloneMarkdownHorizontalRule("---\ntext")).toBe(false);
  });

  it("横线两侧不再叠加段落间距", () => {
    expect(getMarkdownBlockGap("Before", "---", 8)).toBe(0);
    expect(getMarkdownBlockGap("---", "After", 8)).toBe(0);
    expect(getMarkdownBlockGap("Before", "After", 8)).toBe(8);
  });

  it("增量切分在任意字符和围栏边界下与全量切分严格等价，并复用前置稳定块", () => {
    const sample = [
      "# 标题",
      "",
      "第一段中英文混排 mixed content 👨‍👩‍👧‍👦 与 [链接](https://example.com)。",
      "",
      "---",
      "",
      "```ts",
      "const a = 1;",
      "",
      "const b = 2;",
      "```",
      "",
      "| Col1 | Col2 |",
      "| ---- | ---- |",
      "| val1 | val2 |",
      "",
      "- item 1",
      "- item 2",
      "",
      "尾段内容",
    ].join("\n");

    let state: IncrementalMarkdownBlocksState | null = null;
    for (let len = 1; len <= sample.length; len += 3) {
      const prefix = sample.slice(0, len);
      state = splitMarkdownBlocksIncremental(state, prefix);
      expect(state.blocks).toEqual(splitMarkdownBlocks(prefix));
    }
    state = splitMarkdownBlocksIncremental(state, sample);
    expect(state.blocks).toEqual(splitMarkdownBlocks(sample));
    expect(state.stableBlockCount).toBe(state.blocks.length - 1);

    // 缩短或切换文本时立即回退重新扫描
    const reset = splitMarkdownBlocksIncremental(state, "全新短文本");
    expect(reset.blocks).toEqual(["全新短文本"]);
    expect(reset.stableBlockCount).toBe(0);
  });
});
