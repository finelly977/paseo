import { describe, expect, test, vi } from "vitest";
import type { ExplorerDirectory } from "@/stores/session-store";
import { refreshExplorerDirectories } from "./refresh";

function directory(path: string, childDirectories: string[]): ExplorerDirectory {
  return {
    path,
    entries: childDirectories.map((childPath) => ({
      name: childPath.slice(childPath.lastIndexOf("/") + 1),
      path: childPath,
      kind: "directory",
      size: 0,
      modifiedAt: "2026-08-23T00:00:00.000Z",
    })),
  };
}

describe("文件面板目录刷新", () => {
  test("重新读取仍存在的展开目录并移除已删除或重命名的旧路径", async () => {
    const directories = new Map<string, ExplorerDirectory>([
      [".", directory(".", ["src"])],
      ["src", directory("src", ["src/live", "src/renamed-new"])],
      ["src/live", directory("src/live", [])],
    ]);
    const requestDirectoryListing = vi.fn(async (path: string) => directories.get(path) ?? null);

    const result = await refreshExplorerDirectories({
      expandedPaths: new Set([
        ".",
        "src",
        "src/live",
        "src/deleted",
        "src/renamed-old",
        "src/deleted/nested",
      ]),
      showHiddenFiles: true,
      shouldContinue: () => true,
      requestDirectoryListing,
    });

    expect(requestDirectoryListing.mock.calls.map(([path]) => path)).toEqual([
      ".",
      "src",
      "src/live",
    ]);
    expect(result).toEqual({ missingPaths: ["src/deleted", "src/renamed-old"] });
  });

  test("隐藏文件关闭时不会重新读取隐藏目录", async () => {
    const requestDirectoryListing = vi.fn(async (path: string) => {
      if (path === ".") return directory(".", ["src", ".git"]);
      if (path === "src") return directory("src", []);
      throw new Error(`不应读取隐藏目录：${path}`);
    });

    await refreshExplorerDirectories({
      expandedPaths: new Set([".", "src", ".git"]),
      showHiddenFiles: false,
      shouldContinue: () => true,
      requestDirectoryListing,
    });

    expect(requestDirectoryListing.mock.calls.map(([path]) => path)).toEqual([".", "src"]);
  });

  test("订阅在根目录返回后失效时不会继续读取展开目录", async () => {
    let current = true;
    const requestDirectoryListing = vi.fn(async (path: string) => {
      current = false;
      return directory(path, path === "." ? ["src"] : []);
    });

    const result = await refreshExplorerDirectories({
      expandedPaths: new Set([".", "src"]),
      showHiddenFiles: true,
      shouldContinue: () => current,
      requestDirectoryListing,
    });

    expect(requestDirectoryListing.mock.calls.map(([path]) => path)).toEqual(["."]);
    expect(result).toEqual({ missingPaths: [] });
  });
});
