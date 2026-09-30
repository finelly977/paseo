import { describe, expect, test } from "vitest";
import type { ExplorerEntry } from "@/stores/session-store";
import {
  buildEntryMutation,
  explorerCreateParent,
  explorerRowsWithDraft,
  renameNameSelection,
} from "./entry-edit";

const file: ExplorerEntry = {
  path: "src/main.ts",
  name: "main.ts",
  kind: "file",
  size: 20,
  modifiedAt: "2026-09-30T00:00:00.000Z",
};
const folder: ExplorerEntry = { ...file, name: "src", path: "src", kind: "directory", size: 0 };

describe("文件树行内操作", () => {
  test("新建行位于目标目录下面，不挤到面板顶部", () => {
    const rows = [
      { entry: folder, depth: 0 },
      { entry: file, depth: 1 },
    ];
    expect(
      explorerRowsWithDraft(rows, {
        action: { operation: "create", parent: "src", kind: "file" },
        name: "",
        error: null,
      }),
    ).toEqual([rows[0], { draftParent: "src", depth: 1 }, rows[1]]);
    expect(
      explorerRowsWithDraft([], {
        action: { operation: "create", parent: ".", kind: "file" },
        name: "",
        error: null,
      }),
    ).toEqual([{ draftParent: ".", depth: 0 }]);
    expect(explorerRowsWithDraft(rows, null)).toBe(rows);
  });
  test("工具栏在选中文件的父目录或选中目录中新建", () => {
    expect(explorerCreateParent(file)).toBe("src");
    expect(explorerCreateParent(folder)).toBe("src");
    expect(explorerCreateParent(undefined)).toBe(".");
    expect(explorerCreateParent({ ...file, path: "main.ts" })).toBe(".");
  });
  test("重命名优先选中文件名，保留扩展名，隐藏文件全选", () => {
    expect(renameNameSelection("main.ts")).toEqual({ start: 0, end: 4 });
    expect(renameNameSelection(".env")).toEqual({ start: 0, end: 4 });
    expect(renameNameSelection("folder")).toEqual({ start: 0, end: 6 });
  });
  test("行内输入生成准确路径，并保留重命名和删除冲突校验", () => {
    expect(
      buildEntryMutation({
        action: { operation: "create", parent: "src", kind: "file" },
        name: "new.ts",
        error: null,
      }),
    ).toEqual({ operation: "create", path: "src/new.ts", kind: "file" });
    expect(
      buildEntryMutation({
        action: { operation: "rename", entry: file },
        name: "next.ts",
        error: null,
      }),
    ).toEqual({
      operation: "rename",
      path: file.path,
      name: "next.ts",
      expectedModifiedAt: file.modifiedAt,
    });
    expect(
      buildEntryMutation({ action: { operation: "delete", entry: file }, name: "", error: null }),
    ).toEqual({ operation: "delete", path: file.path, expectedModifiedAt: file.modifiedAt });
  });
  test.each(["", ".", "..", "a/b", "a\\b", "a\0b"])("拒绝非法名称 %s", (name) => {
    expect(() =>
      buildEntryMutation({
        action: { operation: "create", parent: ".", kind: "file" },
        name,
        error: null,
      }),
    ).toThrow("请输入不含路径分隔符的名称");
  });
});
