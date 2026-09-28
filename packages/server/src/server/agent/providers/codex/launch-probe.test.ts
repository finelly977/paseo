import { describe, expect, test } from "vitest";
import type { ResolvedProviderLaunch } from "../../provider-launch-config.js";
import { CodexLaunchProbe } from "./launch-probe.js";

const launch: ResolvedProviderLaunch = { command: "codex", args: [], source: "default" };

describe("Codex 启动探测", () => {
  test("搜索环境变化立即重新定位可执行文件", async () => {
    const original = process.env.PATHEXT;
    let checks = 0;
    const probe = new CodexLaunchProbe({
      checkAvailability: async () => ({ available: true, resolvedPath: `/bin/codex-${++checks}` }),
      readVersion: async () => "0.128.0",
    });
    try {
      await expect(probe.checkAvailability(launch)).resolves.toEqual({
        available: true,
        resolvedPath: "/bin/codex-1",
      });
      process.env.PATHEXT = ".TEST";
      await expect(probe.checkAvailability(launch)).resolves.toEqual({
        available: true,
        resolvedPath: "/bin/codex-2",
      });
    } finally {
      if (original === undefined) delete process.env.PATHEXT;
      else process.env.PATHEXT = original;
    }
  });

  test("并发和串行调用共用路径及版本结果，过期后重新探测", async () => {
    let now = 0;
    let checks = 0;
    const versionCommands: string[] = [];
    const probe = new CodexLaunchProbe({
      now: () => now,
      checkAvailability: async () => {
        checks += 1;
        return { available: true, resolvedPath: "/bin/codex" };
      },
      readVersion: async (command) => {
        versionCommands.push(command);
        return "codex-cli 0.128.0";
      },
    });
    const results = await Promise.all(Array.from({ length: 16 }, () => probe.readVersion(launch)));
    expect(results).toEqual(Array(16).fill("codex-cli 0.128.0"));
    await probe.checkAvailability(launch);
    await probe.readVersion(launch);
    expect(checks).toBe(1);
    expect(versionCommands).toEqual(["/bin/codex"]);
    now = 60_001;
    await probe.readVersion(launch);
    expect(checks).toBe(2);
    expect(versionCommands).toEqual(["/bin/codex", "/bin/codex"]);
  });

  test("更换自定义启动命令不复用旧版本，保留覆盖命令的语义", async () => {
    const commands: string[] = [];
    const probe = new CodexLaunchProbe({
      checkAvailability: async () => ({ available: true, resolvedPath: "/resolved/codex" }),
      readVersion: async (command) => {
        commands.push(command);
        return "0.128.0";
      },
    });
    await probe.readVersion(launch);
    await probe.readVersion({ command: "custom-codex", args: ["--custom"], source: "override" });
    expect(commands).toEqual(["/resolved/codex", "custom-codex"]);
  });

  test("缺失或探测异常不阻止修复安装后重试", async () => {
    let attempt = 0;
    const probe = new CodexLaunchProbe({
      checkAvailability: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("probe failed");
        return { available: attempt > 2, resolvedPath: attempt > 2 ? "/bin/codex" : null };
      },
      readVersion: async () => "0.128.0",
    });
    await expect(probe.checkAvailability(launch)).rejects.toThrow("probe failed");
    await expect(probe.checkAvailability(launch)).resolves.toEqual({
      available: false,
      resolvedPath: null,
    });
    await expect(probe.readVersion(launch)).resolves.toBe("0.128.0");
    expect(attempt).toBe(3);
  });

  test("错误版本响应不作为永久关闭功能的结果缓存", async () => {
    let attempt = 0;
    const probe = new CodexLaunchProbe({
      checkAvailability: async () => ({ available: true, resolvedPath: "/bin/codex" }),
      readVersion: async () => (++attempt === 1 ? "error: timeout" : "0.128.0"),
    });
    await expect(probe.readVersion(launch)).rejects.toThrow("Invalid Codex version response");
    await expect(probe.readVersion(launch)).resolves.toBe("0.128.0");
    expect(attempt).toBe(2);
  });
});
