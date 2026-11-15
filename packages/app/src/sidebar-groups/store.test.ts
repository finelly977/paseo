import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EMPTY_SIDEBAR_GROUPS } from "./model";
import { createSidebarGroupsStore, SIDEBAR_GROUPS_STORAGE_KEY } from "./store";

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    entries,
    failNextWrite: false,
    writes: 0,
    getItem: async (key: string) => entries.get(key) ?? null,
    async setItem(key: string, value: string) {
      this.writes++;
      if (this.failNextWrite) {
        this.failNextWrite = false;
        throw new Error("存储已满");
      }
      entries.set(key, value);
    },
  };
}

describe("工作区目录分组保存", () => {
  it("拖动未分组的位置能重开恢复，失败不改原顺序且可重试", async () => {
    const storage = memoryStorage();
    const store = createSidebarGroupsStore({ storage, createId: randomUUID });
    await store.getState().createGroup({ projectKey: "p", name: "开发" });
    const id = store.getState().data.groups[0].id;
    storage.failNextWrite = true;
    await expect(store.getState().setGroupOrder([null, id])).rejects.toThrow("存储已满");
    expect(store.getState().data.ungroupedIndex).toBeUndefined();
    await store.getState().setGroupOrder([null, id]);
    const reopened = createSidebarGroupsStore({ storage, createId: randomUUID });
    await reopened.getState().load();
    expect(reopened.getState().data.ungroupedIndex).toBe(0);
    expect(reopened.getState().data.membership).toEqual({ p: id });
  });
  it("整目录移动、重命名、折叠与排序可重开恢复", async () => {
    const storage = memoryStorage();
    const store = createSidebarGroupsStore({ storage, createId: randomUUID });
    await store.getState().createGroup({ projectKey: "host:first", name: "开发" });
    await store.getState().createGroup({ projectKey: "host:second", name: "参考" });
    const [one, two] = store.getState().data.groups;
    await store.getState().assignProject({ projectKey: "host:second", groupId: one.id });
    await store.getState().renameGroup({ groupId: one.id, name: "实现" });
    await store.getState().toggleCollapsed(one.id);
    await store.getState().setGroupOrder([two.id, one.id, null]);
    const reopened = createSidebarGroupsStore({ storage, createId: randomUUID });
    await reopened.getState().load();
    expect(reopened.getState().data).toEqual(store.getState().data);
    expect(reopened.getState().data.groups.map((group) => group.name)).toEqual(["参考", "实现"]);
    expect(reopened.getState().data.groups[1].collapsed).toBe(true);
    expect(reopened.getState().data.membership).toEqual({
      "host:first": one.id,
      "host:second": one.id,
    });
    await reopened.getState().removeGroup(one.id);
    expect(reopened.getState().data.membership).toEqual({});
  });
  it("连续保存串行执行，不丢失操作，重复名称只能成功一次", async () => {
    const store = createSidebarGroupsStore({ storage: memoryStorage(), createId: randomUUID });
    await Promise.all([
      store.getState().createGroup({ projectKey: null, name: "一" }),
      store.getState().createGroup({ projectKey: null, name: "二" }),
    ]);
    const results = await Promise.allSettled([
      store.getState().createGroup({ projectKey: null, name: "三" }),
      store.getState().createGroup({ projectKey: null, name: "三" }),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(store.getState().data.groups.map((group) => group.name)).toEqual(["一", "二", "三"]);
    expect(store.getState().pending).toBe(0);
  });
  it("保存失败保留旧数据，后续重试不被失败队列阻断", async () => {
    const storage = memoryStorage();
    storage.failNextWrite = true;
    const store = createSidebarGroupsStore({ storage, createId: randomUUID });
    await expect(store.getState().createGroup({ projectKey: "p", name: "开发" })).rejects.toThrow(
      "存储已满",
    );
    expect(store.getState().data).toEqual(EMPTY_SIDEBAR_GROUPS);
    expect(store.getState().pending).toBe(0);
    await store.getState().createGroup({ projectKey: "p", name: "开发" });
    expect(store.getState().data.groups).toHaveLength(1);
    expect(storage.writes).toBe(2);
  });
  it("坏数据读取失败且不覆盖，修复存储后可重试", async () => {
    const storage = memoryStorage();
    storage.entries.set(SIDEBAR_GROUPS_STORAGE_KEY, "invalid");
    const store = createSidebarGroupsStore({ storage, createId: randomUUID });
    await expect(store.getState().load()).rejects.toThrow();
    expect(store.getState().loadState.status).toBe("error");
    await expect(store.getState().createGroup({ projectKey: "p", name: "新" })).rejects.toThrow();
    expect(storage.entries.get(SIDEBAR_GROUPS_STORAGE_KEY)).toBe("invalid");
    storage.entries.set(SIDEBAR_GROUPS_STORAGE_KEY, JSON.stringify(EMPTY_SIDEBAR_GROUPS));
    await store.getState().load();
    expect(store.getState().loadState.status).toBe("ready");
  });
});
