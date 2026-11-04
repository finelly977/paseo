import { expect, test } from "vitest";
import type { NativeHistoryProcessItem } from "@/types/stream";
import {
  loadNativeHistoryDetails,
  nativeHistoryDetailKey,
  releaseNativeHistoryDetails,
  useNativeHistoryDetails,
} from "./native-history-details";

const item: NativeHistoryProcessItem = {
  kind: "native_history_process",
  id: "process",
  turnId: "turn",
  status: "interrupted",
  durationMs: 7000,
  error: null,
  timestamp: new Date(1000),
  summaryMessageIds: ["q"],
  summaryRevision: "original",
};
const key = nativeHistoryDetailKey("host", "agent", "read", "turn");
const options = {
  serverId: "host",
  agentId: "agent",
  readId: "read",
  item,
  isCurrent: () => true,
  settle: async () => undefined,
  prepare: () => undefined,
};

test("后台自动读完全部过程页，展开共享同一次读取且完成后不再请求", async () => {
  releaseNativeHistoryDetails("host", "agent");
  const gate = Promise.withResolvers<void>();
  const cursors: Array<string | null> = [];
  const client = {
    readNativeHistoryTurn: async (request: { cursor: string | null }) => {
      cursors.push(request.cursor);
      await gate.promise;
      return {
        requestId: "request",
        agentId: "agent",
        readId: "read",
        turnId: "turn",
        error: null,
        items: [
          {
            type: "assistant_message" as const,
            messageId: String(request.cursor),
            text: "中断前说明",
          },
        ],
        nextCursor: request.cursor === null ? "last" : null,
      };
    },
  };
  const first = loadNativeHistoryDetails({ ...options, client });
  const second = loadNativeHistoryDetails({ ...options, client });
  gate.resolve();
  await Promise.all([first, second]);
  await loadNativeHistoryDetails({ ...options, client });
  expect(cursors).toEqual([null, "last"]);
  expect(useNativeHistoryDetails.getState().entries.get(key)).toMatchObject({
    complete: true,
    loading: false,
    error: null,
  });
  expect(useNativeHistoryDetails.getState().entries.get(key)?.items).toHaveLength(2);
});

test("收起的普通过程预取不触碰阅读锚点，中断说明恢复时才保护位置", async () => {
  releaseNativeHistoryDetails("host", "agent");
  let preparations = 0;
  const client = {
    readNativeHistoryTurn: async () => ({
      requestId: "request",
      agentId: "agent",
      readId: "read",
      turnId: "turn",
      items: [{ type: "assistant_message" as const, messageId: "partial", text: "中断前说明" }],
      nextCursor: null,
      error: null,
    }),
  };
  await loadNativeHistoryDetails({
    ...options,
    item: { ...item, status: "completed" },
    client,
    prepare: () => preparations++,
  });
  expect(preparations).toBe(0);
  await loadNativeHistoryDetails({ ...options, client, prepare: () => preparations++ });
  expect(preparations).toBe(1);
});

test("读取失败保留成功页，重试从未完成页继续；释放后的迟到结果不重建缓存", async () => {
  releaseNativeHistoryDetails("host", "agent");
  let fail = true;
  const cursors: Array<string | null> = [];
  const client = {
    readNativeHistoryTurn: async (request: { cursor: string | null }) => {
      cursors.push(request.cursor);
      if (request.cursor === "last" && fail) throw new Error("读取失败");
      return {
        requestId: "request",
        agentId: "agent",
        readId: "read",
        turnId: "turn",
        error: null,
        items:
          request.cursor === null
            ? [{ type: "assistant_message" as const, text: "已读取的过程说明" }]
            : [],
        nextCursor: request.cursor === null ? "last" : null,
      };
    },
  };
  await expect(loadNativeHistoryDetails({ ...options, client })).rejects.toThrow("读取失败");
  expect(useNativeHistoryDetails.getState().entries.get(key)?.error).toBe("读取失败");
  expect(useNativeHistoryDetails.getState().entries.get(key)?.items).toHaveLength(1);
  fail = false;
  await loadNativeHistoryDetails({ ...options, client });
  expect(useNativeHistoryDetails.getState().entries.get(key)?.error).toBeNull();
  expect(cursors).toEqual([null, "last", "last"]);
  releaseNativeHistoryDetails("host", "agent");
  const gate = Promise.withResolvers<Awaited<ReturnType<typeof client.readNativeHistoryTurn>>>();
  const reading = loadNativeHistoryDetails({
    ...options,
    client: { readNativeHistoryTurn: () => gate.promise },
  });
  releaseNativeHistoryDetails("host", "agent");
  gate.resolve(await client.readNativeHistoryTurn({ cursor: "last" }));
  await reading;
  expect(useNativeHistoryDetails.getState().entries.has(key)).toBe(false);
});

test("后台重新验证完整过程时保留当前说明，失败可重试且不重复拼接旧结果", async () => {
  releaseNativeHistoryDetails("host", "agent");
  const oldItems = [{ type: "assistant_message" as const, messageId: "partial", text: "原说明" }];
  const result = {
    requestId: "request",
    agentId: "agent",
    readId: "read",
    turnId: "turn",
    error: null,
    nextCursor: null,
  };
  await loadNativeHistoryDetails({
    ...options,
    client: { readNativeHistoryTurn: async () => ({ ...result, items: oldItems }) },
  });
  const gate =
    Promise.withResolvers<
      Awaited<
        ReturnType<
          Parameters<typeof loadNativeHistoryDetails>[0]["client"]["readNativeHistoryTurn"]
        >
      >
    >();
  const refreshing = loadNativeHistoryDetails({
    ...options,
    refresh: true,
    client: { readNativeHistoryTurn: () => gate.promise },
  });
  expect(useNativeHistoryDetails.getState().entries.get(key)).toMatchObject({
    items: oldItems,
    complete: true,
    loading: true,
    error: null,
  });
  const rejected = expect(refreshing).rejects.toThrow("重新验证失败");
  gate.reject(new Error("重新验证失败"));
  await rejected;
  expect(useNativeHistoryDetails.getState().entries.get(key)).toMatchObject({
    items: oldItems,
    complete: true,
    loading: false,
    error: "重新验证失败",
  });
  const updated = [{ ...oldItems[0], text: "改写后的说明" }];
  let preparations = 0;
  await loadNativeHistoryDetails({
    ...options,
    prepare: () => preparations++,
    client: { readNativeHistoryTurn: async () => ({ ...result, items: updated }) },
  });
  expect(useNativeHistoryDetails.getState().entries.get(key)).toMatchObject({
    items: updated,
    complete: true,
    loading: false,
    error: null,
  });
  expect(preparations).toBe(1);
});
