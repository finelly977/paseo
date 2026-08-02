import { describe, expect, it } from "vitest";
import { estimateWrappedCharsPerLine } from "./diff-wrap-estimate";

describe("estimateWrappedCharsPerLine", () => {
  it("fits fewer chars at larger font sizes", () => {
    const small = estimateWrappedCharsPerLine(12);
    const large = estimateWrappedCharsPerLine(18);
    expect(large).toBeLessThan(small);
    expect(small).toBeGreaterThan(0);
  });

  it("matches the 280px budget at 14px code font (0.6em glyphs)", () => {
    // 280 / (14 * 0.6) ≈ 33.3 → 33 chars per line.
    expect(estimateWrappedCharsPerLine(14)).toBe(33);
  });

  it("never returns zero even for large fonts", () => {
    expect(estimateWrappedCharsPerLine(100)).toBeGreaterThan(0);
  });
});
