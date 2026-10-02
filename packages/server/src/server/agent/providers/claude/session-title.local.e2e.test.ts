import { expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { claudeProjectDirSync } from "./project-dir.js";
import { accessClaudeSessionTitle } from "./session-title.js";

test("官方 Claude SDK 在隔离配置目录读写原生会话名，不改历史正文", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-title-"));
  const configDir = path.join(root, "config");
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const project = claudeProjectDirSync(root, { configDir });
  await mkdir(project, { recursive: true });
  const file = path.join(project, `${sessionId}.jsonl`);
  const history =
    JSON.stringify({
      type: "user",
      uuid: "22222222-2222-4222-8222-222222222222",
      parentUuid: null,
      isSidechain: false,
      cwd: root,
      sessionId,
      userType: "external",
      message: { role: "user", content: "原始提示词" },
      timestamp: "2026-01-01T00:00:00Z",
    }) + "\n";
  await writeFile(file, history, "utf8");
  const input = { sessionId, cwd: root, env: { CLAUDE_CONFIG_DIR: configDir } };
  try {
    expect(await accessClaudeSessionTitle({ ...input, title: "原生中文名称" })).toBe(
      "原生中文名称",
    );
    expect(await accessClaudeSessionTitle(input)).toBe("原生中文名称");
    expect((await readFile(file, "utf8")).startsWith(history)).toBe(true);
    await expect(
      accessClaudeSessionTitle({
        ...input,
        sessionId: "33333333-3333-4333-8333-333333333333",
        title: "不存在",
      }),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
