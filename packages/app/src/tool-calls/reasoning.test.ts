import { describe, expect, it } from "vitest";
import {
  extractThoughtPreview,
  formatThoughtSecondaryLabel,
  resolveReasoningMarkdown,
  resolveThoughtDurationMs,
} from "./reasoning";

describe("思考摘要 Markdown", () => {
  it("将推理摘要交给 Markdown 渲染，不改写原始星号", () => {
    const text = "**Reviewing model selection**\n\n**Preserving permission control width**";
    expect(
      resolveReasoningMarkdown("thinking", { type: "unknown", input: text, output: null }),
    ).toBe(text);
    expect(resolveReasoningMarkdown("thinking", { type: "plain_text", text })).toBe(text);
  });
  it("不把普通工具输出和结构化输入当成推理 Markdown", () => {
    expect(resolveReasoningMarkdown("shell", { type: "plain_text", text: "a * b" })).toBeNull();
    expect(
      resolveReasoningMarkdown("thinking", {
        type: "unknown",
        input: { text: "摘要" },
        output: null,
      }),
    ).toBeNull();
    expect(
      resolveReasoningMarkdown("thinking", { type: "unknown", input: "输入", output: "输出" }),
    ).toBeNull();
    expect(resolveReasoningMarkdown("thinking", undefined)).toBeNull();
    expect(resolveReasoningMarkdown("thinking", { type: "plain_text" })).toBeNull();
  });

  it("提取紧凑单行思考预览并在有真实耗时时拼接时长", () => {
    expect(extractThoughtPreview("\n\n**检查 `grouping.ts` 边界**\n\n更多细节")).toBe(
      "检查 grouping.ts 边界",
    );
    expect(extractThoughtPreview("### 1. 验证流式追尾")).toBe("1. 验证流式追尾");
    expect(extractThoughtPreview("   \n\t  ")).toBeUndefined();

    expect(
      resolveThoughtDurationMs({
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        timestamp: new Date("2026-01-01T00:00:17.200Z"),
      }),
    ).toBe(17_200);
    expect(
      resolveThoughtDurationMs({
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        timestamp: new Date("2026-01-01T00:00:00.800Z"),
      }),
    ).toBeNull();
    expect(
      resolveThoughtDurationMs({
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        timestamp: new Date("2026-01-01T00:00:17.200Z"),
        timestampUnknown: true,
      }),
    ).toBeNull();

    expect(formatThoughtSecondaryLabel({ text: "**检查分组**", durationMs: 17_200 })).toBe(
      "17s · 检查分组",
    );
    expect(formatThoughtSecondaryLabel({ text: "**检查分组**", durationMs: null })).toBe(
      "检查分组",
    );
    expect(formatThoughtSecondaryLabel({ text: "   ", durationMs: 12_000 })).toBe("12s");
  });
});
