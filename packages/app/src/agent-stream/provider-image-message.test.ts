import { describe, expect, test } from "vitest";

import { isStandaloneMarkdownImage } from "./provider-image-message-model";

describe("Codex 图片工具结果识别", () => {
  test("只识别内容完全由单张 Markdown 图片组成的消息", () => {
    expect(isStandaloneMarkdownImage("![Image](file:///C:/repo/screenshot.png)")).toBe(true);
    expect(isStandaloneMarkdownImage("\n![预览](./output.png)\n")).toBe(true);
  });

  test("不会折叠包含说明文字、多张图片或链接图片的助手消息", () => {
    expect(isStandaloneMarkdownImage("结果如下：\n\n![Image](./output.png)")).toBe(false);
    expect(isStandaloneMarkdownImage("![一](./one.png)\n![二](./two.png)")).toBe(false);
    expect(isStandaloneMarkdownImage("[![Image](./output.png)](https://example.com)")).toBe(false);
    expect(isStandaloneMarkdownImage("普通文本")).toBe(false);
  });
});
