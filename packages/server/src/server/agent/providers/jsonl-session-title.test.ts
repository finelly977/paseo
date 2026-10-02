import { expect, test } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readJsonlSessionTitle } from "./jsonl-session-title.js";

test("名称位于长历史中间时仍读取最新原生名称", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jsonl-title-"));
  const file = path.join(root, "session.jsonl");
  const padding = JSON.stringify({ type: "message", text: "x".repeat(300_000) });
  try {
    await writeFile(
      file,
      [
        JSON.stringify({ type: "session_info", name: "旧名" }),
        padding,
        JSON.stringify({ type: "session_info", name: "最新名称" }),
        padding,
      ].join("\n"),
    );
    expect(await readJsonlSessionTitle(file)).toBe("最新名称");
    await expect(readJsonlSessionTitle(path.join(root, "missing.jsonl"))).rejects.toThrow("ENOENT");
    await writeFile(file, '{"type":"session_info","name":123}\n');
    await expect(readJsonlSessionTitle(file)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
