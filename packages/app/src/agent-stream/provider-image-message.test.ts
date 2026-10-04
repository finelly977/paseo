import { describe, expect, test } from "vitest";

import { getStandaloneMarkdownImage } from "./provider-image-message-model";

describe("Codex 图片工具结果识别", () => {
  test("只识别内容完全由单张 Markdown 图片组成的消息", () => {
    expect(getStandaloneMarkdownImage("![Image](file:///C:/repo/screenshot.png)")).toEqual({
      source: "file:///C:/repo/screenshot.png",
      alt: "Image",
    });
    expect(getStandaloneMarkdownImage("\n![预览](./output.png)\n")).toEqual({
      source: "./output.png",
      alt: "预览",
    });
  });

  test("不会折叠包含说明文字、多张图片或链接图片的助手消息", () => {
    expect(getStandaloneMarkdownImage("结果如下：\n\n![Image](./output.png)")).toBeNull();
    expect(getStandaloneMarkdownImage("![一](./one.png)\n![二](./two.png)")).toBeNull();
    expect(getStandaloneMarkdownImage("[![Image](./output.png)](https://example.com)")).toBeNull();
    expect(getStandaloneMarkdownImage("普通文本")).toBeNull();
  });

  test("沿用 Markdown 解析器处理带空格的路径、引用图片和空描述", () => {
    expect(getStandaloneMarkdownImage('![截图](<file:///C:/my repo/a.png> "窗口")')).toEqual({
      source: "file:///C:/my%20repo/a.png",
      alt: "截图",
    });
    expect(getStandaloneMarkdownImage("![预览][shot]\n\n[shot]: ./output.png")).toEqual({
      source: "./output.png",
      alt: "预览",
    });
    expect(getStandaloneMarkdownImage("![](./output.png)")).toEqual({
      source: "./output.png",
      alt: "",
    });
    expect(getStandaloneMarkdownImage("")).toBeNull();
  });
});
