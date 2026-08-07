import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAssistantMessageHeightEstimateCache,
  estimateAssistantMessageHeightFromCache,
  setAssistantMarkdownBlockHeight,
} from "./assistant-message-height-estimate";
import {
  clearAssistantImageMetadataCache,
  setAssistantImageMetadata,
} from "./assistant-image-metadata";

describe("assistant message height estimate", () => {
  beforeEach(() => {
    clearAssistantMessageHeightEstimateCache();
    clearAssistantImageMetadataCache();
  });

  it("estimates assistant message height from measured markdown block heights", () => {
    setAssistantMarkdownBlockHeight({
      block: "First paragraph",
      width: 804,
      height: 18.2,
    });
    setAssistantMarkdownBlockHeight({
      block: "Second paragraph",
      width: 804,
      height: 41.1,
    });

    expect(estimateAssistantMessageHeightFromCache("First paragraph\n\nSecond paragraph")).toBe(93);
  });

  it("falls back to image metadata when markdown blocks are not measured", () => {
    setAssistantImageMetadata(
      {
        source: "https://example.com/landscape.png",
      },
      { width: 1200, height: 800 },
    );

    expect(
      estimateAssistantMessageHeightFromCache(
        "Here is the screenshot\n\n![Screenshot](https://example.com/landscape.png)",
      ),
    ).toBeGreaterThan(220);
  });

  it("reuses measured block heights with different paragraph spacing", () => {
    setAssistantMarkdownBlockHeight({
      block: "First paragraph",
      width: 804,
      height: 18.2,
    });
    setAssistantMarkdownBlockHeight({
      block: "Second paragraph",
      width: 804,
      height: 41.1,
    });

    expect(estimateAssistantMessageHeightFromCache("First paragraph\n\nSecond paragraph", 4)).toBe(
      89,
    );
    expect(estimateAssistantMessageHeightFromCache("First paragraph\n\nSecond paragraph", 8)).toBe(
      93,
    );
  });

  it("高度预估不重复计算横线两侧的段落间距", () => {
    setAssistantMarkdownBlockHeight({ block: "Before", width: 804, height: 18 });
    setAssistantMarkdownBlockHeight({ block: "---", width: 804, height: 1 });
    setAssistantMarkdownBlockHeight({ block: "After", width: 804, height: 20 });

    expect(estimateAssistantMessageHeightFromCache("Before\n\n---\n\nAfter", 8)).toBe(63);
  });

  it("falls back to text-feature estimate when nothing is cached", () => {
    // Short single-line message: one paragraph line + vertical padding.
    expect(estimateAssistantMessageHeightFromCache("Short message")).toBeGreaterThan(24);
    // A code block with several lines estimates taller than plain text.
    const plain = estimateAssistantMessageHeightFromCache("line one\nline two\nline three")!;
    const code = estimateAssistantMessageHeightFromCache("```ts\nconst a = 1;\nconst b = 2;\n```")!;
    expect(code).toBeGreaterThan(plain);
  });

  it("caps text-feature estimate to avoid a single huge message anchoring the viewport", () => {
    const huge = "line\n".repeat(500);
    const estimated = estimateAssistantMessageHeightFromCache(huge)!;
    // 40 estimated lines * ~20px + padding, far below the uncapped 500-line height.
    expect(estimated).toBeLessThan(500 * 20);
    expect(estimated).toBeGreaterThan(0);
  });
});
