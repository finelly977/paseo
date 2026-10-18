import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { createTestLogger } from "../test-utils/test-logger.js";
import { WorkspaceGitServiceImpl } from "./workspace-git-service.js";

test.each([
  { observeBeforeSwitch: true, worktree: false },
  { observeBeforeSwitch: false, worktree: false },
  { observeBeforeSwitch: true, worktree: true },
  { observeBeforeSwitch: false, worktree: true },
])(
  "外部切换同一提交分支后自动刷新（已有观察：$observeBeforeSwitch，独立工作树：$worktree）",
  async ({ observeBeforeSwitch, worktree }) => {
    const root = await mkdtemp(join(tmpdir(), "paseo-branch-refresh-"));
    const repo = join(root, "repo");
    await mkdir(repo);
    let cwd = repo;
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
    let service: WorkspaceGitServiceImpl | null = null;
    try {
      git("init", "-b", "main");
      git("config", "user.name", "分支刷新测试");
      git("config", "user.email", "branch-refresh@example.invalid");
      await writeFile(join(repo, "tracked.txt"), "两个分支的文件完全相同\n");
      git("add", "tracked.txt");
      git("-c", "commit.gpgsign=false", "commit", "-m", "初始提交");
      git("branch", "other");
      if (worktree) {
        const linked = join(root, "linked");
        git("worktree", "add", "-b", "linked", linked);
        cwd = linked;
      }
      const originalBranch = worktree ? "linked" : "main";
      service = new WorkspaceGitServiceImpl({
        logger: createTestLogger(),
        paseoHome: join(root, "home"),
      });
      const observed: (string | null | undefined)[] = [];
      const observe = () => {
        if (!service) throw new Error("Git 服务未创建");
        service.registerWorkspace({ cwd }, (snapshot) => observed.push(snapshot.git.currentBranch));
      };
      if (observeBeforeSwitch) observe();
      expect((await service.getSnapshot(cwd, { includeForge: false })).git.currentBranch).toBe(
        originalBranch,
      );
      const active = service;
      await vi.waitFor(
        () => expect(active.getMetrics().workspaceObservationSetupInFlightCount).toBe(0),
        { timeout: 5000, interval: 20 },
      );
      git("switch", "other");
      expect(git("branch", "--show-current")).toBe("other");
      if (!observeBeforeSwitch) observe();
      await vi.waitFor(() => expect(observed).toContain("other"), { timeout: 7000, interval: 50 });
      git("switch", originalBranch);
      await vi.waitFor(() => expect(observed[observed.length - 1]).toBe(originalBranch), {
        timeout: 7000,
        interval: 50,
      });
    } finally {
      if (service) await service.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
  25_000,
);
