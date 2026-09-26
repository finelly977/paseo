import { describe, expect, it } from "vitest";
import {
  closeNewWorkspaceDraftShellFileTab,
  closeNewWorkspaceDraftShellFileTabsAfter,
  closeNewWorkspaceDraftShellFileTabsBefore,
  closeNewWorkspaceDraftShellOtherFileTabs,
  createNewWorkspaceDraftShellState,
  createNewWorkspaceDraftTabDescriptor,
  focusNewWorkspaceDraftShellTab,
  openNewWorkspaceDraftShellFile,
  reorderNewWorkspaceDraftShellTabs,
  type NewWorkspaceDraftShellState,
} from "./new-workspace-draft-shell-model";

function tabIds(state: NewWorkspaceDraftShellState): string[] {
  return state.tabs.map((tab) => tab.tabId);
}

function shellWithFiles(paths: string[]): NewWorkspaceDraftShellState {
  return paths.reduce(
    (state, path) => openNewWorkspaceDraftShellFile(state, { path }),
    createNewWorkspaceDraftShellState("draft-1"),
  );
}

describe("createNewWorkspaceDraftTabDescriptor", () => {
  it("creates a closeable client-only draft tab without a workspace record", () => {
    expect(createNewWorkspaceDraftTabDescriptor("draft-1")).toEqual({
      key: "draft-1",
      tabId: "draft-1",
      kind: "draft",
      target: { kind: "draft", draftId: "draft-1" },
    });
  });

  it("rejects an empty draft id", () => {
    expect(() => createNewWorkspaceDraftTabDescriptor("  ")).toThrow(
      "新建会话草稿需要有效的草稿标识",
    );
  });
});

describe("draft shell file tabs", () => {
  it("opens files as extra tabs next to the draft instead of replacing it", () => {
    const state = shellWithFiles(["src/a.ts", "src/b.ts"]);

    expect(tabIds(state)).toEqual(["draft-1", "file_src/a.ts", "file_src/b.ts"]);
    expect(state.activeTabId).toBe("file_src/b.ts");
    expect(state.tabs[1]?.target).toEqual({ kind: "file", path: "src/a.ts" });
  });

  it("reuses an open file tab and bumps its navigation revision for a new line target", () => {
    const opened = shellWithFiles(["src/a.ts", "src/b.ts"]);
    const reopened = openNewWorkspaceDraftShellFile(opened, { path: "src/a.ts", lineStart: 12 });

    expect(tabIds(reopened)).toEqual(tabIds(opened));
    expect(reopened.activeTabId).toBe("file_src/a.ts");
    expect(reopened.tabs[1]?.target).toEqual({ kind: "file", path: "src/a.ts", lineStart: 12 });
    expect(reopened.fileNavigationRevisionByTabId["file_src/a.ts"]).toBe(1);
  });

  it("normalizes Windows separators so the same file maps to one tab", () => {
    const state = openNewWorkspaceDraftShellFile(shellWithFiles(["src/a.ts"]), {
      path: "src\\a.ts",
    });

    expect(tabIds(state)).toEqual(["draft-1", "file_src/a.ts"]);
  });

  it("rejects an empty file path", () => {
    expect(() =>
      openNewWorkspaceDraftShellFile(createNewWorkspaceDraftShellState("draft-1"), { path: " " }),
    ).toThrow("无法打开文件：文件路径为空");
  });

  it("activates the left neighbour when the active file tab closes", () => {
    const state = closeNewWorkspaceDraftShellFileTab(
      shellWithFiles(["src/a.ts", "src/b.ts"]),
      "file_src/b.ts",
    );

    expect(tabIds(state)).toEqual(["draft-1", "file_src/a.ts"]);
    expect(state.activeTabId).toBe("file_src/a.ts");
  });

  it("returns to the draft tab after closing the only file", () => {
    const state = closeNewWorkspaceDraftShellFileTab(shellWithFiles(["src/a.ts"]), "file_src/a.ts");

    expect(tabIds(state)).toEqual(["draft-1"]);
    expect(state.activeTabId).toBe("draft-1");
  });

  it("never closes the draft tab through file tab operations", () => {
    const opened = shellWithFiles(["src/a.ts", "src/b.ts", "src/c.ts"]);

    expect(tabIds(closeNewWorkspaceDraftShellFileTab(opened, "draft-1"))).toEqual(tabIds(opened));
    expect(tabIds(closeNewWorkspaceDraftShellOtherFileTabs(opened, "file_src/b.ts"))).toEqual([
      "draft-1",
      "file_src/b.ts",
    ]);
    expect(tabIds(closeNewWorkspaceDraftShellFileTabsBefore(opened, "file_src/c.ts"))).toEqual([
      "draft-1",
      "file_src/c.ts",
    ]);
    expect(tabIds(closeNewWorkspaceDraftShellFileTabsAfter(opened, "file_src/a.ts"))).toEqual([
      "draft-1",
      "file_src/a.ts",
    ]);
  });

  it("focuses the anchor tab when a bulk close removes the active tab", () => {
    const opened = shellWithFiles(["src/a.ts", "src/b.ts", "src/c.ts"]);

    const state = closeNewWorkspaceDraftShellOtherFileTabs(opened, "file_src/a.ts");

    expect(state.activeTabId).toBe("file_src/a.ts");
  });

  it("focuses only tabs that are open", () => {
    const opened = shellWithFiles(["src/a.ts"]);

    expect(focusNewWorkspaceDraftShellTab(opened, "draft-1").activeTabId).toBe("draft-1");
    expect(focusNewWorkspaceDraftShellTab(opened, "file_missing")).toBe(opened);
  });

  it("reorders tabs only as a permutation of the open tabs", () => {
    const opened = shellWithFiles(["src/a.ts"]);
    const [draftTab, fileTab] = opened.tabs;
    if (!draftTab || !fileTab) throw new Error("expected draft and file tabs");

    expect(tabIds(reorderNewWorkspaceDraftShellTabs(opened, [fileTab, draftTab]))).toEqual([
      "file_src/a.ts",
      "draft-1",
    ]);
    expect(() => reorderNewWorkspaceDraftShellTabs(opened, [fileTab])).toThrow(
      "无法调整新建会话标签顺序：新顺序缺少已打开的标签",
    );
  });
});
