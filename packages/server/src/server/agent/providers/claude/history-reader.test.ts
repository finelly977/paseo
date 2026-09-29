import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, onTestFinished } from "vitest";
import { readClaudeHistoryRecords } from "./history-reader.js";

describe("Claude 异步历史读取", () => {
  async function fixture(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "claude-history-reader-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    return path.join(root, "session.jsonl");
  }

  test("主文件只解析一次，完整保留嵌入和独立子轨道及其顺序", async () => {
    const file = await fixture();
    const parent = { type: "user", uuid: "u1", message: { content: "原始问题" } };
    const embedded = { type: "assistant", isSidechain: true, agentId: "child", uuid: "a1" };
    const child = { ...embedded, uuid: "a2" };
    await writeFile(file, [parent, embedded].map((record) => JSON.stringify(record)).join("\n"));
    const subdir = path.join(path.dirname(file), "session", "subagents");
    await mkdir(subdir, { recursive: true });
    await writeFile(path.join(subdir, "child.jsonl"), JSON.stringify(child));
    expect(await readClaudeHistoryRecords(file)).toEqual({
      parents: [parent],
      sidechains: [embedded, child],
    });
  });

  test("不存在的持久历史可为空，损坏的历史明确失败而不是丢弃记录", async () => {
    const file = await fixture();
    expect(await readClaudeHistoryRecords(file)).toEqual({ parents: [], sidechains: [] });
    await writeFile(file, '{"type":"user"}\n{broken}\n');
    await expect(readClaudeHistoryRecords(file)).rejects.toThrow("session.jsonl:2");
  });

  test("跨读取块的多字节正文与末尾无换行记录保持完整", async () => {
    const file = await fixture();
    const record = {
      type: "assistant",
      uuid: "long",
      message: { content: "中文🙂".repeat(16_384) },
    };
    await writeFile(file, JSON.stringify(record));
    expect(await readClaudeHistoryRecords(file)).toEqual({ parents: [record], sidechains: [] });
  });

  test("子轨道文件损坏时整次加载失败，不交付不完整子轨道", async () => {
    const file = await fixture();
    await writeFile(file, '{"type":"user","uuid":"u1"}');
    const directory = path.join(path.dirname(file), "session", "subagents");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "child.jsonl"), "{broken}\n");
    await expect(readClaudeHistoryRecords(file)).rejects.toThrow("child.jsonl:1");
  });

  test("长历史解析期间让出事件循环，不占住其他会话", async () => {
    const file = await fixture();
    await writeFile(
      file,
      Array.from({ length: 4096 }, (_, n) => JSON.stringify({ type: "user", uuid: `${n}` })).join(
        "\n",
      ),
    );
    let yielded = false;
    setImmediate(() => {
      yielded = true;
    });
    const history = await readClaudeHistoryRecords(file);
    expect(yielded).toBe(true);
    expect(history.parents).toHaveLength(4096);
    expect(history.parents.at(-1)).toEqual({ type: "user", uuid: "4095" });
  });
});
