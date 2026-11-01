import { z } from "zod";
import type { AgentSession, AgentTimelineItem } from "../../agent-sdk-types.js";
import { limitAgentTimelineItemContent } from "../../agent-timeline-content.js";
import { isSystemInjectedEnvelope } from "../../agent-prompt.js";

const Page = z.object({ data: z.array(z.unknown()), nextCursor: z.string().nullable() });
const Turn = z.object({
  id: z.string(),
  status: z.enum(["completed", "inProgress", "failed", "interrupted"]),
  startedAt: z.number().nullable(),
  durationMs: z.number().nullable(),
  error: z.object({ message: z.string() }).nullable(),
  items: z.array(z.unknown()),
});
const Item = z.object({ turnId: z.string(), item: z.unknown() });

/** 只读页不进入规范时间线，不持有完整正文，不触发原生执行恢复。 */
export function createNativeCodexHistory(input: {
  request(method: string, params: unknown): Promise<unknown>;
  threadId: string;
  mapItem(raw: unknown): AgentTimelineItem | null;
  complete(): Promise<void>;
}): NonNullable<AgentSession["nativeHistory"]> {
  // 原生线程身份跨空闲进程回收保持有效；游标所属线程和回合由原生接口校验。
  const readId = input.threadId;
  const mapItems = (raw: unknown[]) =>
    raw.flatMap((item) => {
      const mapped = input.mapItem(item);
      if (mapped?.type === "user_message" && isSystemInjectedEnvelope(mapped.text)) return [];
      return mapped === null ? [] : [limitAgentTimelineItemContent(mapped)];
    });
  return {
    readId,
    async readPage(cursor, limit) {
      const page = Page.parse(
        await input.request("thread/turns/list", {
          threadId: input.threadId,
          cursor,
          limit,
          sortDirection: "desc",
          itemsView: "summary",
        }),
      );
      if (page.nextCursor !== null) {
        if (page.nextCursor === cursor) throw new Error("Codex 历史分页游标没有前进。");
      }
      const turns = page.data
        .map((raw) => {
          const turn = Turn.parse(raw);
          return {
            ...turn,
            error: turn.error === null ? null : turn.error.message,
            items: mapItems(turn.items),
          };
        })
        .toReversed();
      return { readId, cursor, nextCursor: page.nextCursor, turns };
    },
    async readTurn(turnId, cursor) {
      const page = Page.parse(
        await input.request("thread/items/list", {
          threadId: input.threadId,
          turnId,
          cursor,
          limit: 100,
          sortDirection: "asc",
        }),
      );
      if (page.nextCursor !== null) {
        if (page.nextCursor === cursor) throw new Error("Codex 过程分页游标没有前进。");
      }
      const items = page.data.map((raw) => {
        const entry = Item.parse(raw);
        if (entry.turnId !== turnId) throw new Error("Codex 返回了其他回合的处理过程。");
        return entry.item;
      });
      return { items: mapItems(items), nextCursor: page.nextCursor };
    },
    complete: input.complete,
  };
}
