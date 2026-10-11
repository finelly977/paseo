import { describe, expect, test } from "vitest";
import { getStandaloneMarkdownImages } from "./provider-image-message-model";

describe("Codex 图片工具结果识别", () => {
  test("同一来源重复出现时保留两张图片，并提供独立的稳定标识", () => {
    expect(getStandaloneMarkdownImages("![一](./same.png)![二](./same.png)")).toEqual([
      { key: "./same.png:0", source: "./same.png", alt: "一" },
      { key: "./same.png:1", source: "./same.png", alt: "二" },
    ]);
  });
  test("连续图片结果合并在同一消息或分段后仍分别识别为缩略图", () => {
    const expected = [
      { key: "file:///C:/repo/one.png:0", source: "file:///C:/repo/one.png", alt: "一" },
      { key: "file:///C:/repo/two.png:0", source: "file:///C:/repo/two.png", alt: "二" },
    ];
    expect(
      getStandaloneMarkdownImages("![一](file:///C:/repo/one.png)![二](file:///C:/repo/two.png)"),
    ).toEqual(expected);
    expect(
      getStandaloneMarkdownImages(
        "![一](file:///C:/repo/one.png)\n\n![二](file:///C:/repo/two.png)",
      ),
    ).toEqual(expected);
    expect(
      getStandaloneMarkdownImages(
        "![一](file:///C:/repo/one.png) \n ![二](file:///C:/repo/two.png)",
      ),
    ).toEqual(expected);
  });

  test("单张图片继续使用原有缩略图入口", () => {
    expect(getStandaloneMarkdownImages("![Image](file:///C:/repo/screenshot.png)")).toEqual([
      {
        key: "file:///C:/repo/screenshot.png:0",
        source: "file:///C:/repo/screenshot.png",
        alt: "Image",
      },
    ]);
    expect(getStandaloneMarkdownImages("\n![预览](./output.png)\n")).toEqual([
      { key: "./output.png:0", source: "./output.png", alt: "预览" },
    ]);
  });

  test("不会折叠包含说明文字、代码或链接图片的普通助手消息", () => {
    expect(getStandaloneMarkdownImages("结果如下：\n\n![Image](./output.png)")).toBeNull();
    expect(getStandaloneMarkdownImages("[![Image](./output.png)](https://example.com)")).toBeNull();
    expect(getStandaloneMarkdownImages("```markdown\n![Image](./output.png)\n```")).toBeNull();
    expect(getStandaloneMarkdownImages("普通文本")).toBeNull();
  });

  test("沿用 Markdown 解析器处理带空格路径、引用图片与空描述", () => {
    expect(getStandaloneMarkdownImages('![截图](<file:///C:/my repo/a.png> "窗口")')).toEqual([
      { key: "file:///C:/my%20repo/a.png:0", source: "file:///C:/my%20repo/a.png", alt: "截图" },
    ]);
    expect(getStandaloneMarkdownImages("![预览][shot]\n\n[shot]: ./output.png")).toEqual([
      { key: "./output.png:0", source: "./output.png", alt: "预览" },
    ]);
    expect(getStandaloneMarkdownImages("![](./output.png)")).toEqual([
      { key: "./output.png:0", source: "./output.png", alt: "" },
    ]);
    expect(getStandaloneMarkdownImages("")).toBeNull();
  });
});
