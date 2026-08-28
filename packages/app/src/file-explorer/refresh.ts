import type { ExplorerDirectory } from "@/stores/session-store";
import { isHiddenExplorerPath } from "./visibility";

interface RefreshExplorerDirectoriesInput {
  expandedPaths: ReadonlySet<string>;
  showHiddenFiles: boolean;
  requestDirectoryListing: (path: string) => Promise<ExplorerDirectory | null>;
}

interface RefreshExplorerDirectoriesResult {
  missingPaths: string[];
}

export async function refreshExplorerDirectories({
  expandedPaths,
  showHiddenFiles,
  requestDirectoryListing,
}: RefreshExplorerDirectoriesInput): Promise<RefreshExplorerDirectoriesResult> {
  const directoryPaths = Array.from(expandedPaths).filter(
    (path) => showHiddenFiles || !isHiddenExplorerPath(path),
  );
  if (!directoryPaths.includes(".")) directoryPaths.unshift(".");
  directoryPaths.sort((left, right) => explorerPathDepth(left) - explorerPathDepth(right));

  const refreshedDirectories = new Map<string, ExplorerDirectory>();
  const missingPaths = new Set<string>();
  const root = await requestDirectoryListing(".");
  if (!root) return { missingPaths: [] };
  refreshedDirectories.set(".", root);

  const maximumDepth = directoryPaths.reduce(
    (depth, path) => Math.max(depth, explorerPathDepth(path)),
    0,
  );
  for (let depth = 1; depth <= maximumDepth; depth += 1) {
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
    for (let index = 0; index < visiblePaths.length; index += 1) {
      const directory = refreshed[index];
      if (directory) refreshedDirectories.set(visiblePaths[index], directory);
    }
  }

  return { missingPaths: Array.from(missingPaths) };
}

function explorerPathDepth(path: string): number {
  return path === "." ? 0 : path.split("/").length;
}

function explorerParentPath(path: string): string {
  const separatorIndex = path.lastIndexOf("/");
  return separatorIndex === -1 ? "." : path.slice(0, separatorIndex);
}
