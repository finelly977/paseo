import { describe, expect, it } from "vitest";
import { resolveDaemonReadiness, type DaemonReadinessRuntime } from "./readiness.js";

function createRuntime() {
  const calls: string[] = [];
  const runtime: DaemonReadinessRuntime = {
    readState: async () => ({
      home: "/paseo",
      listen: "127.0.0.1:6767",
      running: true,
      pidInfo: { pid: 42, desktopManaged: true },
      serverId: "local",
    }),
    connect: async (input) => {
      calls.push(input.host);
      return {
        getLastServerInfoMessage: () => ({
          status: "server_info",
          serverId: "local",
          hostname: "desktop",
          version: "1.2.3",
          desktopManaged: true,
        }),
        close: async () => {
          calls.push("close");
        },
      };
    },
  };
  return { runtime, calls };
}

describe("桌面轻量就绪检查", () => {
  it("只完成握手即可确认身份和版本，不需要完整诊断", async () => {
    const { runtime, calls } = createRuntime();
    await expect(resolveDaemonReadiness("/paseo", runtime)).resolves.toEqual({
      home: "/paseo",
      serverId: "local",
      status: "running",
      listen: "127.0.0.1:6767",
      hostname: "desktop",
      version: "1.2.3",
      desktopManaged: true,
      pid: 42,
      error: null,
    });
    expect(calls).toEqual(["127.0.0.1:6767", "close"]);
  });

  it("拒绝把另一个服务当成本地服务，并关闭临时连接", async () => {
    const { runtime, calls } = createRuntime();
    const readState = runtime.readState;
    runtime.readState = async (home) => ({ ...(await readState(home)), serverId: "other" });
    await expect(resolveDaemonReadiness("/paseo", runtime)).rejects.toThrow(
      "Unexpected daemon identity",
    );
    expect(calls).toEqual(["127.0.0.1:6767", "close"]);
  });

  it.each(["Password required", "Incorrect password", "bad config"])(
    "保留错误 %s，不将其误判为需要启动",
    async (message) => {
      const { runtime } = createRuntime();
      runtime.connect = async () => {
        throw new Error(message);
      };
      await expect(resolveDaemonReadiness("/paseo", runtime)).rejects.toThrow(message);
    },
  );

  it("进程尚存但端口未监听时返回明确的不可连接状态", async () => {
    const { runtime } = createRuntime();
    runtime.connect = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:6767");
    };
    await expect(resolveDaemonReadiness("/paseo", runtime)).resolves.toMatchObject({
      status: "errored",
      pid: 42,
    });
  });

  it("没有活进程且拒绝连接时才认定停止", async () => {
    const { runtime } = createRuntime();
    const readState = runtime.readState;
    runtime.readState = async (home) => ({ ...(await readState(home)), running: false });
    runtime.connect = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    await expect(resolveDaemonReadiness("/paseo", runtime)).resolves.toMatchObject({
      status: "stopped",
      pid: null,
    });
  });

  it("一次超时仅继续等待，不允许回收已有进程", async () => {
    const { runtime } = createRuntime();
    runtime.connect = async () => {
      throw new Error("Connection timed out");
    };
    await expect(resolveDaemonReadiness("/paseo", runtime)).resolves.toMatchObject({
      status: "starting",
      error: "Connection timed out",
    });
  });

  it.each(["unix:///tmp/paseo.sock", "pipe://\\\\.\\pipe\\paseo"])(
    "复用连接器支持本地传输 %s",
    async (listen) => {
      const { runtime, calls } = createRuntime();
      const readState = runtime.readState;
      runtime.readState = async (home) => ({ ...(await readState(home)), listen });
      await resolveDaemonReadiness("/paseo", runtime);
      expect(calls).toEqual([listen, "close"]);
    },
  );

  it("实际握手声明未托管时，不相信陈旧 PID 文件的托管标记", async () => {
    const { runtime } = createRuntime();
    runtime.connect = async () => ({
      getLastServerInfoMessage: () => ({
        status: "server_info",
        serverId: "local",
        desktopManaged: false,
      }),
      close: async () => {},
    });
    await expect(resolveDaemonReadiness("/paseo", runtime)).resolves.toMatchObject({
      status: "running",
      desktopManaged: false,
    });
  });
});
