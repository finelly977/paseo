import { createReadStream } from "node:fs";
import { z } from "zod";

const TitleRecord = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session_info"), name: z.string() }),
  z.object({ type: z.literal("title"), title: z.string() }),
]);

// 名称记录可能位于长历史中间；不能只看头尾窗口。只解析名称行，不构建对话历史。
export async function readJsonlSessionTitle(file: string): Promise<string | null> {
  const stream = createReadStream(file, { encoding: "utf8" });
  let title: string | null = null;
  let pending = "";
  function consume(line: string): void {
    if (!/"type"\s*:\s*"(?:session_info|title)"/u.test(line)) return;
    const value: unknown = JSON.parse(line);
    const tag = z.object({ type: z.string() }).parse(value);
    if (tag.type !== "session_info" && tag.type !== "title") return;
    const entry = TitleRecord.parse(value);
    title = entry.type === "title" ? entry.title : entry.name;
  }
  try {
    for await (const chunk of stream) {
      if (typeof chunk !== "string") throw new Error("Expected a UTF-8 session stream");
      pending += chunk;
      const end = pending.lastIndexOf("\n");
      if (end < 0) continue;
      for (const line of pending.slice(0, end).split("\n")) consume(line);
      pending = pending.slice(end + 1);
    }
    if (pending) consume(pending);
    return title;
  } finally {
    stream.destroy();
  }
}
