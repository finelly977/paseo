import { z } from "zod";

import type {
  CodexThreadRollbackParams,
  CodexThreadRollbackResponse,
} from "./app-server-transport.js";
import {
  CodexAppServerRpcError,
  parseCodexThreadRollbackResponse,
} from "./app-server-transport.js";

class CodexHistoryProjectionError extends Error {
  constructor(
    readonly threadId: string,
    cause: CodexAppServerRpcError,
  ) {
    super(
      "Codex 原始会话记录与历史索引不一致，无法完成回退。请先释放该会话运行时，备份后修复该会话的原生历史索引；不要反复重试或删除原始会话文件。",
      { cause },
    );
    this.name = "CodexHistoryProjectionError";
  }
}

export interface CodexRewindClient {
  rollbackThread?(params: CodexThreadRollbackParams): Promise<CodexThreadRollbackResponse>;
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
}

export interface CodexUserMessageTurnIndex {
  resolve(messageId: string): number | null;
  count(): number;
}

const ThreadMetadataResponseSchema = z.object({
  thread: z
    .object({
      id: z.string().min(1),
      historyMode: z.enum(["legacy", "paginated"]),
    })
    .passthrough(),
});

const TurnPageSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string().min(1),
        itemsView: z.literal("full"),
        items: z.array(
          z
            .object({
              id: z.string().min(1),
              type: z.string(),
              clientId: z.string().nullable().optional(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
  ),
  nextCursor: z.string().min(1).nullable(),
});

const ThreadRevertResponseSchema = ThreadMetadataResponseSchema.extend({
  turnsBackwardsCursor: z.string().min(1).nullable(),
});

interface PaginatedTurnsInput {
  client: CodexRewindClient;
  threadId: string;
  cursor: string | null;
}

async function* readTurnPages(input: PaginatedTurnsInput) {
  let cursor = input.cursor;
  const visitedCursors = new Set<string>();
  do {
    if (cursor !== null) {
      if (visitedCursors.has(cursor)) {
        throw new Error("Codex returned a repeated turn history cursor");
      }
      visitedCursors.add(cursor);
    }
    const page = TurnPageSchema.parse(
      await input.client.request("thread/turns/list", {
        threadId: input.threadId,
        cursor,
        limit: 100,
        sortDirection: "desc",
        itemsView: "full",
      }),
    );
    yield page.data;
    cursor = page.nextCursor;
  } while (cursor !== null);
}

async function findBeforeTurnId(input: PaginatedTurnsInput, messageId: string): Promise<string> {
  for await (const turns of readTurnPages(input)) {
    const target = turns.find((turn) =>
      turn.items.some(
        (item) =>
          item.type === "userMessage" && (item.id === messageId || item.clientId === messageId),
      ),
    );
    if (target) {
      return target.id;
    }
  }
  throw new Error(`Codex could not find user message ${messageId} in the current thread`);
}

function assertSameThread(expectedThreadId: string, actualThreadId: string): void {
  if (actualThreadId !== expectedThreadId) {
    throw new Error(`Codex returned thread ${actualThreadId} instead of ${expectedThreadId}`);
  }
}

async function revertPaginatedThread(
  input: PaginatedTurnsInput,
  messageId: string,
): Promise<CodexThreadRollbackResponse> {
  const beforeTurnId = await findBeforeTurnId(input, messageId);
  let response: unknown;
  try {
    response = await input.client.request("thread/revert", {
      threadId: input.threadId,
      beforeTurnId,
    });
  } catch (error) {
    if (
      error instanceof CodexAppServerRpcError &&
      error.code === -32603 &&
      error.message.includes("durable rollout shrank before projection")
    ) {
      // 此错误不能证明原生回退未写入；保留失败，不自动重试，也不改写提供方数据库。
      throw new CodexHistoryProjectionError(input.threadId, error);
    }
    throw error;
  }
  const reverted = ThreadRevertResponseSchema.parse(response);
  assertSameThread(input.threadId, reverted.thread.id);

  // 新接口只返回元数据，空 turns 不代表历史已清空，必须沿回退响应的游标读取保留内容。
  const turns: z.infer<typeof TurnPageSchema>["data"] = [];
  if (reverted.turnsBackwardsCursor !== null) {
    for await (const page of readTurnPages({ ...input, cursor: reverted.turnsBackwardsCursor })) {
      turns.push(...page);
    }
  }
  turns.reverse();
  return { thread: { ...reverted.thread, turns } };
}

async function rollbackCodexThread(
  client: CodexRewindClient,
  params: CodexThreadRollbackParams,
): Promise<CodexThreadRollbackResponse> {
  if (client.rollbackThread) {
    return client.rollbackThread(params);
  }
  return parseCodexThreadRollbackResponse(await client.request("thread/rollback", params));
}

export async function revertCodexConversation(input: {
  client: CodexRewindClient;
  threadId: string | null;
  messageId: string;
  userMessageTurns: CodexUserMessageTurnIndex;
  setThreadId: (threadId: string, history: CodexThreadRollbackResponse) => void | Promise<void>;
}): Promise<void> {
  if (!input.threadId) {
    throw new Error("Codex thread is not ready for rewind");
  }

  const metadata = ThreadMetadataResponseSchema.parse(
    await input.client.request("thread/read", {
      threadId: input.threadId,
      includeTurns: false,
    }),
  );
  assertSameThread(input.threadId, metadata.thread.id);
  if (metadata.thread.historyMode === "paginated") {
    const reverted = await revertPaginatedThread(
      {
        client: input.client,
        threadId: input.threadId,
        cursor: null,
      },
      input.messageId,
    );
    await input.setThreadId(input.threadId, reverted);
    return;
  }

  const targetTurnIndex = input.userMessageTurns.resolve(input.messageId);
  if (targetTurnIndex === null) {
    throw new Error(`Codex could not find user message ${input.messageId} in the current thread`);
  }

  const currentUserTurnCount = input.userMessageTurns.count();
  const numTurns = currentUserTurnCount - targetTurnIndex;
  if (numTurns <= 0) {
    throw new Error(`Codex user message ${input.messageId} is outside the current thread`);
  }

  // 直接在当前线程原地回退。Codex 只回退对话，已产生的文件修改仍保留在磁盘上。
  const rolledBack = await rollbackCodexThread(input.client, {
    threadId: input.threadId,
    numTurns,
  });
  assertSameThread(input.threadId, rolledBack.thread.id);
  await input.setThreadId(input.threadId, rolledBack);
}
