import { expect, test } from "vitest";
import { z } from "zod";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { PiRpcAgentClient } from "./pi/agent.js";
import { FakePi } from "./pi/test-utils/fake-pi.js";
import { OmpAgentClient } from "./omp/agent.js";
import { FakeOmp } from "./omp/test-utils/fake-omp.js";
import { CodexAppServerAgentSession } from "./codex-app-server-agent.js";
import { createFakeCodexAppServer } from "./codex/test-utils/fake-app-server.js";
import { OpenCodeAgentClient } from "./opencode-agent.js";
import {
  TestOpenCodeClient,
  TestOpenCodeHarness,
} from "./opencode/test-utils/test-opencode-harness.js";

test("Pi 使用原生名称 RPC，保留原生失败", async () => {
  const runtime = new FakePi();
  const client = new PiRpcAgentClient({ logger: createTestLogger(), runtime });
  const session = await client.createSession({ provider: "pi", cwd: process.cwd() });
  try {
    if (!session.renameSessionTitle || !session.getSessionTitle) throw new Error("缺少标题接口");
    await session.renameSessionTitle("Pi 新名称");
    expect(runtime.latestSession().sessionNameRequests).toEqual(["Pi 新名称"]);
    expect(await session.getSessionTitle()).toBe("Pi 新名称");
    runtime.latestSession().setSessionNameError = new Error("原生拒绝");
    await expect(session.renameSessionTitle("不能保存")).rejects.toThrow("原生拒绝");
  } finally {
    await session.close();
  }
});

test("OMP 使用原生名称 RPC", async () => {
  const runtime = new FakeOmp();
  const client = new OmpAgentClient({ logger: createTestLogger(), runtime });
  const session = await client.createSession({ provider: "omp", cwd: process.cwd() });
  try {
    if (!session.renameSessionTitle || !session.getSessionTitle) throw new Error("缺少标题接口");
    await session.renameSessionTitle("OMP 新名称");
    expect(await session.getSessionTitle()).toBe("OMP 新名称");
  } finally {
    await session.close();
  }
});

test("Codex 调用 thread/name/set，不发送提示词或分叉会话", async () => {
  let title = "旧名称";
  const appServer = createFakeCodexAppServer({
    "thread/name/set": (params) => {
      const input = z.object({ threadId: z.literal("thread-1"), name: z.string() }).parse(params);
      title = input.name;
      return {};
    },
    "thread/read": () => ({ thread: { id: "thread-1", name: title } }),
  });
  const session = new CodexAppServerAgentSession(
    { provider: "codex", cwd: process.cwd(), model: "gpt-5.4", modeId: "auto" },
    null,
    createTestLogger(),
    () => appServer.spawnChild(),
  );
  try {
    await session.connect();
    await session.getRuntimeInfo();
    await session.renameSessionTitle("Codex 新名称");
    expect(await session.getSessionTitle()).toBe("Codex 新名称");
    expect(
      appServer
        .requests()
        .filter((request) => request.method === "turn/start" || request.method === "thread/fork"),
    ).toEqual([]);
    appServer.assertNoErrors();
  } finally {
    await session.close();
  }
});

test("OpenCode 通过 session.update 修改名称，原生错误向上传递", async () => {
  const runtime = new TestOpenCodeHarness();
  const native = new TestOpenCodeClient();
  native.sessionUpdateResponse = { data: { id: "session-1", title: "新名称" } };
  native.sessionGetResponse = { data: { id: "session-1", title: "新名称" } };
  runtime.enqueueClient(native);
  const client = new OpenCodeAgentClient(createTestLogger(), undefined, {
    serverManager: runtime,
    createClient: runtime.createClient,
  });
  const session = await client.createSession({ provider: "opencode", cwd: process.cwd() });
  try {
    if (!session.renameSessionTitle || !session.getSessionTitle) throw new Error("缺少标题接口");
    await session.renameSessionTitle("新名称");
    expect(native.calls.sessionUpdate).toEqual([
      { sessionID: "session-1", directory: process.cwd(), title: "新名称" },
    ]);
    expect(await session.getSessionTitle()).toBe("新名称");
    native.sessionUpdateResponse = { error: "原生拒绝" };
    await expect(session.renameSessionTitle("失败名称")).rejects.toThrow("原生拒绝");
  } finally {
    await session.close();
  }
});
