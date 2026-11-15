import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";

/** 只把思考摘要交给 Markdown，普通工具的文本和符号保持原样。 */
export function resolveReasoningMarkdown(
  toolName: string | undefined,
  detail: ToolCallDetail | undefined,
): string | null {
  if (toolName !== "thinking" || !detail) return null;
  if (detail.type === "plain_text") return detail.text ?? null;
  if (detail.type === "unknown" && typeof detail.input === "string" && detail.output === null)
    return detail.input;
  return null;
}
