import { describe, expect, it } from "vitest";
import { resolveLocalHostStartup, type LocalHostStartupInput } from "./local-host-startup";

const starting: LocalHostStartupInput = {
  serverId: "local",
  localServerId: "local",
  connected: false,
  running: true,
  error: null,
};

describe("当前工作区的本地主机启动状态", () => {
  it("本地主机未连接时显示启动而不是失败", () => {
    expect(resolveLocalHostStartup(starting)).toBe("starting");
  });
  it("远程工作区不受本地启动影响", () => {
    expect(resolveLocalHostStartup({ ...starting, serverId: "remote" })).toBeNull();
  });
  it("本地主机已连上时不再等待桌面后台启动任务", () => {
    expect(resolveLocalHostStartup({ ...starting, connected: true })).toBeNull();
  });
  it("身份未知时不猜测远程就是本地", () => {
    expect(resolveLocalHostStartup({ ...starting, localServerId: null })).toBeNull();
  });
  it("启动失败持续显示错误，重试立即恢复启动状态", () => {
    expect(resolveLocalHostStartup({ ...starting, running: false, error: "failed" })).toBe("error");
    expect(resolveLocalHostStartup({ ...starting, error: "failed" })).toBe("starting");
  });
});
