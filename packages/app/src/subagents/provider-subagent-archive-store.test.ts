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
  const storage = createStorage();
  const first = createProviderSubagentArchiveStore(storage);
  first.getState().hide([key]);
  await vi.waitFor(async () => expect(await storage.getItem(STORAGE_KEY)).not.toBeNull());
  const persisted = await storage.getItem(STORAGE_KEY);
  if (!persisted) throw new Error("子智能体归档状态没有持久化");

  const reopened = createProviderSubagentArchiveStore(storage);
  await reopened.persist.rehydrate();

  expect(reopened.getState().hiddenFromTrack).toEqual(new Set([key]));
});
