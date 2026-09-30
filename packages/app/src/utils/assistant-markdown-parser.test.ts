import { describe, expect, it } from "vitest";
import { createAssistantMarkdownParser } from "./assistant-markdown-parser";
import { createMarkdownParser } from "./markdown-parser";

describe("createAssistantMarkdownParser", () => {
  it("渲染结尾标记前有空格的粗体，不遗留星号", () => {
    const parser = createAssistantMarkdownParser();
    expect(parser.renderInline("**确认存在额外开销： **桌面端用完整 CLI 诊断检查")).toBe(
      "<strong>确认存在额外开销： </strong>桌面端用完整 CLI 诊断检查",
    );
  });
  it("中文标点后的粗体可以紧接正文，嵌套强调保持正确", () => {
    const parser = createAssistantMarkdownParser();
    expect(parser.renderInline("**确认存在额外开销：**桌面端检查")).toBe(
      "<strong>确认存在额外开销：</strong>桌面端检查",
    );
    expect(parser.renderInline("**带 *强调* 的说明： **后文")).toBe(
      "<strong>带 <em>强调</em> 的说明： </strong>后文",
    );
  });
  it("保留代码、转义、未闭合标记和文件预览的标准规则", () => {
    const parser = createAssistantMarkdownParser();
    expect(parser.renderInline("`**开销： **` 正文")).toBe("<code>**开销： **</code> 正文");
    expect(parser.render("```text\n**开销： **\n```\n")).toBe(
      '<pre><code class="language-text">**开销： **\n</code></pre>\n',
    );
    expect(parser.renderInline("\\*\\*开销： **")).toBe("**开销： **");
    expect(parser.renderInline("**没有结束标记")).toBe("**没有结束标记");
    expect(parser.renderInline("**正常粗体** 与 **第二段**")).toBe(
      "<strong>正常粗体</strong> 与 <strong>第二段</strong>",
    );
    expect(parser.renderInline("**一： **后文 **二： **结束")).toBe(
      "<strong>一： </strong>后文 <strong>二： </strong>结束",
    );
    expect(createMarkdownParser({ linkify: false }).renderInline("**开销： **正文")).toBe(
      "**开销： **正文",
    );
  });
  it("renders agent text verbatim", () => {
    const parser = createAssistantMarkdownParser();

    // 覆盖已报告的字符替换问题及同一排版规则触发的其他替换。
    expect(parser.renderInline("(c) (C) (r) (tm) (p)")).toBe("(c) (C) (r) (tm) (p)");
    expect(parser.renderInline("wait for it...")).toBe("wait for it...");
    expect(parser.renderInline("a -- b")).toBe("a -- b");
    // 同时关闭弯引号，确保内容能原样粘贴到终端。
    expect(parser.renderInline(`run --name="my repo"`)).toBe("run --name=&quot;my repo&quot;");
    expect(parser.renderInline("it's fine")).toBe("it's fine");
  });

  it("allows file:// links, unlike every other parser", () => {
    const parser = createAssistantMarkdownParser();

    expect(parser.render("[open](file:///tmp/a.ts)")).toContain('href="file:///tmp/a.ts"');
  });

  it("still rejects javascript: links", () => {
    const parser = createAssistantMarkdownParser();

    expect(parser.render("[x](javascript:alert(1))")).not.toContain("href");
  });
});
