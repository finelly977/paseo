import {
  mkdtempSync,
  mkdirSync,
  promises as fsPromises,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { claudeProjectDirSync } from "./project-dir.js";
import {
  migrateClaudeSdkSessionsToCliEntrypoint,
  rewriteActiveClaudeSessionEntrypointAsCli,
  rewriteClaudeSdkEntrypointsAsCli,
} from "./session-entrypoint.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "paseo-claude-entrypoint-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Claude 会话来源转换", () => {
  test("只修改顶层 SDK 来源并保留嵌套业务数据", () => {
    const source = [
      JSON.stringify({ type: "user", entrypoint: "sdk-cli", message: "你好" }),
      JSON.stringify({
        type: "assistant",
        entrypoint: "cli",
        toolUseResult: { entrypoint: "sdk-cli" },
      }),
      JSON.stringify({ type: "user", entrypoint: "sdk-python", message: "继续" }),
      "",
    ].join("\r\n");

    const rewritten = rewriteClaudeSdkEntrypointsAsCli(source);

    expect(rewritten.changedEntries).toBe(2);
    expect(Buffer.byteLength(rewritten.content)).toBe(Buffer.byteLength(source));
    expect(rewritten.content.endsWith("\r\n")).toBe(true);
    const entries = rewritten.content
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries[0].entrypoint).toBe("cli");
    expect(entries[1].entrypoint).toBe("cli");
    expect(entries[1].toolUseResult).toEqual({ entrypoint: "sdk-cli" });
    expect(entries[2].entrypoint).toBe("cli");
  });

  test("运行中转换保持文件字节长度且只修改顶层来源", async () => {
    const configDir = createTempDir();
    const cwd = createTempDir();
    const projectDir = claudeProjectDirSync(cwd, { configDir });
    mkdirSync(projectDir, { recursive: true });
    const sessionPath = path.join(projectDir, "active-session.jsonl");
    const source = [
      JSON.stringify({
        type: "user",
        message: "中文内容",
        entrypoint: "sdk-cli",
        nested: { entrypoint: "sdk-ts" },
      }),
      JSON.stringify({ type: "assistant", entrypoint: "sdk-python", message: "完成" }),
      "",
    ].join("\n");
    writeFileSync(sessionPath, source);

    const result = await rewriteActiveClaudeSessionEntrypointAsCli({
      configDir,
      session: { cwd, sessionId: "active-session" },
    });

    expect(result).toMatchObject({ status: "migrated", changedEntries: 2 });
    const rewritten = readFileSync(sessionPath, "utf8");
    expect(Buffer.byteLength(rewritten)).toBe(Buffer.byteLength(source));
    const entries = rewritten
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries[0].entrypoint).toBe("cli");
    expect(entries[0].nested).toEqual({ entrypoint: "sdk-ts" });
    expect(entries[1].entrypoint).toBe("cli");
  });

  test("运行中转换明确报告尚未生成的会话文件", async () => {
    const configDir = createTempDir();
    const cwd = createTempDir();

    await expect(
      rewriteActiveClaudeSessionEntrypointAsCli({
        configDir,
        session: { cwd, sessionId: "missing-session" },
      }),
    ).resolves.toMatchObject({ status: "missing" });
  });

  test("多条来源转换中途失败时恢复已经写入的字节", async () => {
    const configDir = createTempDir();
    const cwd = createTempDir();
    const projectDir = claudeProjectDirSync(cwd, { configDir });
    mkdirSync(projectDir, { recursive: true });
    const sessionPath = path.join(projectDir, "rollback-session.jsonl");
    const source = [
      JSON.stringify({ type: "user", entrypoint: "sdk-cli" }),
      JSON.stringify({ type: "assistant", entrypoint: "sdk-ts" }),
      "",
    ].join("\n");
    writeFileSync(sessionPath, source);
    const handle = await fsPromises.open(sessionPath, "r+");
    const originalWrite = handle.write.bind(handle);
    let writeCount = 0;
    vi.spyOn(handle, "write").mockImplementation(async (...args) => {
      writeCount += 1;
      if (writeCount === 2) {
        throw new Error("模拟第二条来源写入失败");
      }
      return originalWrite(...args);
    });
    vi.spyOn(fsPromises, "open").mockResolvedValue(handle);

    await expect(
      rewriteActiveClaudeSessionEntrypointAsCli({
        configDir,
        session: { cwd, sessionId: "rollback-session" },
      }),
    ).rejects.toThrow("模拟第二条来源写入失败");
    expect(readFileSync(sessionPath, "utf8")).toBe(source);
  });

  test("迁移 Paseo 持有的 Claude 会话并跳过缺失与重复句柄", async () => {
    const configDir = createTempDir();
    const cwd = createTempDir();
    const projectDir = claudeProjectDirSync(cwd, { configDir });
    mkdirSync(projectDir, { recursive: true });
    const sessionPath = path.join(projectDir, "session-a.jsonl");
    writeFileSync(
      sessionPath,
      `${JSON.stringify({ type: "user", entrypoint: "sdk-cli", message: "测试" })}\n`,
    );

    const result = await migrateClaudeSdkSessionsToCliEntrypoint({
      configDir,
      sessions: [
        { cwd, sessionId: "session-a" },
        { cwd, sessionId: "session-a" },
        { cwd, sessionId: "missing-session" },
      ],
    });

    expect(result).toMatchObject({
      scannedFiles: 2,
      migratedFiles: 1,
      changedEntries: 1,
      missingFiles: 1,
      failures: [],
    });
    expect(JSON.parse(readFileSync(sessionPath, "utf8")).entrypoint).toBe("cli");
  });

  test("单个损坏会话会显式报告且不阻止其他会话迁移", async () => {
    const configDir = createTempDir();
    const cwd = createTempDir();
    const projectDir = claudeProjectDirSync(cwd, { configDir });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "broken.jsonl"), '{"entrypoint":"sdk-cli"\n');
    const validPath = path.join(projectDir, "valid.jsonl");
    writeFileSync(validPath, '{"entrypoint":"sdk-cli"}\n');

    const result = await migrateClaudeSdkSessionsToCliEntrypoint({
      configDir,
      sessions: [
        { cwd, sessionId: "broken" },
        { cwd, sessionId: "valid" },
      ],
    });

    expect(result.migratedFiles).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].sessionPath).toContain("broken.jsonl");
    expect(result.failures[0].error).toBeInstanceOf(Error);
    expect(JSON.parse(readFileSync(validPath, "utf8")).entrypoint).toBe("cli");
  });
});
