import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import {
  DesktopMessageSchema,
  DesktopHelperTransportError,
  startCodexDesktopBridge,
  type DesktopHelper,
  type DesktopRpcRequest,
} from "./desktop-tools-bridge.js";

class NativeClient {
  fragmentSize = Number.POSITIVE_INFINITY;
  private nextId = 0;
  private buffered = Buffer.alloc(0);
  private readonly pending = new Map<number, ReturnType<typeof Promise.withResolvers<unknown>>>();
  readonly approvals: DesktopRpcRequest[] = [];
  onApproval: (request: DesktopRpcRequest) => void = () => undefined;

  constructor(readonly socket: Socket) {
    socket.on("close", () => {
      for (const deferred of this.pending.values()) deferred.reject(new Error("connection closed"));
      this.pending.clear();
    });
    socket.on("data", (chunk) => {
      this.buffered = Buffer.concat([this.buffered, chunk]);
      while (this.buffered.length >= 4) {
        const length = this.buffered.readUInt32LE(0);
        if (this.buffered.length < length + 4) return;
        const raw: unknown = JSON.parse(this.buffered.subarray(4, length + 4).toString("utf8"));
        this.buffered = this.buffered.subarray(length + 4);
        const message = DesktopMessageSchema.parse(raw);
        if ("method" in message && "id" in message) {
          this.approvals.push(message);
          this.onApproval(message);
          continue;
        }
        if (!("id" in message) || typeof message.id !== "number") continue;
        const deferred = this.pending.get(message.id);
        if (!deferred) throw new Error("Unexpected response");
        this.pending.delete(message.id);
        if ("error" in message) deferred.reject(new Error(message.error.message));
        else if ("result" in message) deferred.resolve(message.result);
      }
    });
  }

  send(message: unknown): void {
    const body = Buffer.from(JSON.stringify(message));
    const frame = Buffer.alloc(4 + body.length);
    frame.writeUInt32LE(body.length);
    body.copy(frame, 4);
    for (let offset = 0; offset < frame.length; offset += this.fragmentSize) {
      this.socket.write(frame.subarray(offset, offset + this.fragmentSize));
    }
  }

  call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = ++this.nextId;
    const deferred = Promise.withResolvers<unknown>();
    this.pending.set(id, deferred);
    this.send({ jsonrpc: "2.0", id, method, params });
    return deferred.promise;
  }
}

describe("Codex 独立桌面服务桥", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.toReversed()) await cleanup();
    cleanups.length = 0;
  });

  async function connect(pipePath: string): Promise<NativeClient> {
    const socket = createConnection(pipePath);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    cleanups.push(async () => {
      socket.destroy();
    });
    return new NativeClient(socket);
  }

  async function setup(helper: DesktopHelper | (() => Promise<DesktopHelper>)) {
    const name = `paseo-codex-bridge-test-${randomUUID()}`;
    const pipePath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\${name}`
        : path.join(os.tmpdir(), `${name}.sock`);
    const bridge = await startCodexDesktopBridge({
      pipePath,
      createHelper: typeof helper === "function" ? helper : async () => helper,
      logger: createTestLogger(),
    });
    cleanups.push(() => bridge.dispose());
    return { bridge, client: await connect(pipePath) };
  }

  test("初始化期间结束回合不会在组件启动后继续执行操作", async () => {
    const starting = Promise.withResolvers<void>();
    const ready = Promise.withResolvers<DesktopHelper>();
    let requests = 0;
    let closed = 0;
    const { client } = await setup(async () => {
      starting.resolve();
      return ready.promise;
    });
    const operation = client.call("request", { method: "probe" });
    const failure = expect(operation).rejects.toThrow("canceled");
    await starting.promise;
    const cleanup = client.call("request", { method: "end_turn" });
    await client.call("ping");
    ready.resolve({
      async request() {
        requests++;
        return {};
      },
      async close() {
        closed++;
      },
    });
    await cleanup;
    await failure;
    expect(requests).toBe(0);
    expect(closed).toBe(1);
  });

  test("旧连接结束不会关闭另一会话正在使用的组件", async () => {
    let closed = 0;
    const { bridge, client } = await setup({
      async request() {
        return {};
      },
      async close() {
        closed++;
      },
    });
    const other = await connect(bridge.pipePath);
    await client.call("request", { method: "probe" });
    await other.call("request", { method: "probe" });
    await client.call("close");
    expect(closed).toBe(0);
    await other.call("close");
    expect(closed).toBe(1);
  });

  test("旧回合的迟到清理不会停止同一连接的新回合", async () => {
    let closed = 0;
    const { client } = await setup({
      async request() {
        return {};
      },
      async close() {
        closed++;
      },
    });
    await client.call("request", {
      method: "probe",
      codexTurnMetadata: { session_id: "会话", turn_id: "新回合" },
    });
    await client.call("request", {
      method: "end_turn",
      codexTurnMetadata: { session_id: "会话", turn_id: "旧回合" },
    });
    expect(closed).toBe(0);
    await client.call("request", {
      method: "end_turn",
      codexTurnMetadata: { session_id: "会话", turn_id: "新回合" },
    });
    expect(closed).toBe(1);
  });

  test("初始化期间断连会回收组件且不会执行原始操作", async () => {
    const starting = Promise.withResolvers<void>();
    const ready = Promise.withResolvers<DesktopHelper>();
    const stopped = Promise.withResolvers<void>();
    let requests = 0;
    const { client } = await setup(async () => {
      starting.resolve();
      return ready.promise;
    });
    const request = client.call("request", { method: "probe" });
    const failure = expect(request).rejects.toThrow("connection closed");
    await starting.promise;
    client.socket.destroy();
    await failure;
    ready.resolve({
      async request() {
        requests++;
        return {};
      },
      async close() {
        stopped.resolve();
      },
    });
    await stopped.promise;
    expect(requests).toBe(0);
  });

  test("来自提供方的结束通知只清理匹配的会话回合", async () => {
    let closed = 0;
    const { bridge, client } = await setup({
      async request() {
        return {};
      },
      async close() {
        closed++;
      },
    });
    await client.call("request", {
      method: "probe",
      codexTurnMetadata: { session_id: "owner", turn_id: "turn" },
    });
    await bridge.endTurn({ sessionId: "other", turnId: "turn" });
    expect(closed).toBe(0);
    await bridge.endTurn({ sessionId: "owner", turnId: "turn" });
    expect(closed).toBe(1);
  });

  test("SDK 宿主退出后明确报错，下次操作可重新启动独立宿主", async () => {
    let created = 0;
    let closed = 0;
    const { client } = await setup(async () => {
      const instance = ++created;
      return {
        async request() {
          if (instance === 1) throw new DesktopHelperTransportError(new Error("process exited"));
          return { recovered: true };
        },
        async close() {
          closed++;
        },
      };
    });
    await expect(client.call("request", { method: "probe" })).rejects.toThrow(
      "SDK host disconnected",
    );
    await expect(client.call("request", { method: "probe" })).resolves.toEqual({ recovered: true });
    expect(created).toBe(2);
    expect(closed).toBe(1);
  });

  test("分片到达的长度头和连续消息能够正确解析", async () => {
    const { client } = await setup({
      async request() {
        return {};
      },
      async close() {},
    });
    client.fragmentSize = 2;
    await expect(Promise.all([client.call("ping"), client.call("ping")])).resolves.toEqual([
      "pong",
      "pong",
    ]);
  });

  test.each(["超限", "非法 JSON"])("%s 帧会关闭连接而不调用原生组件", async (kind) => {
    let called = 0;
    const { client } = await setup({
      async request() {
        called++;
        return {};
      },
      async close() {},
    });
    const closed = new Promise<void>((resolve) => client.socket.once("close", resolve));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(kind === "超限" ? 9 * 1024 * 1024 : 1);
    client.socket.write(Buffer.concat([header, Buffer.from("{")]));
    await closed;
    expect(called).toBe(0);
  });

  test("取消后的迟到授权响应不会断开可复用的工具连接", async () => {
    const asked = Promise.withResolvers<DesktopRpcRequest>();
    const { client } = await setup({
      async request(_method, _params, options) {
        return options.createElicitation({ message: "待授权" });
      },
      async close() {},
    });
    client.onApproval = (request) => asked.resolve(request);
    const operation = client.call("request", { method: "probe" });
    const failure = expect(operation).rejects.toThrow("turn ended");
    const approval = await asked.promise;
    await client.call("request", { method: "end_turn" });
    await failure;
    client.send({ jsonrpc: "2.0", id: approval.id, result: { action: "accept" } });
    await expect(client.call("ping")).resolves.toBe("pong");
  });

  test("独立管道可转发原生请求并在退出时关闭自己创建的组件", async () => {
    const calls: unknown[] = [];
    let closed = 0;
    const { bridge, client } = await setup({
      async request(method, params, options) {
        calls.push({ method, params, metadata: options.codexTurnMetadata });
        return { ready: true };
      },
      async close() {
        closed++;
      },
    });
    await expect(client.call("ping")).resolves.toBe("pong");
    await expect(
      client.call("request", {
        method: "probe",
        params: { value: 3 },
        codexTurnMetadata: { session_id: "session", turn_id: "turn" },
      }),
    ).resolves.toEqual({ ready: true });
    expect(calls).toEqual([
      {
        method: "probe",
        params: { value: 3 },
        metadata: { session_id: "session", turn_id: "turn" },
      },
    ]);
    await bridge.dispose();
    expect(closed).toBe(1);
  });

  test.each(["accept", "decline", "cancel"])(
    "原生授权按用户的 %s 决定返回，不自动批准",
    async (action) => {
      const prompt = { message: "允许访问测试应用？", requestedSchema: { type: "object" } };
      const { client } = await setup({
        async request(_method, _params, options) {
          return options.createElicitation(prompt);
        },
        async close() {},
      });
      client.onApproval = (request) => {
        expect(request.method).toBe("requestComputerUseApproval");
        expect(request.params).toEqual(prompt);
        client.send({
          jsonrpc: "2.0",
          id: request.id,
          result: { action, _meta: { persist: "session" } },
        });
      };
      await expect(client.call("request", { method: "probe", params: {} })).resolves.toEqual({
        action,
        _meta: { persist: "session" },
      });
      expect(client.approvals).toHaveLength(1);
    },
  );

  test("拒绝并发操作并保留第一个正在运行的请求", async () => {
    const started = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<unknown>();
    const { client } = await setup({
      async request() {
        started.resolve();
        return completed.promise;
      },
      async close() {},
    });
    const first = client.call("request", { method: "first" });
    await started.promise;
    await expect(client.call("request", { method: "second" })).rejects.toThrow("already running");
    completed.resolve({ finished: true });
    await expect(first).resolves.toEqual({ finished: true });
  });

  test("原生失败会返回明确错误，之后仍可继续请求", async () => {
    let count = 0;
    const { client } = await setup({
      async request() {
        count++;
        if (count === 1) throw new Error("native failure");
        return { ready: true };
      },
      async close() {},
    });
    await expect(client.call("request", { method: "probe" })).rejects.toThrow("native failure");
    await expect(client.call("request", { method: "probe" })).resolves.toEqual({ ready: true });
  });

  test("回合结束会撤回尚未决定的授权并关闭原生组件", async () => {
    const requested = Promise.withResolvers<void>();
    let closed = 0;
    const { client } = await setup({
      async request(_method, _params, options) {
        return options.createElicitation({ message: "待确认" });
      },
      async close() {
        closed++;
      },
    });
    client.onApproval = () => requested.resolve();
    const request = client.call("request", { method: "probe" });
    const failure = expect(request).rejects.toThrow("turn ended");
    await requested.promise;
    await expect(client.call("request", { method: "end_turn" })).resolves.toBeNull();
    await failure;
    expect(closed).toBe(1);
  });
});
