import type { ExplorerEntry } from "@/stores/session-store";

const DIMMED_DIRECTORY_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "__pycache__",
  "target",
  "vendor",
]);

export function isHiddenExplorerPath(path: string): boolean {
  return path
    .split("/")
    .some((segment) => segment !== "." && segment !== ".." && segment.startsWith("."));
}

/** 视觉降噪判定：点文件/目录及常见依赖与构建产物目录采用柔和对比度，突出业务源码与文档。 */
export function isDimmedExplorerEntry(entry: Pick<ExplorerEntry, "name" | "kind">): boolean {
  if (entry.name.startsWith(".")) {
    return true;
  }
  return entry.kind === "directory" && DIMMED_DIRECTORY_NAMES.has(entry.name);
}

export function filterVisibleExplorerEntries(
  entries: ExplorerEntry[],
  showHiddenFiles: boolean,
): ExplorerEntry[] {
  if (showHiddenFiles) {
    return entries;
  }
  return entries.filter((entry) => !entry.name.startsWith("."));
}
