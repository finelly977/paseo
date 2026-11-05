import { z } from "zod";

interface CodexHistoryClient {
  request(method: string, params?: unknown): Promise<unknown>;
}

const NativeTurnStatusSchema = z.enum(["inProgress", "completed", "failed", "interrupted"]);

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

/** 列表状态核对只读取最后一轮的回合头，避免为状态扫描整段子任务正文。 */
export async function readCodexThreadLatestStatus(
  client: CodexHistoryClient,
  threadId: string,
): Promise<{ id: string; status: z.infer<typeof NativeTurnStatusSchema> } | null> {
  const { thread } = ThreadMetadataSchema.parse(
    await client.request("thread/read", { threadId, includeTurns: false }),
  );
  let latest: unknown;
  if (thread.historyMode === "paginated") {
    const page = HistoryPageSchema.parse(
      await client.request("thread/turns/list", {
        threadId,
        cursor: null,
        limit: 1,
        sortDirection: "desc",
        itemsView: "notLoaded",
      }),
    );
    latest = page.data[0];
  } else {
    const response = CodexThreadReadResponseSchema.parse(
      await client.request("thread/read", { threadId, includeTurns: true }),
    );
    latest = response.thread.turns.at(-1);
  }
  // 原生子任务刚创建但尚未开始时允许没有回合，不能将其标记为结束。
  if (latest === undefined) return null;
  return z.object({ id: z.string().min(1), status: NativeTurnStatusSchema }).parse(latest);
}

/** 原生最新页与完整读取使用相同格式校验，不用 Paseo 副本代替最新内容。 */
export async function readCodexThreadLatest(
  client: CodexHistoryClient,
  threadId: string,
): Promise<{ response: CodexThreadReadResponse; hasOlder: boolean }> {
  const { thread } = ThreadMetadataSchema.parse(
    await client.request("thread/read", { threadId, includeTurns: false }),
  );
  if (thread.historyMode === "legacy") {
    return {
      response: CodexThreadReadResponseSchema.parse(
        await client.request("thread/read", { threadId, includeTurns: true }),
      ),
      hasOlder: false,
    };
  }
  const page = HistoryPageSchema.parse(
    await client.request("thread/items/list", {
      threadId,
      cursor: null,
      limit: 100,
      sortDirection: "desc",
    }),
  );
  const items = page.data.map((entry) => ThreadItemSchema.parse(entry));
  const requiredTurns = new Set(items.map((entry) => entry.turnId));
  const turns = new Map<string, z.infer<typeof TurnHeaderSchema>>();
  for await (const headers of readCodexHistoryPages({
    client,
    threadId,
    method: "thread/turns/list",
    sortDirection: "desc",
  })) {
    for (const entry of headers.data) {
      const turn = TurnHeaderSchema.parse(entry);
      if (requiredTurns.delete(turn.id)) turns.set(turn.id, { ...turn, items: [] });
    }
    if (requiredTurns.size === 0) break;
  }
  if (requiredTurns.size > 0)
    throw new CodexHistoryReadError(threadId, "Latest items reference unknown turns");
  for (const { turnId, item } of items.toReversed()) {
    const turn = turns.get(turnId);
    if (!turn) throw new CodexHistoryReadError(threadId, `Unknown turn ${turnId}`);
    turn.items.push(item);
  }
  return {
    response: { thread: { ...thread, turns: [...turns.values()].toReversed() } },
    hasOlder: page.nextCursor !== null,
  };
}

export async function readCodexPaginatedThread(
  params: PaginatedThreadParams,
): Promise<CodexThreadReadResponse> {
  const { client, threadId, thread, sortDirection } = params;
  // 两条游标链彼此独立，并发读取；链内仍严格按游标顺序推进。
  const collectPages = async (method: HistoryPagesParams["method"], cursor?: string | null) => {
    const pages: z.infer<typeof HistoryPageSchema>[] = [];
    for await (const page of readCodexHistoryPages({
      client,
      threadId,
      method,
      sortDirection,
      cursor,
    }))
      pages.push(page);
    return pages;
  };
  const [turnPages, itemPages] = await Promise.all([
    collectPages("thread/turns/list", params.turnsCursor),
    collectPages("thread/items/list", params.itemsCursor),
  ]);

  const turns = new Map<string, z.infer<typeof TurnHeaderSchema>>();
  for (const page of turnPages) {
    for (const entry of page.data) {
      const turn = TurnHeaderSchema.parse(entry);
      turns.set(turn.id, turn);
    }
  }
  const itemsByTurn = new Map<string, Map<string, z.infer<typeof ThreadItemSchema>["item"]>>();
  for (const page of itemPages) {
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
