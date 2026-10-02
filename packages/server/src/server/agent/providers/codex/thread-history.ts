import { z } from "zod";

interface CodexHistoryClient {
  request(method: string, params?: unknown): Promise<unknown>;
}

export const CodexThreadReadResponseSchema = z
  .object({
    thread: z
      .object({
        turns: z.array(
          z
            .object({
              id: z.string().optional(),
              items: z.array(z.unknown()),
              status: z.string().optional(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
  })
  .passthrough();

export type CodexThreadReadResponse = z.infer<typeof CodexThreadReadResponseSchema>;

const ThreadMetadataSchema = z.object({
  thread: z.object({ historyMode: z.enum(["legacy", "paginated"]) }).passthrough(),
});
const HistoryPageSchema = z.object({
  data: z.array(z.unknown()),
  nextCursor: z.string().min(1).nullable(),
});
const TurnHeaderSchema = z.object({ id: z.string(), items: z.array(z.unknown()) }).passthrough();
const ThreadItemSchema = z.object({
  turnId: z.string(),
  item: z.object({ id: z.string(), type: z.string() }).passthrough(),
});

interface HistoryPagesParams {
  client: CodexHistoryClient;
  threadId: string;
  method: "thread/turns/list" | "thread/items/list";
  sortDirection: "asc" | "desc";
  cursor?: string | null;
}

interface PaginatedThreadParams {
  client: CodexHistoryClient;
  thread: z.infer<typeof ThreadMetadataSchema>["thread"];
  threadId: string;
  sortDirection: "asc" | "desc";
  turnsCursor?: string | null;
  itemsCursor?: string | null;
}

export class CodexHistoryReadError extends Error {
  constructor(
    readonly threadId: string,
    readonly detail: string,
  ) {
    super(`Invalid Codex history for ${threadId}: ${detail}`);
    this.name = "CodexHistoryReadError";
  }
}

export async function* readCodexHistoryPages(
  params: HistoryPagesParams,
): AsyncGenerator<z.infer<typeof HistoryPageSchema>> {
  // 未提供游标表示从头读取；回退响应的空游标明确表示该部分没有保留历史。
  if (params.cursor === null) return;
  const { client, threadId, method } = params;
  const visitedCursors = new Set<string>();
  let cursor = params.cursor ?? null;
  do {
    if (cursor !== null) {
      if (visitedCursors.has(cursor)) {
        throw new CodexHistoryReadError(threadId, `${method} returned a repeated cursor`);
      }
      visitedCursors.add(cursor);
    }
    const page = HistoryPageSchema.parse(
      await client.request(method, {
        threadId,
        cursor,
        limit: 100,
        sortDirection: params.sortDirection,
        ...(method === "thread/turns/list" ? { itemsView: "notLoaded" } : {}),
      }),
    );
    yield page;
    cursor = page.nextCursor;
  } while (cursor !== null);
}

export async function readCodexThread(
  client: CodexHistoryClient,
  threadId: string,
): Promise<CodexThreadReadResponse> {
  const { thread } = ThreadMetadataSchema.parse(
    await client.request("thread/read", {
      threadId,
      includeTurns: false,
    }),
  );
  if (thread.historyMode === "legacy") {
    return CodexThreadReadResponseSchema.parse(
      await client.request("thread/read", { threadId, includeTurns: true }),
    );
  }

  return readCodexPaginatedThread({ client, threadId, thread, sortDirection: "asc" });
}

export async function readCodexPaginatedThread(
  params: PaginatedThreadParams,
): Promise<CodexThreadReadResponse> {
  const { client, threadId, thread, sortDirection } = params;
  // 回合头与正文分别顺序扫描，避免全量接口对每个回合逐一补读。
  const turns = new Map<string, z.infer<typeof TurnHeaderSchema>>();
  for await (const page of readCodexHistoryPages({
    client,
    threadId,
    method: "thread/turns/list",
    sortDirection,
    cursor: params.turnsCursor,
  })) {
    for (const entry of page.data) {
      const turn = TurnHeaderSchema.parse(entry);
      turns.set(turn.id, turn);
    }
  }
  const itemsByTurn = new Map<string, Map<string, z.infer<typeof ThreadItemSchema>["item"]>>();
  for await (const page of readCodexHistoryPages({
    client,
    threadId,
    method: "thread/items/list",
    sortDirection,
    cursor: params.itemsCursor,
  })) {
    for (const entry of page.data) {
      const { turnId, item } = ThreadItemSchema.parse(entry);
      if (!turns.has(turnId)) {
        throw new CodexHistoryReadError(
          threadId,
          `Item ${item.id} references unknown turn ${turnId}`,
        );
      }
      let items = itemsByTurn.get(turnId);
      if (!items) {
        items = new Map();
        itemsByTurn.set(turnId, items);
      }
      items.set(item.id, item);
    }
  }
  // 只有全部分页成功后才交给时间线投影；跨页重叠保留原位置、更新同一条目的内容。
  for (const turn of turns.values()) {
    const items = itemsByTurn.get(turn.id);
    turn.items = items ? Array.from(items.values()) : [];
    if (sortDirection === "desc") turn.items.reverse();
  }
  const orderedTurns = Array.from(turns.values());
  if (sortDirection === "desc") orderedTurns.reverse();
  return { thread: { ...thread, turns: orderedTurns } };
}
