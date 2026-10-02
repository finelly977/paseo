import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentStorage } from "./agent-storage.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { SessionTitles } from "./session-titles.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

test("原生改名失败不覆盖 Paseo 名称，重试成功后保存原生名称", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paseo-titles-"));
  directories.push(directory);
  const storage = new AgentStorage(directory, createTestLogger());
  await storage.upsert({
    id: "agent",
    provider: "codex",
    cwd: directory,
    title: "旧名称",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastStatus: "closed",
    labels: {},
    persistence: { provider: "codex", sessionId: "native" },
  });
  let fail = true;
  const titles = new SessionTitles({
    storage,
    canRename: () => true,
    renameNative: async () => {
      if (fail) throw new Error("native failure");
    },
    changed: async () => {},
  });
  await expect(titles.rename({ agentId: "agent", title: "新名称" })).rejects.toThrow(
    "native failure",
  );
  expect((await storage.get("agent"))?.title).toBe("旧名称");
  fail = false;
  await titles.rename({ agentId: "agent", title: "新名称" });
  expect((await storage.get("agent"))?.title).toBe("新名称");
  expect((await storage.get("agent"))?.titleSync).toEqual({
    source: "native",
    legacyTitle: "旧名称",
    migrated: true,
  });
});

async function setup(native: boolean) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paseo-titles-"));
  directories.push(directory);
  const storage = new AgentStorage(directory, createTestLogger());
  await storage.upsert({
    id: "agent",
    provider: "provider",
    cwd: directory,
    title: "Paseo 旧名",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastStatus: "closed",
    labels: {},
    persistence: { provider: "provider", sessionId: "native" },
  });
  const writes: string[] = [];
  const titles = new SessionTitles({
    storage,
    canRename: () => native,
    renameNative: async (_record, title) => {
      writes.push(title);
    },
    readNative: async () => "原生当前名",
    changed: async () => {},
  });
  return { storage, titles, writes };
}

test("读取原生改名会保留迁移前旧名，陈旧读取不能覆盖随后手动改名", async () => {
  const { storage, titles } = await setup(true);
  const snapshot = await storage.get("agent");
  if (!snapshot) throw new Error("缺少测试会话");
  await titles.synchronize(snapshot, "原生当前名");
  expect((await storage.get("agent"))?.titleSync).toEqual({
    source: "native",
    legacyTitle: "Paseo 旧名",
    migrated: false,
  });
  await titles.rename({ agentId: "agent", title: "用户新名" });
  await titles.synchronize(snapshot, "迟到旧名");
  expect((await storage.get("agent"))?.title).toBe("用户新名");
});

test("无原生接口时保留别名，迁移不得把本地写入当作原生成功", async () => {
  const { storage, titles, writes } = await setup(false);
  await titles.rename({ agentId: "agent", title: "本地别名" });
  const snapshot = await storage.get("agent");
  if (!snapshot) throw new Error("缺少测试会话");
  await titles.synchronize(snapshot, "原生名称");
  expect((await storage.get("agent"))?.title).toBe("本地别名");
  await expect(
    titles.rename({ agentId: "agent", title: "迁移名", nativeOnly: true }),
  ).rejects.toThrow("暂不支持");
  expect(writes).toEqual([]);
});

test("预览后原生名称变化时拒绝覆盖", async () => {
  const { titles, writes } = await setup(true);
  await expect(
    titles.rename({
      agentId: "agent",
      title: "迁移名",
      nativeOnly: true,
      expectedNativeTitle: "过期的预览名",
    }),
  ).rejects.toThrow("原生名称已变化");
  expect(writes).toEqual([]);
});

test("同一原生会话的两条 Paseo 记录串行改名并保持一致", async () => {
  const { storage } = await setup(true);
  const original = await storage.get("agent");
  if (!original) throw new Error("缺少测试会话");
  await storage.upsert({ ...original, id: "alias" });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const writes: string[] = [];
  const titles = new SessionTitles({
    storage,
    canRename: () => true,
    changed: async () => {},
    renameNative: async (_record, title) => {
      writes.push(title);
      if (title === "第一名") {
        entered.resolve();
        await release.promise;
      }
    },
  });
  const first = titles.rename({ agentId: "agent", title: "第一名" });
  await entered.promise;
  const second = titles.rename({ agentId: "alias", title: "第二名" });
  release.resolve();
  await Promise.all([first, second]);
  expect(writes).toEqual(["第一名", "第二名"]);
  expect((await storage.list()).map((record) => record.title)).toEqual(["第二名", "第二名"]);
});
