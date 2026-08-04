import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  discardCheckoutWorkingTreePaths,
  getCheckoutStatus,
  parseCheckoutScmChanges,
  stageCheckoutPaths,
  unstageCheckoutPaths,
} from "./checkout-git.js";

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd }).toString();
}

describe("源代码管理 Git 操作", () => {
  let tempDirectory: string;
  let repositoryDirectory: string;

  beforeEach(() => {
    tempDirectory = mkdtempSync(join(tmpdir(), "paseo-checkout-scm-"));
    repositoryDirectory = join(tempDirectory, "repo");
    runGit(tempDirectory, ["init", "-b", "main", repositoryDirectory]);
    runGit(repositoryDirectory, ["config", "user.email", "test@example.com"]);
    runGit(repositoryDirectory, ["config", "user.name", "测试用户"]);
    writeFileSync(join(repositoryDirectory, "tracked.txt"), "初始内容\n");
    writeFileSync(join(repositoryDirectory, "old-name.txt"), "旧文件\n");
    runGit(repositoryDirectory, ["add", "."]);
    runGit(repositoryDirectory, ["-c", "commit.gpgsign=false", "commit", "-m", "初始提交"]);
  });

  afterEach(() => {
    rmSync(tempDirectory, { recursive: true, force: true });
  });

  test("一次状态读取区分暂存、未暂存、未跟踪和重命名文件", async () => {
    writeFileSync(join(repositoryDirectory, "tracked.txt"), "暂存内容\n");
    runGit(repositoryDirectory, ["add", "tracked.txt"]);
    writeFileSync(join(repositoryDirectory, "tracked.txt"), "工作区内容\n");
    writeFileSync(join(repositoryDirectory, "untracked.txt"), "新文件\n");
    runGit(repositoryDirectory, ["mv", "old-name.txt", "new-name.txt"]);

    const status = await getCheckoutStatus(repositoryDirectory);

    expect(status).toMatchObject({
      isGit: true,
      isDirty: true,
      stagedFileCount: 2,
      changes: {
        staged: [
          { path: "new-name.txt", originalPath: "old-name.txt", status: "renamed" },
          { path: "tracked.txt", status: "modified" },
        ],
        unstaged: [
          { path: "tracked.txt", status: "modified" },
          { path: "untracked.txt", status: "untracked" },
        ],
        conflicts: [],
      },
    });
  });

  test("解析冲突状态记录", () => {
    expect(parseCheckoutScmChanges("UU conflict.txt\x00")).toEqual({
      staged: [],
      unstaged: [],
      conflicts: [{ path: "conflict.txt", status: "conflict" }],
    });
  });

  test("解析工作区复制状态记录", () => {
    expect(parseCheckoutScmChanges(" C copied.txt\x00original.txt\x00")).toEqual({
      staged: [],
      unstaged: [{ path: "copied.txt", originalPath: "original.txt", status: "copied" }],
      conflicts: [],
    });
  });

  test("暂存、取消暂存和放弃更改保持工作区结果准确", async () => {
    writeFileSync(join(repositoryDirectory, "tracked.txt"), "修改内容\n");
    writeFileSync(join(repositoryDirectory, "untracked.txt"), "新文件\n");

    await stageCheckoutPaths(repositoryDirectory, ["tracked.txt", "untracked.txt"]);
    let status = await getCheckoutStatus(repositoryDirectory);
    expect(status.isGit && status.changes.staged).toEqual([
      { path: "tracked.txt", status: "modified" },
      { path: "untracked.txt", status: "added" },
    ]);

    await unstageCheckoutPaths(repositoryDirectory, ["tracked.txt", "untracked.txt"]);
    status = await getCheckoutStatus(repositoryDirectory);
    expect(status.isGit && status.changes.unstaged).toEqual([
      { path: "tracked.txt", status: "modified" },
      { path: "untracked.txt", status: "untracked" },
    ]);

    await discardCheckoutWorkingTreePaths(repositoryDirectory, ["tracked.txt", "untracked.txt"]);
    expect(
      readFileSync(join(repositoryDirectory, "tracked.txt"), "utf8").replaceAll("\r\n", "\n"),
    ).toBe("初始内容\n");
    expect(existsSync(join(repositoryDirectory, "untracked.txt"))).toBe(false);
    await expect(getCheckoutStatus(repositoryDirectory)).resolves.toMatchObject({
      isGit: true,
      isDirty: false,
    });
  });

  test("无初始提交时仍可取消暂存", async () => {
    const unbornDirectory = join(tempDirectory, "unborn");
    runGit(tempDirectory, ["init", "-b", "main", unbornDirectory]);
    writeFileSync(join(unbornDirectory, "first.txt"), "首个文件\n");
    await stageCheckoutPaths(unbornDirectory, ["first.txt"]);

    await unstageCheckoutPaths(unbornDirectory, ["first.txt"]);

    expect(runGit(unbornDirectory, ["ls-files"]).trim()).toBe("");
    expect(existsSync(join(unbornDirectory, "first.txt"))).toBe(true);
  });

  test("拒绝仓库外路径", async () => {
    await expect(stageCheckoutPaths(repositoryDirectory, ["../outside.txt"])).rejects.toThrow(
      "文件路径不属于当前仓库",
    );
    await expect(stageCheckoutPaths(repositoryDirectory, ["."])).rejects.toThrow(
      "文件路径不属于当前仓库",
    );
    await expect(stageCheckoutPaths(repositoryDirectory, ["./tracked.txt"])).rejects.toThrow(
      "文件路径不属于当前仓库",
    );
  });
});
