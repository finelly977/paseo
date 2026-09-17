import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { createCodexDesktopHelper, resolveCodexDesktopHostPath } from "./desktop-tools-helper.js";
import { DesktopHelperTransportError } from "./desktop-tools-bridge.js";

describe("Codex 桌面 SDK 独立宿主", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.toReversed()) await cleanup();
    cleanups.length = 0;
  });

  async function start() {
    const directory = await mkdtemp(path.join(os.tmpdir(), "paseo-sdk-host-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const modulePath = path.join(directory, "sdk.mjs");
    await writeFile(
      modulePath,
      `
export class WindowsHelperTransport {
  constructor(options) { this.options = options; }
  async request(method, params, options) {
    if (method === "crash") process.exit(17);
    if (method === "approve") return options.createElicitation(params);
    return {
      method, params, metadata: options.codexTurnMetadata,
      home: process.env.CODEX_HOME, cli: process.env.CODEX_CLI_PATH,
      parentPidMatches: this.options.helperArgs[1] === String(process.pid),
    };
  }
  async close() {}
}
`,
    );
    const helper = await createCodexDesktopHelper({
      nodePath: process.execPath,
      modulePath,
      helperPath: path.join(directory, "native-helper"),
      codexHome: directory,
      cliPath: path.join(directory, "codex.exe"),
      logger: createTestLogger(),
    });
    cleanups.push(() => helper.close());
    return { helper, directory };
  }

  test("安装版从磁盘解包目录加载独立宿主，而不是把 ASAR 虚拟路径交给 Node", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "paseo-sdk-host-path-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const relativeDirectory = path.join("node_modules", "@getpaseo", "server");
    const unpackedDirectory = path.join(directory, "app.asar.unpacked", relativeDirectory);
    await mkdir(unpackedDirectory, { recursive: true });
    const hostPath = path.join(unpackedDirectory, "desktop-tools-host.bundle.mjs");
    await writeFile(hostPath, "export {};\n");
    const helperUrl = pathToFileURL(
      path.join(directory, "app.asar", relativeDirectory, "desktop-tools-helper.js"),
    ).href;

    await expect(resolveCodexDesktopHostPath(helperUrl)).resolves.toBe(hostPath);
  });

  test.each(["dist", "app.asar.backup", "app.asar.unpacked"])(
    "普通磁盘目录 %s 使用同目录独立宿主，不误改路径中的相似名称",
    async (name) => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "paseo-sdk-host-path-"));
      cleanups.push(() => rm(directory, { recursive: true, force: true }));
      const runtimeDirectory = path.join(directory, name);
      await mkdir(runtimeDirectory);
      const hostPath = path.join(runtimeDirectory, "desktop-tools-host.bundle.mjs");
      await writeFile(hostPath, "export {};\n");
      const helperUrl = pathToFileURL(path.join(runtimeDirectory, "desktop-tools-helper.js")).href;

      await expect(resolveCodexDesktopHostPath(helperUrl)).resolves.toBe(hostPath);
    },
  );

  test("独立宿主缺失时报告具体路径和原始错误，不回退到仍依赖 ASAR 的旧文件", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "paseo-sdk-host-missing-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    await writeFile(path.join(directory, "desktop-tools-host.js"), "export {};\n");
    const helperUrl = pathToFileURL(path.join(directory, "desktop-tools-helper.js")).href;

    await expect(resolveCodexDesktopHostPath(helperUrl)).rejects.toMatchObject({
      name: "CodexDesktopHostUnavailableError",
      hostPath: path.join(directory, "desktop-tools-host.bundle.mjs"),
      cause: { code: "ENOENT" },
    });
  });

  test("宿主路径指向目录时拒绝启动", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "paseo-sdk-host-directory-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const hostPath = path.join(directory, "desktop-tools-host.bundle.mjs");
    await mkdir(hostPath);
    const helperUrl = pathToFileURL(path.join(directory, "desktop-tools-helper.js")).href;

    await expect(resolveCodexDesktopHostPath(helperUrl)).rejects.toMatchObject({
      name: "CodexDesktopHostUnavailableError",
      hostPath,
      cause: { message: "Codex desktop tools host is not a regular file" },
    });
  });

  test("在干净 Node 子进程中加载 SDK，并使用本会话的数据目录和父进程", async () => {
    const { helper, directory } = await start();
    await expect(
      helper.request(
        "probe",
        { value: 1 },
        {
          codexTurnMetadata: { session_id: "session", turn_id: "turn" },
          async createElicitation() {
            throw new Error("Unexpected approval");
          },
        },
      ),
    ).resolves.toEqual({
      method: "probe",
      params: { value: 1 },
      metadata: { session_id: "session", turn_id: "turn" },
      home: directory,
      cli: path.join(directory, "codex.exe"),
      parentPidMatches: true,
    });
    await helper.close();
    await helper.close();
  });

  test.each(["accept", "decline", "cancel"] as const)(
    "跨 SDK 宿主完整保留授权结果 %s",
    async (action) => {
      const { helper } = await start();
      const prompt = { message: "允许使用测试应用？", meta: { persist: ["session"] } };
      const seen: unknown[] = [];
      await expect(
        helper.request("approve", prompt, {
          async createElicitation(request) {
            seen.push(request);
            return { action, _meta: { persist: "session" } };
          },
        }),
      ).resolves.toEqual({ action, _meta: { persist: "session" } });
      expect(seen).toEqual([prompt]);
    },
  );

  test("SDK 宿主异常退出时请求明确失败，清理不会遗留进程", async () => {
    const { helper } = await start();
    await expect(
      helper.request(
        "crash",
        {},
        {
          async createElicitation() {
            throw new Error("Unexpected approval");
          },
        },
      ),
    ).rejects.toBeInstanceOf(DesktopHelperTransportError);
    await helper.close();
  });
});
