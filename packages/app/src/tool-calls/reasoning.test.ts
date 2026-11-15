import { describe, expect, it } from "vitest";
import { resolveReasoningMarkdown } from "./reasoning";

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
});
