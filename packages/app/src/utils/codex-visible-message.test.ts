import { describe, expect, it } from "vitest";
import { stripCodexGitDirectives } from "./codex-visible-message";

describe("stripCodexGitDirectives", () => {
  it("移除 Codex 消息末尾的 Git 界面指令", () => {
    expect(
      stripCodexGitDirectives(
        [
          "构建完成。",
          '::git-stage{cwd="E:\\paseo"}',
          '::git-commit{cwd="E:\\paseo"}',
          '::git-push{cwd="E:\\paseo" branch="main"}',
        ].join("\n"),
      ),
    ).toBe("构建完成。");
  });

  it("保留代码块中用于说明的 Git 指令", () => {
    const text = ["```text", '::git-stage{cwd="E:\\paseo"}', "```"].join("\n");
    expect(stripCodexGitDirectives(text)).toBe(text);
  });

  it("不改动普通消息和其他提供方可能使用的相似文本", () => {
    const text = '普通内容\n::code-comment{title="示例"}';
    expect(stripCodexGitDirectives(text)).toBe(text);
  });
});
