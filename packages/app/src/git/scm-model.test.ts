import { describe, expect, test } from "vitest";

import {
  buildScmListItems,
  countScmChanges,
  getScmStatusDecoration,
  splitScmPath,
} from "@/git/scm-model";

describe("源代码管理视图模型", () => {
  test("状态字母与语义颜色保持稳定", () => {
    expect(getScmStatusDecoration("modified")).toEqual({ label: "M", tone: "modified" });
    expect(getScmStatusDecoration("renamed")).toEqual({ label: "R", tone: "modified" });
    expect(getScmStatusDecoration("untracked")).toEqual({ label: "U", tone: "untracked" });
    expect(getScmStatusDecoration("conflict")).toEqual({ label: "!", tone: "conflict" });
  });

  test("分离文件名与目录", () => {
    expect(splitScmPath("packages/app/src/main.tsx")).toEqual({
      fileName: "main.tsx",
      directory: "packages/app/src",
    });
    expect(splitScmPath("README.md")).toEqual({ fileName: "README.md", directory: "" });
  });

  test("统计各资源组的条目总数", () => {
    const changes = {
      staged: [{ path: "a.ts", status: "modified" as const }],
      unstaged: [{ path: "b.ts", status: "modified" as const }],
      conflicts: [],
    };
    expect(countScmChanges(changes)).toBe(2);
  });

  test("折叠组只保留组头，展开组保留文件顺序", () => {
    const items = buildScmListItems([
      {
        group: "staged",
        title: "已暂存的更改",
        changes: [{ path: "a.ts", status: "modified" }],
        collapsed: true,
      },
      {
        group: "unstaged",
        title: "更改",
        changes: [
          { path: "b.ts", status: "modified" },
          { path: "c.ts", status: "untracked" },
        ],
        collapsed: false,
      },
    ]);

    expect(items).toEqual([
      {
        type: "header",
        group: "staged",
        title: "已暂存的更改",
        changes: [{ path: "a.ts", status: "modified" }],
        collapsed: true,
      },
      {
        type: "header",
        group: "unstaged",
        title: "更改",
        changes: [
          { path: "b.ts", status: "modified" },
          { path: "c.ts", status: "untracked" },
        ],
        collapsed: false,
      },
      { type: "file", group: "unstaged", change: { path: "b.ts", status: "modified" } },
      { type: "file", group: "unstaged", change: { path: "c.ts", status: "untracked" } },
    ]);
  });
});
