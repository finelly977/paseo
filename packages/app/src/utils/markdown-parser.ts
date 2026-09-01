import MarkdownIt from "markdown-it";

/**
 * 应用 Markdown 解析规则的唯一入口。
 *
 * 始终关闭 `typographer`。它会启用 markdown-it 的字符替换规则，把 `(c)` 改成 ©、
 * 把 `a -- b` 改成长横线、把 `...` 改成省略号，并把直引号改成弯引号，导致从
 * 智能体回复复制到终端或文件的内容失真。智能体输出、计划和文件预览必须原样显示。
 *
 * `linkify` 保留为参数：对话和默认渲染器会链接裸 URL，计划卡片保持纯文本；
 * 是否统一这项交互需要单独决策。
 */
export function createMarkdownParser({ linkify }: { linkify: boolean }): MarkdownIt {
  return new MarkdownIt({ html: false, linkify });
}
