import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import pLimit from "p-limit";

export interface ClaudeHistoryEntry {
  type?: unknown;
  subtype?: unknown;
  isCompactSummary?: unknown;
  isSidechain?: unknown;
  agentId?: unknown;
  timestamp?: unknown;
  uuid?: unknown;
  message?: { content?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}

interface ClaudeHistoryRecords {
  parents: ClaudeHistoryEntry[];
  sidechains: ClaudeHistoryEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readRecords(file: string, signal?: AbortSignal): Promise<ClaudeHistoryEntry[]> {
  const stream = createReadStream(file, { encoding: "utf8", signal });
  const records: ClaudeHistoryEntry[] = [];
  let lineNumber = 0;
  let remaining = "";
  function parseLine(line: string): void {
    lineNumber++;
    if (!line.trim()) return;
    const record: unknown = JSON.parse(line);
    if (!isRecord(record)) throw new Error("History row must be an object");
    records.push(record);
  }
  try {
    for await (const chunk of stream) {
      if (typeof chunk !== "string") throw new Error("Expected UTF-8 history stream");
      remaining += chunk;
      let start = 0;
      let end: number;
      while ((end = remaining.indexOf("\n", start)) !== -1) {
        parseLine(remaining.slice(start, end));
        start = end + 1;
        // 分批让出，避免长历史卡住整个守护进程。
        if (lineNumber % 128 === 0) await yieldToEventLoop();
      }
      remaining = remaining.slice(start);
    }
    if (remaining) parseLine(remaining);
  } catch (error) {
    throw new Error(`Failed to read Claude history ${file}:${lineNumber}`, { cause: error });
  } finally {
    stream.destroy();
  }
  return records;
}

export async function readClaudeHistoryRecords(file: string): Promise<ClaudeHistoryRecords> {
  try {
    await stat(file);
  } catch (error) {
    // 尚未产生首条原生消息的会话没有历史文件；其他 I/O 错误不能伪装成空历史。
    if (isMissingFile(error)) {
      return { parents: [], sidechains: [] };
    }
    throw error;
  }
  const parentRecords = await readRecords(file);
  const parents: ClaudeHistoryEntry[] = [];
  const sidechains: ClaudeHistoryEntry[] = [];
  for (const record of parentRecords) {
    if (record.isSidechain === true) sidechains.push(record);
    else parents.push(record);
  }
  const root = path.join(path.dirname(file), path.basename(file, ".jsonl"), "subagents");
  const directories = [root];
  const files: string[] = [];
  while (directories.length > 0) {
    const directory = directories.pop();
    if (!directory) break;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (directory === root && isMissingFile(error)) continue;
      throw error;
    }
    for (const entry of entries) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) directories.push(filename);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(filename);
    }
  }
  const limit = pLimit(4);
  const abort = new AbortController();
  const reads = files.map((filename) => limit(() => readRecords(filename, abort.signal)));
  let histories;
  try {
    histories = await Promise.all(reads);
  } catch (error) {
    abort.abort(error);
    await Promise.allSettled(reads);
    throw error;
  }
  for (const history of histories) {
    for (const entry of history) {
      if (entry.isSidechain === true && typeof entry.agentId === "string") sidechains.push(entry);
    }
  }
  return { parents, sidechains };
}
