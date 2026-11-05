import { expect, test, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  },
}));

import { createProviderSubagentArchiveStore } from "./provider-subagent-archive-store";

const STORAGE_KEY = "provider-subagent-track-archive";

function createStorage(): StateStorage {
  const values = new Map<string, string>();
  return {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => {
      values.set(name, value);
    },
    removeItem: (name) => {
      values.delete(name);
    },
  };
}

test("归档的提供方子智能体在会话重开和应用重启后仍保持隐藏", async () => {
  const key = "host\0parent\0child";
  const runId = "child-turn-1";
  const storage = createStorage();
  const first = createProviderSubagentArchiveStore(storage);
  first.getState().hide([{ key, runId }]);
  await vi.waitFor(async () => expect(await storage.getItem(STORAGE_KEY)).not.toBeNull());
  const persisted = await storage.getItem(STORAGE_KEY);
  if (!persisted) throw new Error("子智能体归档状态没有持久化");

  const reopened = createProviderSubagentArchiveStore(storage);
  await reopened.persist.rehydrate();

  expect(reopened.getState().hiddenFromTrack).toEqual(new Set([key]));
  expect(reopened.getState().hiddenRunIdByKey).toEqual({ [key]: runId });
  expect(reopened.getState().hydrated).toBe(true);
});

test("旧版归档先等待子会话自身回合建立基线，不被历史重放冲掉", async () => {
  const key = "host\0parent\0child";
  const storage = createStorage();
  await storage.setItem(
    STORAGE_KEY,
    JSON.stringify({ state: { hiddenFromTrack: [key] }, version: 1 }),
  );
  const store = createProviderSubagentArchiveStore(storage);
  await store.persist.rehydrate();

  expect(store.getState().hiddenRunIdByKey).toEqual({ [key]: null });
  store.getState().observe({
    key,
    runId: null,
  });
  expect(store.getState().hiddenFromTrack.has(key)).toBe(true);

  store.getState().observe({
    key,
    runId: "child-turn-1",
  });
  expect(store.getState().hiddenRunIdByKey).toEqual({ [key]: "child-turn-1" });
  expect(store.getState().hiddenFromTrack.has(key)).toBe(true);

  store.getState().observe({
    key,
    runId: "child-turn-2",
  });
  expect(store.getState().hiddenFromTrack.has(key)).toBe(false);
});

test("未确认回合身份的归档先保持隐藏，首个权威回合只建立基线", async () => {
  const key = "host\0parent\0child";
  const store = createProviderSubagentArchiveStore(createStorage());
  await store.persist.rehydrate();
  store.getState().hide([{ key, runId: null }]);
  store.getState().observe({ key, runId: "child-turn-1" });
  expect(store.getState().hiddenFromTrack.has(key)).toBe(true);
  store.getState().observe({ key, runId: null });
  expect(store.getState().hiddenRunIdByKey[key]).toBe("child-turn-1");
});
