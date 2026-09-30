import { z } from "zod";

interface CodexHistoryClient {
  request(method: string, params?: unknown): Promise<unknown>;
}

export const CodexThreadReadResponseSchema = z
  .object({
    thread: z
      .object({
        turns: z.array(
          z.object({ items: z.array(z.unknown()), status: z.string().optional() }).passthrough(),
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

async function* readHistoryPages(
  params: HistoryPagesParams,
): AsyncGenerator<z.infer<typeof HistoryPageSchema>> {
  const { client, threadId, method } = params;
  const visitedCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = HistoryPageSchema.parse(
      await client.request(method, {
        threadId,
        cursor,
        limit: 100,
        sortDirection: "asc",
        ...(method === "thread/turns/list" ? { itemsView: "notLoaded" } : {}),
      }),
    );
    yield page;
    cursor = page.nextCursor;
    if (cursor !== null) {
      if (visitedCursors.has(cursor)) {
        throw new CodexHistoryReadError(threadId, `${method} returned a repeated cursor`);
      }
      visitedCursors.add(cursor);
    }
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

  // 回合头与正文分别顺序扫描，避免全量兼容接口对每个回合逐一补读。
  const turns = new Map<string, z.infer<typeof TurnHeaderSchema>>();
  for await (const page of readHistoryPages({
    client,
    threadId,
    method: "thread/turns/list",
  })) {
    for (const entry of page.data) {
      const turn = TurnHeaderSchema.parse(entry);
      turns.set(turn.id, turn);
    }
  }
  const itemsByTurn = new Map<string, Map<string, z.infer<typeof ThreadItemSchema>["item"]>>();
  for await (const page of readHistoryPages({
    client,
    threadId,
    method: "thread/items/list",
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
  }
  return { thread: { ...thread, turns: Array.from(turns.values()) } };
}
