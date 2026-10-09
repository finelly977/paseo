import { describe, expect, it } from "vitest";
import { createAssistantMarkdownParser } from "./assistant-markdown-parser";
import { createMarkdownParser } from "./markdown-parser";
import { classifyForResolution } from "@/assistant-file-links/resolver";

describe("createAssistantMarkdownParser", () => {
  it("把 Codex 中文 Windows 文件引用渲染为文件名链接，并保留完整目标路径", () => {
    const parser = createAssistantMarkdownParser();
    const path = String.raw`E:\穗智青锋\演示接口文档\接口文档运用审查.md`;
    const text = `详细交付：\n\n:codex-file-citation{path="${path}" purpose="output"}`;
    const tokens = parser.parse(text, {});
    const inline = tokens.find((token) => token.type === "inline" && token.content.startsWith(":"));
    expect(
      inline?.children?.map(({ type, content, info, attrs }) => ({ type, content, info, attrs })),
    ).toEqual([
      { type: "link_open", content: "", info: "codex-file-citation", attrs: [["href", path]] },
      { type: "text", content: "接口文档运用审查.md", info: "", attrs: null },
      { type: "link_close", content: "", info: "", attrs: null },
    ]);
    expect(
      classifyForResolution(
        { href: path, text: "接口文档运用审查.md", sourceInfo: "codex-file-citation" },
        { workspaceRoot: "E:/另一项目" },
      ),
    ).toEqual({
      kind: "resolved",
      value: {
        kind: "file",
        target: {
          raw: path,
          path: "E:/穗智青锋/演示接口文档/接口文档运用审查.md",
          lineStart: undefined,
          lineEnd: undefined,
        },
      },
    });
  });
  it("支持空格、单引号和相对文件路径，引用行号沿用现有定位规则", () => {
    const parser = createAssistantMarkdownParser();
    const text = ":codex-file-citation{purpose='output' path='docs/接口 审查.md:42'}";
    expect(parser.renderInline(text)).toBe('<a href="docs/接口 审查.md:42">接口 审查.md:42</a>');
    expect(parser.renderInline(':codex-file-citation{path="target.ts:42" purpose="output"}')).toBe(
      '<a href="target.ts:42">target.ts:42</a>',
    );
    expect(
      classifyForResolution(
        {
          href: "docs/接口 审查.md:42",
          text: "接口 审查.md:42",
          sourceInfo: "codex-file-citation",
        },
        { workspaceRoot: "/workspace" },
      ),
    ).toEqual({
      kind: "resolved",
      value: {
        kind: "file",
        target: {
          raw: "docs/接口 审查.md:42",
          path: "/workspace/docs/接口 审查.md",
          lineStart: 42,
          lineEnd: undefined,
        },
      },
    });
  });
  it("不解释代码、转义或未闭合文件引用，文件预览仍显示原始标记", () => {
    const parser = createAssistantMarkdownParser();
    const directive = ':codex-file-citation{path="src/app.ts" purpose="output"}';
    const escaped = ":codex-file-citation{path=&quot;src/app.ts&quot; purpose=&quot;output&quot;}";
    expect(parser.renderInline(`\`${directive}\``)).toBe(`<code>${escaped}</code>`);
    expect(parser.renderInline(`\\${directive}`)).toBe(escaped);
    expect(parser.render(`\`\`\`text\n${directive}\n\`\`\`\n`)).toBe(
      `<pre><code class="language-text">${escaped}\n</code></pre>\n`,
    );
    expect(parser.renderInline(':codex-file-citation{path="src/app.ts"')).not.toContain("<a");
    expect(parser.renderInline(':codex-file-citation{path="javascript:alert(1)"}')).not.toContain(
      "<a",
    );
    expect(
      parser.renderInline(':codex-file-citation{path="src/app.ts" path="other.ts"}'),
    ).not.toContain("<a");
    expect(createMarkdownParser({ linkify: false }).renderInline(directive)).toBe(escaped);
    expect(parser.renderInline(`[${directive}](https://example.test)`)).toBe(
      `<a href="https://example.test">${escaped}</a>`,
    );
  });
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
