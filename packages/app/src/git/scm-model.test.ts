import { describe, expect, test } from "vitest";

import { countScmChanges, getScmStatusDecoration, splitScmPath } from "@/git/scm-model";

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
});
