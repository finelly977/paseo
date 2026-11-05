import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const values = new Map<string, string>();
  return {
    default: {
      getItem: (name: string) => Promise.resolve(values.get(name) ?? null),
      setItem: (name: string, value: string) => {
        values.set(name, value);
        return Promise.resolve();
      },
      removeItem: (name: string) => {
        values.delete(name);
        return Promise.resolve();
      },
    },
  };
});
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  fetchProviderSubagentTimeline,
  providerSubagentKey,
  refreshProviderSubagents,
  useProviderSubagentStore,
} from "./provider-store";
import { useProviderSubagentArchiveStore } from "./provider-subagent-archive-store";

const SERVER_ID = "server-1";
const PARENT_ID = "parent-1";
const SUBAGENT_ID = "child-1";

afterEach(() => {
  useProviderSubagentStore.setState({
    descriptors: new Map(),
    timelines: new Map(),
  });
  useProviderSubagentArchiveStore.setState({
    hiddenFromTrack: new Set(),
    hiddenRunIdByKey: {},
    hydrated: true,
  });
});

describe("provider subagent client store", () => {
  test("子任务列表读取失败时显式报错，不把已显示的任务清空", async () => {
    const client = {
      listProviderSubagents: async () => ({
        requestId: "failed-list",
        parentAgentId: PARENT_ID,
        subagents: [],
        error: "原生读取失败",
      }),
    };
    await expect(refreshProviderSubagents(client, SERVER_ID, PARENT_ID)).rejects.toThrow(
      "原生读取失败",
    );
  });

  test("子任务正文读取失败时显式报错，不创建伪装为空的历史", async () => {
    const client = {
      fetchProviderSubagentTimeline: async () => ({
        requestId: "failed-history",
        parentAgentId: PARENT_ID,
        subagentId: SUBAGENT_ID,
        provider: "codex",
        direction: "tail" as const,
        epoch: "",
        reset: false,
        staleCursor: false,
        gap: false,
        window: { minSeq: 0, maxSeq: 0, nextSeq: 1 },
        hasOlder: false,
        hasNewer: false,
        rows: [],
        error: "子会话读取失败",
      }),
    };
    await expect(
      fetchProviderSubagentTimeline(client, SERVER_ID, PARENT_ID, SUBAGENT_ID, {
        direction: "tail",
      }),
    ).rejects.toThrow("子会话读取失败");
    expect(useProviderSubagentStore.getState().timelines.size).toBe(0);
  });

  test("已完成子任务不会被较早返回的运行态列表或更新重新打开", () => {
    const store = useProviderSubagentStore.getState();
    const completed = {
      id: SUBAGENT_ID,
      parentAgentId: PARENT_ID,
      provider: "codex",
      title: "Review",
      description: null,
      status: "completed" as const,
      createdAt: "2026-11-05T00:00:00.000Z",
      updatedAt: "2026-11-05T00:00:02.000Z",
      toolCallId: "tool",
    };
    store.applyUpdate(SERVER_ID, { kind: "upsert", subagent: completed });
    const stale = {
      ...completed,
      status: "running" as const,
      updatedAt: "2026-11-05T00:00:01.000Z",
    };
    store.replaceList(SERVER_ID, PARENT_ID, [stale]);
    store.applyUpdate(SERVER_ID, { kind: "upsert", subagent: stale });
    const key = providerSubagentKey(SERVER_ID, PARENT_ID, SUBAGENT_ID);
    expect(useProviderSubagentStore.getState().descriptors.get(key)?.status).toBe("completed");
    store.applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: { ...stale, updatedAt: "2026-11-05T00:00:03.000Z" },
    });
    expect(useProviderSubagentStore.getState().descriptors.get(key)?.status).toBe("running");
  });
  test("释放父会话清除正文缓存但保留已归档子智能体，不影响其他父会话", () => {
    const store = useProviderSubagentStore.getState();
    const descriptor = {
      id: SUBAGENT_ID,
      parentAgentId: PARENT_ID,
      provider: "codex" as const,
      title: "已完成的任务",
      description: null,
      status: "completed" as const,
      createdAt: "2026-07-12T10:00:00.000Z",
      updatedAt: "2026-07-12T10:00:01.000Z",
      toolCallId: "call-1",
    };
    store.replaceList(SERVER_ID, PARENT_ID, [descriptor]);
    store.replaceList(SERVER_ID, "other-parent", [
      { ...descriptor, parentAgentId: "other-parent" },
    ]);
    store.applyUpdate(SERVER_ID, {
      kind: "timeline",
      parentAgentId: PARENT_ID,
      subagentId: SUBAGENT_ID,
      provider: "codex",
      epoch: "epoch-1",
      seq: 1,
      timestamp: descriptor.updatedAt,
      item: { type: "assistant_message", text: "任务输出" },
    });
    store.hideFinishedForParent(SERVER_ID, PARENT_ID);
    store.releaseParent(SERVER_ID, PARENT_ID);

    const state = useProviderSubagentStore.getState();
    const key = providerSubagentKey(SERVER_ID, PARENT_ID, SUBAGENT_ID);
    expect(state.descriptors.has(key)).toBe(false);
    expect(state.timelines.has(key)).toBe(false);
    expect(useProviderSubagentArchiveStore.getState().hiddenFromTrack.has(key)).toBe(true);
    expect(state.descriptors.has(providerSubagentKey(SERVER_ID, "other-parent", SUBAGENT_ID))).toBe(
      true,
    );
  });

  test("释放前发出的列表请求不能在完成时重新填入缓存", async () => {
    const pending =
      Promise.withResolvers<Awaited<ReturnType<DaemonClient["listProviderSubagents"]>>>();
    const client = { listProviderSubagents: () => pending.promise };
    const request = refreshProviderSubagents(client, SERVER_ID, PARENT_ID);
    useProviderSubagentStore.getState().releaseParent(SERVER_ID, PARENT_ID);
    pending.resolve({
      requestId: "list-old",
      parentAgentId: PARENT_ID,
      subagents: [
        {
          id: SUBAGENT_ID,
          parentAgentId: PARENT_ID,
          provider: "codex",
          title: "旧任务",
          description: null,
          status: "completed",
          createdAt: "2026-07-12T10:00:00.000Z",
          updatedAt: "2026-07-12T10:00:01.000Z",
          toolCallId: "call-1",
        },
      ],
      error: null,
    });
    await request;
    expect(useProviderSubagentStore.getState().descriptors.size).toBe(0);
    await refreshProviderSubagents(client, SERVER_ID, PARENT_ID);
    expect(useProviderSubagentStore.getState().descriptors.size).toBe(1);
  });

  test("释放前发出的子任务正文不能重新填入缓存，新请求仍可正常读取", async () => {
    const pending =
      Promise.withResolvers<Awaited<ReturnType<DaemonClient["fetchProviderSubagentTimeline"]>>>();
    const client = { fetchProviderSubagentTimeline: () => pending.promise };
    const request = fetchProviderSubagentTimeline(client, SERVER_ID, PARENT_ID, SUBAGENT_ID, {
      direction: "tail",
    });
    useProviderSubagentStore.getState().releaseParent(SERVER_ID, PARENT_ID);
    pending.resolve({
      requestId: "history-old",
      parentAgentId: PARENT_ID,
      subagentId: SUBAGENT_ID,
      provider: "codex",
      direction: "tail",
      epoch: "epoch-1",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 1, maxSeq: 1, nextSeq: 2 },
      hasOlder: false,
      hasNewer: false,
      error: null,
      rows: [
        {
          seq: 1,
          timestamp: "2026-07-12T10:00:00.000Z",
          item: { type: "assistant_message", text: "旧输出" },
        },
      ],
    });
    await request;
    expect(useProviderSubagentStore.getState().timelines.size).toBe(0);
    await fetchProviderSubagentTimeline(client, SERVER_ID, PARENT_ID, SUBAGENT_ID, {
      direction: "tail",
    });
    expect(useProviderSubagentStore.getState().timelines.size).toBe(1);
  });

  test("builds a shared stream model from ordered provider updates", () => {
    const subagents = useProviderSubagentStore.getState();
    subagents.applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: {
        id: SUBAGENT_ID,
        parentAgentId: PARENT_ID,
        provider: "codex",
        title: "Explore",
        description: "Inspect the repository",
        status: "running",
        createdAt: "2026-07-12T10:00:00.000Z",
        updatedAt: "2026-07-12T10:00:00.000Z",
        toolCallId: "call-1",
      },
    });
    subagents.applyUpdate(SERVER_ID, {
      kind: "timeline",
      parentAgentId: PARENT_ID,
      subagentId: SUBAGENT_ID,
      provider: "codex",
      epoch: "epoch-1",
      seq: 2,
      timestamp: "2026-07-12T10:00:02.000Z",
      item: { type: "assistant_message", text: "New live output." },
    });
    subagents.replaceTimeline(SERVER_ID, {
      requestId: "history-1",
      parentAgentId: PARENT_ID,
      subagentId: SUBAGENT_ID,
      provider: "codex",
      direction: "tail",
      epoch: "epoch-1",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 1, maxSeq: 1, nextSeq: 2 },
      hasOlder: false,
      hasNewer: true,
      rows: [
        {
          seq: 1,
          timestamp: "2026-07-12T10:00:01.000Z",
          item: { type: "assistant_message", text: "Older history." },
        },
      ],
      error: null,
    });
    const liveTimeline = useProviderSubagentStore
      .getState()
      .timelines.get(providerSubagentKey(SERVER_ID, PARENT_ID, SUBAGENT_ID));
    subagents.applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: {
        id: SUBAGENT_ID,
        parentAgentId: PARENT_ID,
        provider: "codex",
        title: "Explore",
        description: "Inspect the repository",
        status: "running",
        createdAt: "2026-07-12T10:00:00.000Z",
        updatedAt: "2026-07-12T10:00:01.500Z",
        toolCallId: "call-1",
      },
    });
    expect(
      useProviderSubagentStore
        .getState()
        .timelines.get(providerSubagentKey(SERVER_ID, PARENT_ID, SUBAGENT_ID)),
    ).toBe(liveTimeline);
    subagents.applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: {
        id: SUBAGENT_ID,
        parentAgentId: PARENT_ID,
        provider: "codex",
        title: "Explore",
        description: "Inspect the repository",
        status: "completed",
        createdAt: "2026-07-12T10:00:00.000Z",
        updatedAt: "2026-07-12T10:00:02.000Z",
        toolCallId: "call-1",
      },
    });

    const key = providerSubagentKey(SERVER_ID, PARENT_ID, SUBAGENT_ID);
    const state = useProviderSubagentStore.getState();
    expect(state.descriptors.get(key)?.status).toBe("completed");
    expect(state.timelines.get(key)?.head).toEqual([]);
    expect(state.timelines.get(key)?.tail).toEqual([
      expect.objectContaining({
        kind: "assistant_message",
        text: "Older history.New live output.",
      }),
    ]);
  });

  test("removes timelines for children no longer returned by the provider", () => {
    const store = useProviderSubagentStore.getState();
    store.applyUpdate(SERVER_ID, {
      kind: "timeline",
      parentAgentId: PARENT_ID,
      subagentId: SUBAGENT_ID,
      provider: "codex",
      epoch: "epoch-1",
      seq: 1,
      timestamp: "2026-07-12T10:00:01.000Z",
      item: { type: "assistant_message", text: "Removed child output." },
    });

    store.replaceList(SERVER_ID, PARENT_ID, []);

    expect(
      useProviderSubagentStore
        .getState()
        .timelines.has(providerSubagentKey(SERVER_ID, PARENT_ID, SUBAGENT_ID)),
    ).toBe(false);
  });

  test("hides finished children locally without removing their timelines", () => {
    const store = useProviderSubagentStore.getState();
    store.applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: {
        id: SUBAGENT_ID,
        parentAgentId: PARENT_ID,
        provider: "codex",
        title: "Finished child",
        description: null,
        status: "completed",
        createdAt: "2026-07-12T10:00:00.000Z",
        updatedAt: "2026-07-12T10:00:02.000Z",
        toolCallId: "call-1",
      },
    });
    store.applyUpdate(SERVER_ID, {
      kind: "timeline",
      parentAgentId: PARENT_ID,
      subagentId: SUBAGENT_ID,
      provider: "codex",
      epoch: "epoch-1",
      seq: 1,
      timestamp: "2026-07-12T10:00:01.000Z",
      item: { type: "assistant_message", text: "Finished output." },
    });

    store.hideFinishedForParent(SERVER_ID, PARENT_ID);

    const state = useProviderSubagentStore.getState();
    const key = providerSubagentKey(SERVER_ID, PARENT_ID, SUBAGENT_ID);
    expect(state.descriptors.get(key)?.title).toBe("Finished child");
    expect(useProviderSubagentArchiveStore.getState().hiddenFromTrack.has(key)).toBe(true);
    expect(state.timelines.get(key)?.tail).toEqual([
      expect.objectContaining({ kind: "assistant_message", text: "Finished output." }),
    ]);
  });

  test("仅子会话自己的新回合恢复已归档子任务，同一工具调用可继续使用", () => {
    const store = useProviderSubagentStore.getState();
    const completed = {
      id: SUBAGENT_ID,
      parentAgentId: PARENT_ID,
      provider: "codex" as const,
      title: "Finished child",
      description: null,
      status: "completed" as const,
      createdAt: "2026-07-12T10:00:00.000Z",
      updatedAt: "2026-07-12T10:00:02.000Z",
      toolCallId: "call-1",
      runId: "child-turn-1",
    };
    store.applyUpdate(SERVER_ID, { kind: "upsert", subagent: completed });
    store.hideFinishedForParent(SERVER_ID, PARENT_ID);
    store.replaceList(SERVER_ID, PARENT_ID, [completed]);

    const key = providerSubagentKey(SERVER_ID, PARENT_ID, SUBAGENT_ID);
    expect(useProviderSubagentArchiveStore.getState().hiddenFromTrack.has(key)).toBe(true);

    store.applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: {
        ...completed,
        status: "running",
        updatedAt: "2026-07-12T10:01:00.000Z",
        runId: "child-turn-2",
      },
    });

    expect(useProviderSubagentArchiveStore.getState().hiddenFromTrack.has(key)).toBe(false);
  });

  test("重开父会话时旧 running 快照不恢复已归档子任务，终态核对后仍隐藏", () => {
    const store = useProviderSubagentStore.getState();
    const completed = {
      id: SUBAGENT_ID,
      parentAgentId: PARENT_ID,
      provider: "codex" as const,
      title: "Finished child",
      description: null,
      status: "completed" as const,
      createdAt: "2026-11-05T08:00:00.000Z",
      updatedAt: "2026-11-05T08:00:02.000Z",
      toolCallId: "call-1",
      runId: "child-turn-1",
    };
    const key = providerSubagentKey(SERVER_ID, PARENT_ID, SUBAGENT_ID);
    store.applyUpdate(SERVER_ID, { kind: "upsert", subagent: completed });
    store.hideFinishedForParent(SERVER_ID, PARENT_ID);
    store.releaseParent(SERVER_ID, PARENT_ID);

    store.replaceList(SERVER_ID, PARENT_ID, [
      {
        ...completed,
        status: "running",
        updatedAt: "2026-11-05T08:01:00.000Z",
        runId: null,
        toolCallId: "historical-call",
      },
    ]);
    expect(useProviderSubagentArchiveStore.getState().hiddenFromTrack.has(key)).toBe(true);

    store.applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: { ...completed, updatedAt: "2026-11-05T08:02:00.000Z" },
    });
    expect(useProviderSubagentStore.getState().descriptors.get(key)?.status).toBe("completed");
    expect(useProviderSubagentArchiveStore.getState().hiddenFromTrack.has(key)).toBe(true);
  });

  test("keeps hidden state when a child temporarily disappears from the provider list", () => {
    const store = useProviderSubagentStore.getState();
    store.applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: {
        id: SUBAGENT_ID,
        parentAgentId: PARENT_ID,
        provider: "codex",
        title: "Finished child",
        description: null,
        status: "completed",
        createdAt: "2026-07-12T10:00:00.000Z",
        updatedAt: "2026-07-12T10:00:02.000Z",
        toolCallId: "call-1",
      },
    });
    store.hideFinishedForParent(SERVER_ID, PARENT_ID);

    store.replaceList(SERVER_ID, PARENT_ID, []);

    const state = useProviderSubagentStore.getState();
    const key = providerSubagentKey(SERVER_ID, PARENT_ID, SUBAGENT_ID);
    expect(state.descriptors.has(key)).toBe(false);
    expect(useProviderSubagentArchiveStore.getState().hiddenFromTrack.has(key)).toBe(true);
  });

  test("keeps a finished child hidden across remove and history replay", () => {
    const store = useProviderSubagentStore.getState();
    const completed = {
      id: SUBAGENT_ID,
      parentAgentId: PARENT_ID,
      provider: "codex" as const,
      title: "Finished child",
      description: null,
      status: "completed" as const,
      createdAt: "2026-07-12T10:00:00.000Z",
      updatedAt: "2026-07-12T10:00:02.000Z",
      toolCallId: "call-1",
    };
    store.applyUpdate(SERVER_ID, { kind: "upsert", subagent: completed });
    store.hideFinishedForParent(SERVER_ID, PARENT_ID);
    store.applyUpdate(SERVER_ID, {
      kind: "remove",
      parentAgentId: PARENT_ID,
      subagentId: SUBAGENT_ID,
    });
    store.applyUpdate(SERVER_ID, { kind: "upsert", subagent: completed });

    const key = providerSubagentKey(SERVER_ID, PARENT_ID, SUBAGENT_ID);
    expect(useProviderSubagentArchiveStore.getState().hiddenFromTrack.has(key)).toBe(true);
  });
  test("applies terminal list status to a timeline received before its descriptor", () => {
    const store = useProviderSubagentStore.getState();
    store.applyUpdate(SERVER_ID, {
      kind: "timeline",
      parentAgentId: PARENT_ID,
      subagentId: SUBAGENT_ID,
      provider: "codex",
      epoch: "epoch-1",
      seq: 1,
      timestamp: "2026-07-12T10:00:01.000Z",
      item: { type: "assistant_message", text: "Restored output." },
    });
    const key = providerSubagentKey(SERVER_ID, PARENT_ID, SUBAGENT_ID);
    expect(useProviderSubagentStore.getState().timelines.get(key)?.head).not.toEqual([]);

    store.replaceList(SERVER_ID, PARENT_ID, [
      {
        id: SUBAGENT_ID,
        parentAgentId: PARENT_ID,
        provider: "codex",
        title: "Restored child",
        description: null,
        status: "completed",
        createdAt: "2026-07-12T10:00:00.000Z",
        updatedAt: "2026-07-12T10:00:02.000Z",
        toolCallId: "call-1",
      },
    ]);

    const timeline = useProviderSubagentStore.getState().timelines.get(key);
    expect(timeline?.head).toEqual([]);
    expect(timeline?.tail).toEqual([
      expect.objectContaining({ kind: "assistant_message", text: "Restored output." }),
    ]);
  });

  test("keeps late timeline rows terminal after the descriptor completes", () => {
    const store = useProviderSubagentStore.getState();
    store.applyUpdate(SERVER_ID, {
      kind: "upsert",
      subagent: {
        id: SUBAGENT_ID,
        parentAgentId: PARENT_ID,
        provider: "codex",
        title: "Restored child",
        description: null,
        status: "completed",
        createdAt: "2026-07-12T10:00:00.000Z",
        updatedAt: "2026-07-12T10:00:02.000Z",
        toolCallId: "call-1",
      },
    });
    store.applyUpdate(SERVER_ID, {
      kind: "timeline",
      parentAgentId: PARENT_ID,
      subagentId: SUBAGENT_ID,
      provider: "codex",
      epoch: "epoch-1",
      seq: 1,
      timestamp: "2026-07-12T10:00:01.000Z",
      item: { type: "assistant_message", text: "Late restored output." },
    });

    const timeline = useProviderSubagentStore
      .getState()
      .timelines.get(providerSubagentKey(SERVER_ID, PARENT_ID, SUBAGENT_ID));
    expect(timeline?.head).toEqual([]);
    expect(timeline?.tail).toEqual([
      expect.objectContaining({ kind: "assistant_message", text: "Late restored output." }),
    ]);
  });

  test("merges bounded older pages and tracks whether more history remains", () => {
    const store = useProviderSubagentStore.getState();
    store.replaceTimeline(SERVER_ID, {
      requestId: "tail-page",
      parentAgentId: PARENT_ID,
      subagentId: SUBAGENT_ID,
      provider: "codex",
      direction: "tail",
      epoch: "epoch-1",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 2, maxSeq: 2, nextSeq: 3 },
      hasOlder: true,
      hasNewer: false,
      rows: [
        {
          seq: 2,
          timestamp: "2026-07-12T10:00:02.000Z",
          item: { type: "assistant_message", text: "Recent output." },
        },
      ],
      error: null,
    });
    store.replaceTimeline(SERVER_ID, {
      requestId: "older-page",
      parentAgentId: PARENT_ID,
      subagentId: SUBAGENT_ID,
      provider: "codex",
      direction: "before",
      epoch: "epoch-1",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 1, maxSeq: 2, nextSeq: 3 },
      hasOlder: false,
      hasNewer: true,
      rows: [
        {
          seq: 1,
          timestamp: "2026-07-12T10:00:01.000Z",
          item: { type: "assistant_message", text: "Older output." },
        },
      ],
      error: null,
    });

    const timeline = useProviderSubagentStore
      .getState()
      .timelines.get(providerSubagentKey(SERVER_ID, PARENT_ID, SUBAGENT_ID));
    expect(timeline?.hasOlder).toBe(false);
    expect([...timeline!.rows.keys()]).toEqual([2, 1]);
    expect(timeline?.head).toEqual([
      expect.objectContaining({ kind: "assistant_message", text: "Older output.Recent output." }),
    ]);
  });

  test("ignores delayed live updates from a stale timeline epoch", () => {
    const store = useProviderSubagentStore.getState();
    store.replaceTimeline(SERVER_ID, {
      requestId: "current-page",
      parentAgentId: PARENT_ID,
      subagentId: SUBAGENT_ID,
      provider: "codex",
      direction: "tail",
      epoch: "epoch-current",
      reset: true,
      staleCursor: false,
      gap: false,
      window: { minSeq: 2, maxSeq: 2, nextSeq: 3 },
      hasOlder: false,
      hasNewer: false,
      rows: [
        {
          seq: 2,
          timestamp: "2026-07-12T10:00:02.000Z",
          item: { type: "assistant_message", text: "Current output." },
        },
      ],
      error: null,
    });

    store.applyUpdate(SERVER_ID, {
      kind: "timeline",
      parentAgentId: PARENT_ID,
      subagentId: SUBAGENT_ID,
      provider: "codex",
      epoch: "epoch-stale",
      seq: 3,
      timestamp: "2026-07-12T10:00:03.000Z",
      item: { type: "assistant_message", text: "Stale output." },
    });

    const timeline = useProviderSubagentStore
      .getState()
      .timelines.get(providerSubagentKey(SERVER_ID, PARENT_ID, SUBAGENT_ID));
    expect(timeline?.epoch).toBe("epoch-current");
    expect([...timeline!.rows.keys()]).toEqual([2]);
    expect(timeline?.head).toEqual([
      expect.objectContaining({ kind: "assistant_message", text: "Current output." }),
    ]);
  });

  test("replaces cached rows with an authoritative tail page after a reconnect gap", () => {
    const store = useProviderSubagentStore.getState();
    store.replaceTimeline(SERVER_ID, {
      requestId: "old-tail",
      parentAgentId: PARENT_ID,
      subagentId: SUBAGENT_ID,
      provider: "codex",
      direction: "tail",
      epoch: "epoch-1",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 1, maxSeq: 500, nextSeq: 501 },
      hasOlder: true,
      hasNewer: false,
      rows: [
        {
          seq: 100,
          timestamp: "2026-07-12T10:00:00.000Z",
          item: { type: "assistant_message", text: "Old cached output." },
        },
      ],
      error: null,
    });
    store.replaceTimeline(SERVER_ID, {
      requestId: "reconnect-tail",
      parentAgentId: PARENT_ID,
      subagentId: SUBAGENT_ID,
      provider: "codex",
      direction: "tail",
      epoch: "epoch-1",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 1, maxSeq: 500, nextSeq: 501 },
      hasOlder: true,
      hasNewer: false,
      rows: [
        {
          seq: 401,
          timestamp: "2026-07-12T10:00:01.000Z",
          item: { type: "assistant_message", text: "Current tail output." },
        },
      ],
      error: null,
    });

    const timeline = useProviderSubagentStore
      .getState()
      .timelines.get(providerSubagentKey(SERVER_ID, PARENT_ID, SUBAGENT_ID));
    expect([...timeline!.rows.keys()]).toEqual([401]);
    expect(timeline?.head).toEqual([
      expect.objectContaining({ kind: "assistant_message", text: "Current tail output." }),
    ]);
  });
});
