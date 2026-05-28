import path from "node:path";
import fs from "node:fs/promises";
import type { AgentTimelineItem, ToolCallTimelineItem } from "./agent-sdk-types.js";

const PLAN_FILE_EXTENSIONS = new Set([".md", ".markdown"]);
const PLAN_DIRECTORIES = new Set([
  `${path.sep}.paseo${path.sep}plans${path.sep}`,
  `${path.sep}.opencode${path.sep}plans${path.sep}`,
]);

export function isPlanFilePath(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  const ext = path.extname(normalized).toLowerCase();
  if (!PLAN_FILE_EXTENSIONS.has(ext)) {
    return false;
  }
  const searchable = normalized.startsWith(path.sep) ? normalized : `${path.sep}${normalized}`;
  return Array.from(PLAN_DIRECTORIES).some((dir) => searchable.includes(dir));
}

export async function planItemFromToolCall(params: {
  item: ToolCallTimelineItem;
  cwd: string;
  homeDir: string;
}): Promise<AgentTimelineItem | null> {
  const { item, cwd, homeDir } = params;
  if (item.status !== "completed") {
    return null;
  }
  const detail = item.detail;
  if (detail.type !== "write" && detail.type !== "edit") {
    return null;
  }
  if (!isPlanFilePath(detail.filePath)) {
    return null;
  }

  const explicitContent = detail.type === "write" ? detail.content : undefined;
  const text = explicitContent ?? (await readPlanFile(detail.filePath, cwd, homeDir));
  if (!text?.trim()) {
    return null;
  }

  return {
    type: "plan",
    planId: `plan-file:${path.normalize(detail.filePath)}`,
    text: text.trim(),
  };
}

async function readPlanFile(
  filePath: string,
  cwd: string,
  homeDir: string,
): Promise<string | null> {
  const candidates = path.isAbsolute(filePath)
    ? [filePath]
    : [path.resolve(cwd, filePath), path.resolve(homeDir, filePath)];

  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, "utf8");
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}
