import { expect, test } from "vitest";
import { z } from "zod";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import {
  CodexAppServerAgentClient,
  CodexSessionTitleWriteError,
} from "./codex-app-server-agent.js";
import { createFakeCodexAppServer } from "./codex/test-utils/fake-app-server.js";

test("Codex 列表的续接快照不能把原生标题改成继续，原生索引按 ID 覆盖副本并去重", async () => {
  const appServer = createFakeCodexAppServer({
    "thread/list": (params) => {
      const { archived, useStateDbOnly } = z
        .object({ archived: z.boolean().optional(), useStateDbOnly: z.boolean().optional() })
        .parse(params);
      if (archived) return { data: [] };
      if (useStateDbOnly)
        return {
          data: [{ id: "native-id", cwd: process.cwd(), name: null, preview: "理解下这个项目" }],
        };
      return {
        data: [
          { id: "native-id", cwd: process.cwd(), preview: "继续", updatedAt: 200 },
          { id: "native-id", cwd: process.cwd(), preview: "旧副本", updatedAt: 100 },
        ],
      };
    },
  });
  const client = new CodexAppServerAgentClient(createTestLogger(), undefined, {
    spawnAppServer: () => appServer.spawnChild(),
  });
  const sessions = await client.listImportableSessions();
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({
    providerHandleId: "native-id",
    title: "理解下这个项目",
    firstPromptPreview: "理解下这个项目",
  });
  expect(appServer.requests().filter((request) => request.method === "thread/read")).toEqual([]);
  appServer.assertNoErrors();
});

test("Codex 目录以原生索引中的最新名称覆盖文件发现结果中的过期名称", async () => {
  const appServer = createFakeCodexAppServer({
    "thread/list": (params) => {
      const { archived, useStateDbOnly } = z
        .object({ archived: z.boolean().optional(), useStateDbOnly: z.boolean().optional() })
        .parse(params);
      if (archived) return { data: [] };
      const name = useStateDbOnly ? "用户在原生端改的新名" : "列表旧名";
      const preview = useStateDbOnly ? "首条消息" : "继续";
      return { data: [{ id: "native-id", cwd: process.cwd(), name, preview }] };
    },
  });
  const client = new CodexAppServerAgentClient(createTestLogger(), undefined, {
    spawnAppServer: () => appServer.spawnChild(),
  });
  expect(await client.listImportableSessions()).toEqual([
    expect.objectContaining({ title: "用户在原生端改的新名", firstPromptPreview: "首条消息" }),
  ]);
  appServer.assertNoErrors();
});

test("未建立索引的原生会话仍保留文件发现结果，不因只读取索引而丢失导入入口", async () => {
  const appServer = createFakeCodexAppServer({
    "thread/list": (params) => {
      const { archived, useStateDbOnly } = z
        .object({ archived: z.boolean().optional(), useStateDbOnly: z.boolean().optional() })
        .parse(params);
      if (archived || useStateDbOnly) return { data: [] };
      return {
        data: [
          { id: "unindexed", cwd: process.cwd(), name: "尚未索引的原生名称", preview: "首条消息" },
        ],
      };
    },
  });
  const client = new CodexAppServerAgentClient(createTestLogger(), undefined, {
    spawnAppServer: () => appServer.spawnChild(),
  });
  expect(await client.listImportableSessions()).toEqual([
    expect.objectContaining({ providerHandleId: "unindexed", title: "尚未索引的原生名称" }),
  ]);
  appServer.assertNoErrors();
});

test("归档索引的名称同样覆盖活动目录中遗留的续接副本", async () => {
  const appServer = createFakeCodexAppServer({
    "thread/list": (params) => {
      const { archived, useStateDbOnly } = z
        .object({ archived: z.boolean().optional(), useStateDbOnly: z.boolean().optional() })
        .parse(params);
      if (useStateDbOnly)
        return {
          data: archived
            ? [
                {
                  id: "native-id",
                  cwd: process.cwd(),
                  name: "已归档的真实名称",
                  preview: "首条消息",
                },
              ]
            : [],
        };
      return { data: [{ id: "native-id", cwd: process.cwd(), preview: "继续" }] };
    },
  });
  const client = new CodexAppServerAgentClient(createTestLogger(), undefined, {
    spawnAppServer: () => appServer.spawnChild(),
  });
  expect(await client.listImportableSessions()).toEqual([
    expect.objectContaining({ title: "已归档的真实名称" }),
  ]);
  appServer.assertNoErrors();
});

test("原生索引读取失败时明确失败，不将错误的续接预览伪装成标题", async () => {
  const appServer = createFakeCodexAppServer({
    "thread/list": (params) => {
      if (z.object({ useStateDbOnly: z.boolean().optional() }).parse(params).useStateDbOnly) {
        return Promise.reject(new Error("原生索引读取失败"));
      }
      return { data: [{ id: "native-id", cwd: process.cwd(), preview: "继续" }] };
    },
  });
  const client = new CodexAppServerAgentClient(createTestLogger(), undefined, {
    spawnAppServer: () => appServer.spawnChild(),
  });
  await expect(client.listImportableSessions()).rejects.toThrow("原生索引读取失败");
  appServer.assertNoErrors();
});

test("原生索引返回非法数据时明确失败，不把解析错误当成空索引", async () => {
  const appServer = createFakeCodexAppServer({
    "thread/list": (params) => {
      if (z.object({ useStateDbOnly: z.boolean().optional() }).parse(params).useStateDbOnly) {
        return { data: "非法索引" };
      }
      return { data: [{ id: "native-id", cwd: process.cwd(), preview: "继续" }] };
    },
  });
  const client = new CodexAppServerAgentClient(createTestLogger(), undefined, {
    spawnAppServer: () => appServer.spawnChild(),
  });
  await expect(client.listImportableSessions()).rejects.toBeInstanceOf(z.ZodError);
  appServer.assertNoErrors();
});

test("已归档会话可从原生索引读取名称，不取消归档或恢复运行时", async () => {
  const appServer = createFakeCodexAppServer({
    "thread/read": () => Promise.reject(new Error("no rollout found for thread id archived-id")),
    "thread/list": () => ({ data: [{ id: "archived-id", name: "归档名称", preview: "首条消息" }] }),
  });
  const client = new CodexAppServerAgentClient(createTestLogger(), undefined, {
    spawnAppServer: () => appServer.spawnChild(),
  });
  expect(await client.getNativeSessionTitle({ provider: "codex", sessionId: "archived-id" })).toBe(
    "归档名称",
  );
  expect(appServer.requests().map((request) => request.method)).toEqual([
    "initialize",
    "initialized",
    "thread/read",
    "thread/list",
  ]);
  appServer.assertNoErrors();
});

test("Codex 持久会话改名后必须从原生读回新名，不恢复会话或发送模型请求", async () => {
  let name = "旧名称";
  const appServer = createFakeCodexAppServer({
    "thread/name/set": (params) => {
      const input = z.object({ threadId: z.literal("native-id"), name: z.string() }).parse(params);
      name = input.name;
      return {};
    },
    "thread/read": () => ({ thread: { name, preview: "继续" } }),
  });
  const client = new CodexAppServerAgentClient(createTestLogger(), undefined, {
    spawnAppServer: () => appServer.spawnChild(),
  });
  await client.renameNativeSessionTitle({
    handle: { provider: "codex", sessionId: "paseo-id", nativeHandle: "native-id" },
    title: "新名称",
  });
  expect(name).toBe("新名称");
  expect(appServer.requests().map((request) => request.method)).toEqual([
    "initialize",
    "initialized",
    "thread/name/set",
    "thread/read",
  ]);
  appServer.assertNoErrors();
});

test("Codex 接口响应成功但原生未保存名称时明确报错", async () => {
  const appServer = createFakeCodexAppServer({
    "thread/name/set": () => ({}),
    "thread/read": () => ({ thread: { name: "仍是旧名", preview: "继续" } }),
  });
  const client = new CodexAppServerAgentClient(createTestLogger(), undefined, {
    spawnAppServer: () => appServer.spawnChild(),
  });
  await expect(
    client.renameNativeSessionTitle({
      handle: { provider: "codex", sessionId: "native-id" },
      title: "新名称",
    }),
  ).rejects.toBeInstanceOf(CodexSessionTitleWriteError);
  appServer.assertNoErrors();
});
