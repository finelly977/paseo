/** 行首为“- ”时视为 Markdown 分点，渲染为 VS Code 风格的实心圆点“•”。 */
const BULLET_LINE_PATTERN = /^(\s*)- (.*)$/;

export function renderCommitMessageText(message: string): string {
  return message
    .split("\n")
    .map((line) => line.replace(BULLET_LINE_PATTERN, "$1• $2"))
    .join("\n");
}
