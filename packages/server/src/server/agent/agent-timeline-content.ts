import type { AgentTimelineItem } from "./agent-sdk-types.js";

const TOOL_CALL_CONTENT_MAX_BYTES = 64 * 1024;
const TOOL_CALL_CONTENT_TRUNCATION_MARKER = "\n...<tool output truncated in the middle>...\n";

function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function takeFirstUtf8Bytes(text: string, maxBytes: number): string {
  let low = 0;
  let high = text.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    if (utf8ByteLength(text.slice(0, midpoint)) <= maxBytes) {
      low = midpoint;
    } else {
      high = midpoint - 1;
    }
  }
  if (low > 0 && low < text.length && /[\uD800-\uDBFF]/.test(text[low - 1] ?? "")) {
    low -= 1;
  }
  return text.slice(0, low);
}

function takeLastUtf8Bytes(text: string, maxBytes: number): string {
  let low = 0;
  let high = text.length;
  while (low < high) {
    const length = Math.ceil((low + high) / 2);
    if (utf8ByteLength(text.slice(text.length - length)) <= maxBytes) {
      low = length;
    } else {
      high = length - 1;
    }
  }
  let start = text.length - low;
  if (start > 0 && start < text.length && /[\uDC00-\uDFFF]/.test(text[start] ?? "")) {
    start += 1;
  }
  return text.slice(start);
}

function limitToolCallText(text: string): string {
  if (utf8ByteLength(text) <= TOOL_CALL_CONTENT_MAX_BYTES) {
    return text;
  }
  const availableBytes =
    TOOL_CALL_CONTENT_MAX_BYTES - utf8ByteLength(TOOL_CALL_CONTENT_TRUNCATION_MARKER);
  const headBytes = Math.floor(availableBytes / 2);
  const tailBytes = availableBytes - headBytes;
  return `${takeFirstUtf8Bytes(text, headBytes)}${TOOL_CALL_CONTENT_TRUNCATION_MARKER}${takeLastUtf8Bytes(text, tailBytes)}`;
}

export function limitAgentTimelineItemContent(item: AgentTimelineItem): AgentTimelineItem {
  if (
    item.type !== "tool_call" ||
    item.detail.type !== "shell" ||
    typeof item.detail.output !== "string"
  ) {
    return item;
  }
  const output = limitToolCallText(item.detail.output);
  if (output === item.detail.output) {
    return item;
  }
  return {
    ...item,
    detail: {
      ...item.detail,
      output,
    },
  };
}
