import { z } from "zod";
import type { CodexThreadForkParams, CodexThreadForkResponse } from "./app-server-transport.js";
import { parseCodexThreadForkResponse } from "./app-server-transport.js";
import { readCodexHistoryPages } from "./thread-history.js";

export interface CodexForkClient {
  forkThread?(params: CodexThreadForkParams): Promise<CodexThreadForkResponse>;
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
}

const ThreadMetadataSchema = z.object({
  thread: z
    .object({
      id: z.string().min(1),
      historyMode: z.enum(["legacy", "paginated"]).optional().default("legacy"),
    })
    .passthrough(),
});

const TurnHeaderSchema = z.object({ id: z.string().min(1) }).passthrough();

const PaginatedItemSchema = z.object({
  turnId: z.string().min(1),
  item: z
    .object({
      id: z.string().min(1),
      clientId: z.string().nullable().optional(),
    })
    .passthrough(),
});

const LegacyThreadReadSchema = z.object({
  thread: z
    .object({
      id: z.string().min(1),
      turns: z.array(
        z
          .object({
            id: z.string().min(1).optional(),
            items: z.array(z.unknown()),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
});

function extractLegacyItemIds(rawItem: unknown): string[] {
  if (typeof rawItem !== "object" || rawItem === null) return [];
  const record = rawItem as Record<string, unknown>;
  const ids: string[] = [];
  if (typeof record.id === "string" && record.id.length > 0) ids.push(record.id);
  if (typeof record.clientId === "string" && record.clientId.length > 0) {
    ids.push(record.clientId);
  }
  if (typeof record.client_id === "string" && record.client_id.length > 0) {
    ids.push(record.client_id);
  }
  return ids;
}

async function resolvePaginatedCodexForkTurnId(input: {
  client: CodexForkClient;
  threadId: string;
  nativeTurnId?: string;
  messageIdSet: ReadonlySet<string>;
  turnIndex?: number;
}): Promise<string> {
  const turnIdsDesc: string[] = [];
  for await (const page of readCodexHistoryPages({
    client: input.client,
    threadId: input.threadId,
    method: "thread/turns/list",
    sortDirection: "desc",
  })) {
    for (const entry of page.data) {
      const turn = TurnHeaderSchema.parse(entry);
      if (input.nativeTurnId && turn.id === input.nativeTurnId) {
        return turn.id;
      }
      turnIdsDesc.push(turn.id);
    }
  }

  if (input.messageIdSet.size > 0) {
    for await (const page of readCodexHistoryPages({
      client: input.client,
      threadId: input.threadId,
      method: "thread/items/list",
      sortDirection: "desc",
    })) {
      for (const entry of page.data) {
        const parsed = PaginatedItemSchema.parse(entry);
        const matchedItem = input.messageIdSet.has(parsed.item.id);
        const matchedClient = Boolean(
          parsed.item.clientId && input.messageIdSet.has(parsed.item.clientId),
        );
        if (matchedItem || matchedClient) {
          return parsed.turnId;
        }
      }
    }
  }

  if (input.turnIndex !== undefined) {
    const turnsAsc = turnIdsDesc.toReversed();
    const matched = turnsAsc[input.turnIndex];
    if (matched) return matched;
  }

  throw new Error("找不到要分叉的 Codex 原生回合");
}

async function resolveLegacyCodexForkTurnId(input: {
  client: CodexForkClient;
  threadId: string;
  nativeTurnId?: string;
  messageIdSet: ReadonlySet<string>;
  turnIndex?: number;
}): Promise<string> {
  const fullThread = LegacyThreadReadSchema.parse(
    await input.client.request("thread/read", {
      threadId: input.threadId,
      includeTurns: true,
    }),
  );
  const turns = fullThread.thread.turns;

  if (input.nativeTurnId) {
    const direct = turns.find((turn) => turn.id === input.nativeTurnId);
    if (direct?.id) return direct.id;
  }

  if (input.messageIdSet.size > 0) {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      const hasMatch = turn.items.some((item) =>
        extractLegacyItemIds(item).some((id) => input.messageIdSet.has(id)),
      );
      if (hasMatch && turn.id) return turn.id;
    }
  }

  if (input.turnIndex !== undefined) {
    const matched = turns[input.turnIndex];
    if (matched?.id) return matched.id;
  }

  throw new Error("找不到要分叉的 Codex 原生回合");
}

export async function resolveCodexForkTurnId(input: {
  client: CodexForkClient;
  threadId: string;
  nativeTurnId?: string;
  messageIds?: readonly string[];
  turnIndex?: number;
}): Promise<string | undefined> {
  const hasBoundary =
    Boolean(input.nativeTurnId) ||
    Boolean(input.messageIds && input.messageIds.length > 0) ||
    input.turnIndex !== undefined;
  if (!hasBoundary) {
    return undefined;
  }

  const metadata = ThreadMetadataSchema.parse(
    await input.client.request("thread/read", {
      threadId: input.threadId,
      includeTurns: false,
    }),
  );
  const messageIdSet = new Set(input.messageIds ?? []);

  if (metadata.thread.historyMode === "paginated") {
    return resolvePaginatedCodexForkTurnId({
      client: input.client,
      threadId: input.threadId,
      nativeTurnId: input.nativeTurnId,
      messageIdSet,
      turnIndex: input.turnIndex,
    });
  }

  return resolveLegacyCodexForkTurnId({
    client: input.client,
    threadId: input.threadId,
    nativeTurnId: input.nativeTurnId,
    messageIdSet,
    turnIndex: input.turnIndex,
  });
}

export async function forkCodexNativeThread(
  client: CodexForkClient,
  params: CodexThreadForkParams,
): Promise<CodexThreadForkResponse> {
  if (client.forkThread) {
    return client.forkThread(params);
  }
  return parseCodexThreadForkResponse(await client.request("thread/fork", params));
}
