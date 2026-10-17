import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import type { z } from "zod";
import type { ConversationSearchHitSchema } from "@getpaseo/protocol/messages";

interface ConversationSearchInput {
  agentIds: readonly string[];
  query: string;
  limit: number;
  cancelled(): boolean;
  readMessages(agentId: string): Promise<readonly AgentTimelineItem[]>;
}

export async function searchConversations(
  input: ConversationSearchInput,
): Promise<z.infer<typeof ConversationSearchHitSchema>[]> {
  const tokens = input.query.normalize("NFKC").toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const hits = new Map<string, string>();
  let nextIndex = 0;
  let failed = false;
  async function scan(): Promise<void> {
    while (nextIndex < input.agentIds.length && hits.size < input.limit && !input.cancelled()) {
      if (failed) return;
      const agentId = input.agentIds[nextIndex++];
      const messages = await input.readMessages(agentId);
      if (input.cancelled() || failed) return;
      for (let index = messages.length - 1; index >= 0; index--) {
        if (index % 128 === 0) {
          await yieldToEventLoop();
          if (input.cancelled() || failed) return;
        }
        const item = messages[index];
        if (item.type !== "user_message" && item.type !== "assistant_message") continue;
        const text = item.text.normalize("NFKC").replace(/\s+/g, " ").trim();
        const folded = text.toLowerCase();
        if (!tokens.every((token) => folded.includes(token))) continue;
        const start = Math.max(0, folded.indexOf(tokens[0]) - 40);
        const snippet = `${start > 0 ? "…" : ""}${text.slice(start, start + 180)}${start + 180 < text.length ? "…" : ""}`;
        hits.set(agentId, snippet);
        break;
      }
    }
  }
  try {
    await Promise.all([scan(), scan()]);
  } catch (error) {
    failed = true;
    throw error;
  }
  return input.agentIds
    .flatMap((agentId) => {
      const snippet = hits.get(agentId);
      return snippet === undefined ? [] : [{ agentId, snippet }];
    })
    .slice(0, input.limit);
}
