import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { projectTimelineRows } from "./timeline-projection.js";

const CONVERSATION_INDEX_LIMIT = 50;
const CONVERSATION_INDEX_TEXT_LIMIT = 320;
const CONVERSATION_INDEX_PREVIEW_LIMIT = 640;

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit);
}

export function buildAgentConversationIndex(rows: readonly AgentTimelineRow[]) {
  const projected = projectTimelineRows({ rows, mode: "projected" });
  const entries: Array<{
    messageId: string | null;
    clientMessageId: string | null;
    text: string;
    assistantPreview: string;
    timestamp: string;
    seqStart: number;
  }> = [];
  let current: (typeof entries)[number] | null = null;

  for (const entry of projected) {
    if (entry.item.type === "user_message") {
      current = {
        messageId: entry.item.messageId ?? null,
        clientMessageId: entry.item.clientMessageId ?? null,
        text: truncate(entry.item.text, CONVERSATION_INDEX_TEXT_LIMIT),
        assistantPreview: "",
        timestamp: entry.timestamp,
        seqStart: entry.seqStart,
      };
      entries.push(current);
      continue;
    }
    if (entry.item.type !== "assistant_message" || !current) {
      continue;
    }
    current.assistantPreview = truncate(
      `${current.assistantPreview}${entry.item.text}`,
      CONVERSATION_INDEX_PREVIEW_LIMIT,
    );
  }

  return entries.slice(-CONVERSATION_INDEX_LIMIT);
}
