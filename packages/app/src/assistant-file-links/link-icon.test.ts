import { describe, expect, it } from "vitest";
import { resolveAssistantLinkIconSvg } from "./link-icon";

describe("assistant link icon resolution", () => {
  it("returns distinct colored icons for md, word, pdf, excel, and web links", () => {
    const mdIcon = resolveAssistantLinkIconSvg({
      source: { href: "docs/fork-features.md" },
      target: null,
    });
    const wordIcon = resolveAssistantLinkIconSvg({
      source: { href: "reports/summary.docx:1" },
      target: null,
    });
    const pdfIcon = resolveAssistantLinkIconSvg({
      source: { href: "./manual.pdf#L12" },
      target: null,
    });
    const excelIcon = resolveAssistantLinkIconSvg({
      source: { href: "data/budget.xlsx" },
      target: null,
    });
    const webIcon = resolveAssistantLinkIconSvg({
      source: { href: "https://openai.com/docs" },
      target: null,
    });

    expect(mdIcon).toContain("#42a5f5");
    expect(wordIcon).toContain("#2b88d8");
    expect(pdfIcon).toContain("#ef5350");
    expect(excelIcon).toContain("#21a366");
    expect(webIcon).toContain("#29b6f6");
    expect(new Set([mdIcon, wordIcon, pdfIcon, excelIcon, webIcon]).size).toBe(5);
  });
});
