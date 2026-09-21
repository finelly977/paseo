import type { ExplorerDirectory } from "@/stores/session-store";
import { isHiddenExplorerPath } from "./visibility";

interface RefreshExplorerDirectoriesInput {
  directoryPaths: ReadonlySet<string>;
  showHiddenFiles: boolean;
  shouldContinue: () => boolean;
  requestDirectoryListing: (path: string) => Promise<ExplorerDirectory | null>;
}

interface RefreshExplorerDirectoriesResult {
  missingPaths: string[];
}

export async function refreshExplorerDirectories({
  directoryPaths: requestedDirectoryPaths,
  showHiddenFiles,
  shouldContinue,
  requestDirectoryListing,
}: RefreshExplorerDirectoriesInput): Promise<RefreshExplorerDirectoriesResult> {
  if (!shouldContinue()) return { missingPaths: [] };
  const directoryPaths = Array.from(requestedDirectoryPaths).filter(
    (path) => showHiddenFiles || !isHiddenExplorerPath(path),
  );
  if (!directoryPaths.includes(".")) directoryPaths.unshift(".");
  directoryPaths.sort((left, right) => explorerPathDepth(left) - explorerPathDepth(right));

  const refreshedDirectories = new Map<string, ExplorerDirectory>();
  const missingPaths = new Set<string>();
  const root = await requestDirectoryListing(".");
  if (!root || !shouldContinue()) return { missingPaths: [] };
  refreshedDirectories.set(".", root);

  const maximumDepth = directoryPaths.reduce(
    (depth, path) => Math.max(depth, explorerPathDepth(path)),
    0,
  );
  for (let depth = 1; depth <= maximumDepth; depth += 1) {
    if (!shouldContinue()) return { missingPaths: Array.from(missingPaths) };
    const pathsAtDepth = directoryPaths.filter((path) => explorerPathDepth(path) === depth);
    const visiblePaths = pathsAtDepth.filter((path) => {
      const parent = refreshedDirectories.get(explorerParentPath(path));
      if (!parent) return false;
      const stillExists = parent.entries.some(
        (entry) => entry.kind === "directory" && entry.path === path,
      );
      if (!stillExists) missingPaths.add(path);
      return stillExists;
    });
    const refreshed = await Promise.all(visiblePaths.map(requestDirectoryListing));
    if (!shouldContinue()) return { missingPaths: Array.from(missingPaths) };
    for (let index = 0; index < visiblePaths.length; index += 1) {
      const directory = refreshed[index];
      if (directory) refreshedDirectories.set(visiblePaths[index], directory);
    }
  }

  return { missingPaths: Array.from(missingPaths) };
}

export function collectExplorerRefreshPaths({
  expandedPaths,
  cachedDirectoryPaths,
  changedPaths,
  refreshAllKnownDirectories,
}: {
  expandedPaths: ReadonlySet<string>;
  cachedDirectoryPaths: ReadonlySet<string>;
  changedPaths?: readonly string[];
  refreshAllKnownDirectories?: boolean;
}): ReadonlySet<string> {
  const knownDirectoryPaths = new Set([...expandedPaths, ...cachedDirectoryPaths]);
  const refreshPaths = new Set<string>();

  if (refreshAllKnownDirectories || !changedPaths || changedPaths.length === 0) {
    for (const path of knownDirectoryPaths) {
      addExplorerPathWithAncestors(refreshPaths, path);
    }
  }

  if (changedPaths) {
    for (const changedPath of changedPaths) {
      const normalizedPath = normalizeExplorerPath(changedPath);
      addExplorerPathWithAncestors(refreshPaths, explorerParentPath(normalizedPath));
      if (knownDirectoryPaths.has(normalizedPath)) {
        addExplorerPathWithAncestors(refreshPaths, normalizedPath);
      }
    }
  }

  addExplorerPathWithAncestors(refreshPaths, ".");
  return new Set(
    Array.from(refreshPaths).sort((left, right) => {
      const depthDifference = explorerPathDepth(left) - explorerPathDepth(right);
      return depthDifference === 0 ? left.localeCompare(right) : depthDifference;
    }),
  );
}

function addExplorerPathWithAncestors(paths: Set<string>, path: string): void {
  const pending: string[] = [];
  let currentPath = path;
  while (!paths.has(currentPath)) {
    pending.push(currentPath);
    if (currentPath === ".") break;
    currentPath = explorerParentPath(currentPath);
  }
  for (const ancestor of pending.toReversed()) paths.add(ancestor);
}

function normalizeExplorerPath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  return normalized.length === 0 ? "." : normalized;
}

function explorerPathDepth(path: string): number {
  return path === "." ? 0 : path.split("/").length;
}

function explorerParentPath(path: string): string {
  const separatorIndex = path.lastIndexOf("/");
  return separatorIndex === -1 ? "." : path.slice(0, separatorIndex);
}
