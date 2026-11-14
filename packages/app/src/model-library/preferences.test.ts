import { describe, expect, it } from "vitest";
import type { ProviderSelectionModelRow } from "@/provider-selection/provider-selection";
import {
  EMPTY_MODEL_LIBRARY,
  orderModelRows,
  toggleFavoriteModel,
  reorderVisibleModels,
  readModelLibrary,
  updateModelLibrary,
  modelLibraryStorageKey,
  type ModelLibraryStorage,
} from "./preferences";

const row = (modelId: string, provider = "codex"): ProviderSelectionModelRow => ({
  favoriteKey: `${provider}:${modelId}`,
  provider,
  providerLabel: provider,
  modelId,
  modelLabel: modelId,
});
const rows = [row("a"), row("b"), row("c"), row("d")];
const keys = (entries: ProviderSelectionModelRow[]) => entries.map((entry) => entry.favoriteKey);

describe("模型收藏与展示顺序", () => {
  it("未排序时保留目录顺序，收藏项置顶并保留组内顺序", () => {
    expect(keys(orderModelRows(rows, EMPTY_MODEL_LIBRARY))).toEqual([
      "codex:a",
      "codex:b",
      "codex:c",
      "codex:d",
    ]);
    expect(
      keys(
        orderModelRows(rows, {
          favorites: ["codex:b", "codex:d"],
          order: ["codex:d", "codex:a", "codex:b"],
        }),
      ),
    ).toEqual(["codex:d", "codex:b", "codex:a", "codex:c"]);
  });
  it("收藏可切换，提供方不同的同名模型互不影响", () => {
    const next = toggleFavoriteModel(EMPTY_MODEL_LIBRARY, "codex:a");
    expect(next.favorites).toEqual(["codex:a"]);
    expect(keys(orderModelRows([row("a", "claude"), row("a")], next))).toEqual([
      "codex:a",
      "claude:a",
    ]);
    expect(toggleFavoriteModel(next, "codex:a")).toEqual(EMPTY_MODEL_LIBRARY);
  });
  it("搜索结果拖动只替换可见位置，不丢失隐藏或暂时下线的模型顺序", () => {
    const next = reorderVisibleModels(
      { favorites: [], order: ["codex:a", "codex:b", "codex:c", "codex:d", "codex:offline"] },
      rows,
      [rows[2], rows[0]],
    );
    expect(next.order).toEqual(["codex:c", "codex:b", "codex:a", "codex:d", "codex:offline"]);
  });
  it("跨收藏边界拖动不取消收藏，仍保证收藏置顶", () => {
    const current = { favorites: ["codex:b"], order: [] };
    const next = reorderVisibleModels(current, rows, [rows[2], rows[0], rows[1], rows[3]]);
    expect(keys(orderModelRows(rows, next))).toEqual(["codex:b", "codex:c", "codex:a", "codex:d"]);
    expect(next.favorites).toEqual(["codex:b"]);
  });
  it("收藏视图中跨提供方调整顺序，不改动未显示的模型", () => {
    const catalog = [row("a"), row("b"), row("c", "claude"), row("d", "claude")];
    const current = {
      favorites: ["codex:a", "claude:c"],
      order: ["codex:a", "claude:c", "codex:b", "claude:d"],
    };
    const next = reorderVisibleModels(current, catalog, [catalog[2], catalog[0]]);
    expect(next.order).toEqual(["claude:c", "codex:a", "codex:b", "claude:d"]);
    expect(next.favorites).toEqual(current.favorites);
  });
  it("拒绝目录外或重复的拖动结果", () => {
    expect(() => reorderVisibleModels(EMPTY_MODEL_LIBRARY, rows, [row("outside")])).toThrow(
      "absent",
    );
    expect(() => reorderVisibleModels(EMPTY_MODEL_LIBRARY, rows, [rows[0], rows[0]])).toThrow(
      "Duplicate",
    );
  });
});

function memoryStorage(): ModelLibraryStorage {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
  };
}

describe("模型偏好持久化", () => {
  it("按主机隔离保存并能重新读取", async () => {
    const storage = memoryStorage();
    await updateModelLibrary(storage, "one", (value) => toggleFavoriteModel(value, "codex:a"));
    expect((await readModelLibrary(storage, "one")).favorites).toEqual(["codex:a"]);
    expect(await readModelLibrary(storage, "two")).toEqual(EMPTY_MODEL_LIBRARY);
  });
  it("非法数据明确失败，不覆盖为默认空收藏", async () => {
    const storage = memoryStorage();
    await storage.setItem(modelLibraryStorageKey("one"), "not-json");
    await expect(readModelLibrary(storage, "one")).rejects.toThrow();
  });
  it("保存失败返回错误，不报告已保存", async () => {
    const storage: ModelLibraryStorage = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error("存储已满");
      },
    };
    await expect(
      updateModelLibrary(storage, "one", (value) => toggleFavoriteModel(value, "codex:a")),
    ).rejects.toThrow("存储已满");
  });
});
