import { describe, expect, it } from "vitest";
import { renderCommitMessageText } from "./commit-message-text";

describe("renderCommitMessageText", () => {
  it("把行首的“-”分点转换为实心圆点", () => {
    expect(renderCommitMessageText("feat: 新增功能\n\n- 第一项\n- 第二项")).toBe(
      "feat: 新增功能\n\n• 第一项\n• 第二项",
    );
  });

  it("保留嵌套分点的缩进", () => {
    expect(renderCommitMessageText("- 外层\n  - 内层")).toBe("• 外层\n  • 内层");
  });

  it("不修改非分点行", () => {
    expect(renderCommitMessageText("标题\n\n正文\n-不是列表")).toBe("标题\n\n正文\n-不是列表");
  });
});
