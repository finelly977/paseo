import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { createPackageWithOptions, statFile } from "@electron/asar";
import { build } from "esbuild";
import { load } from "js-yaml";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const desktopRoot = fileURLToPath(new URL("../../", import.meta.url));
const serverRoot = path.resolve(desktopRoot, "../server");
const hostDirectory = "node_modules/@getpaseo/server/dist/server/server/agent/providers/codex";
const bundleRelativePath = `${hostDirectory}/desktop-tools-host.bundle.mjs`;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function createPackagedHost() {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-asar 宿主-"));
  temporaryDirectories.push(directory);
  const staging = path.join(directory, "staging");
  const appOutDir = path.join(directory, "app");
  const resources = path.join(appOutDir, "resources");
  const archive = path.join(resources, "app.asar");
  const hostPath = path.join(`${archive}.unpacked`, bundleRelativePath);
  await mkdir(path.join(staging, hostDirectory), { recursive: true });
  await mkdir(resources, { recursive: true });
  await writeFile(
    path.join(staging, "node_modules/@getpaseo/server/package.json"),
    JSON.stringify({ type: "module" }),
  );
  await execFileAsync(
    process.execPath,
    [
      path.join(serverRoot, "scripts/build-codex-desktop-host.mjs"),
      path.join(staging, bundleRelativePath),
    ],
    { windowsHide: true },
  );
  await build({
    entryPoints: [
      path.join(serverRoot, "src/server/agent/providers/codex/desktop-tools-helper.ts"),
    ],
    outfile: path.join(staging, hostDirectory, "desktop-tools-helper.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
  });
  const config = z
    .object({ asarUnpack: z.array(z.string()) })
    .parse(load(await readFile(path.join(desktopRoot, "electron-builder.yml"), "utf8")));
  const patterns = config.asarUnpack.map((pattern) =>
    path.join(staging, pattern).replaceAll("\\", "/"),
  );
  await createPackageWithOptions(staging.replaceAll("\\", "/"), archive, {
    unpack: `{${patterns.join(",")}}`,
  });
  await rm(staging, { recursive: true });
  return { directory, appOutDir, archive, hostPath };
}

async function runAfterPack(appOutDir: string) {
  const hookPath = path.join(desktopRoot, "scripts/after-pack.js");
  const context = { appOutDir, electronPlatformName: "win32", arch: 1 };
  const source = `
require(${JSON.stringify(hookPath)}).default(${JSON.stringify(context)}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;
  return execFileAsync(process.execPath, ["-e", source], {
    windowsHide: true,
    timeout: 10000,
    env: { ...process.env, PASEO_DESKTOP_SMOKE: "0" },
  });
}

describe("Codex 桌面宿主安装包", () => {
  test("真实 ASAR 中的客户端可通过外部 Node 执行独立宿主、转发请求和授权并完整退出", async () => {
    const { directory, appOutDir, archive, hostPath } = await createPackagedHost();
    await runAfterPack(appOutDir);
    expect(statFile(archive, path.normalize(bundleRelativePath))).toMatchObject({ unpacked: true });
    const modulePath = path.join(directory, "sdk.mjs");
    const closeMarker = path.join(directory, "closed.txt");
    // 只替换会操作真实桌面的 SDK 端口；ASAR、构建产物、Node 和宿主通信均使用真实实现。
    await writeFile(
      modulePath,
      `
import { writeFileSync } from "node:fs";
export class WindowsHelperTransport {
  constructor(options) { this.options = options; }
  async request(method, params, options) {
    if (method === "approve") return options.createElicitation(params);
    return {
      method, params, metadata: options.codexTurnMetadata, pid: process.pid,
      home: process.env.CODEX_HOME, cli: process.env.CODEX_CLI_PATH,
      entrypoint: process.argv[1], electron: process.versions.electron ?? null,
      nodeOptions: process.env.NODE_OPTIONS ?? null, nodePath: process.env.NODE_PATH ?? null,
      electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null,
      parentPidMatches: this.options.helperArgs[1] === String(process.pid),
    };
  }
  async close() { writeFileSync(${JSON.stringify(closeMarker)}, "closed"); }
}
`,
    );
    const helperUrl = pathToFileURL(
      path.join(archive, hostDirectory, "desktop-tools-helper.js"),
    ).href;
    const probePath = path.join(directory, "probe.mjs");
    await writeFile(
      probePath,
      `
import assert from "node:assert/strict";
import { createCodexDesktopHelper } from ${JSON.stringify(helperUrl)};
const [nodePath, modulePath, codexHome, cliPath, hostPath] = process.argv.slice(2);
const helper = await createCodexDesktopHelper({
  nodePath, modulePath, codexHome, cliPath, helperPath: "native-helper-test-port",
  logger: { debug() {}, trace() {}, warn: console.error, error: console.error },
});
let pid;
try {
  const result = await helper.request("probe", { value: 1 }, {
    codexTurnMetadata: { session_id: "session", turn_id: "turn" },
    async createElicitation() { throw new Error("Unexpected approval"); },
  });
  pid = result.pid;
  assert.equal(Number.isInteger(pid), true);
  delete result.pid;
  assert.deepEqual(result, {
    method: "probe", params: { value: 1 },
    metadata: { session_id: "session", turn_id: "turn" },
    home: codexHome, cli: cliPath, entrypoint: hostPath, electron: null,
    nodeOptions: null, nodePath: null, electronRunAsNode: null, parentPidMatches: true,
  });
  for (const action of ["accept", "decline", "cancel"]) {
    const prompt = { message: "允许使用测试应用？" };
    const seen = [];
    const result = await helper.request("approve", prompt, {
      async createElicitation(request) {
        seen.push(request);
        return { action, _meta: { persist: "session" } };
      },
    });
    assert.deepEqual(result, { action, _meta: { persist: "session" } });
    assert.deepEqual(seen, [prompt]);
  }
} finally {
  await helper.close();
}
await helper.close();
assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
process.stdout.write("宿主验证通过\\n");
`,
    );
    const electronPath = z.string().parse(require("electron"));
    const result = await execFileAsync(
      electronPath,
      [probePath, process.execPath, modulePath, directory, "codex-test", hostPath],
      {
        windowsHide: true,
        timeout: 20000,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          NODE_OPTIONS: "--trace-warnings",
          NODE_PATH: path.join(directory, "no-node-modules"),
        },
      },
    );
    expect(result.stdout).toBe("宿主验证通过\n");
    expect(await readFile(closeMarker, "utf8")).toBe("closed");
  }, 30000);

  test("安装包缺少磁盘宿主时中止打包，不能只凭 ASAR 内记录放行", async () => {
    const { appOutDir, archive, hostPath } = await createPackagedHost();
    await rm(hostPath);
    expect(statFile(archive, path.normalize(bundleRelativePath))).toMatchObject({ unpacked: true });

    await expect(runAfterPack(appOutDir)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Codex 桌面工具宿主未正确解包"),
    });
  }, 30000);
});
