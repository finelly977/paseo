import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { formatCompletedTurnDuration } from "@/agent-stream/completed-turn-process";

const MAX_THOUGHT_PREVIEW_LENGTH = 120;

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

/** 提取思考正文首条非空行的可读纯文本预览，供折叠行紧凑展示。 */
export function extractThoughtPreview(text: string): string | undefined {
  for (const rawLine of text.split(/\r?\n/u)) {
    const cleaned = rawLine
      .trim()
      .replace(/^(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+[.)]\s+)/u, "")
      .replace(/[*_`~]/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
    if (!cleaned) continue;
    if (cleaned.length <= MAX_THOUGHT_PREVIEW_LENGTH) return cleaned;
    return `${cleaned.slice(0, MAX_THOUGHT_PREVIEW_LENGTH - 1).trimEnd()}…`;
  }
  return undefined;
}

/** 仅在持有真实开始与结束时间且达到 1 秒时计算思考耗时，不伪造零秒。 */
export function resolveThoughtDurationMs(input: {
  startedAt?: Date;
  timestamp?: Date;
  timestampUnknown?: boolean;
}): number | null {
  if (input.timestampUnknown || !input.startedAt || !input.timestamp) {
    return null;
  }
  const durationMs = input.timestamp.getTime() - input.startedAt.getTime();
  return durationMs >= 1_000 ? durationMs : null;
}

export function formatThoughtSecondaryLabel(input: {
  text: string;
  durationMs?: number | null;
}): string | undefined {
  const parts: string[] = [];
  if (input.durationMs !== null && input.durationMs !== undefined && input.durationMs >= 1_000) {
    parts.push(formatCompletedTurnDuration(input.durationMs));
  }
  const preview = extractThoughtPreview(input.text);
  if (preview) {
    parts.push(preview);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
