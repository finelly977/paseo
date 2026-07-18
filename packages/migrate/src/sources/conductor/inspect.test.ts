import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import type { ConductorCatalog } from "./database.js";
import { inspectCatalog } from "./inspect.js";

const cleanup: string[] = [];

afterEach(() => {
  for (const target of cleanup.splice(0)) rmSync(target, { recursive: true, force: true });
});

test("isolates malformed config and preserves valid projects", () => {
  const malformed = createRepository("malformed", "[scripts\ninvalid");
  const valid = createRepository("valid", '[scripts]\nsetup = "npm ci"\n');
  const catalog: ConductorCatalog = {
    repos: [repoRecord("malformed", malformed), repoRecord("valid", valid)],
    workspaces: [],
  };

  const inspected = inspectCatalog(catalog);

  expect(inspected.projects.map((project) => project.rootPath)).toEqual([malformed, valid]);
  expect(inspected.projects[0]?.config).toBeNull();
  expect(inspected.projects[0]?.notices).toEqual([
    {
      code: "malformed-project-config",
      level: "warning",
      message: `Skipped project config for ${malformed}: unable to read or parse .conductor/settings.toml.`,
    },
  ]);
  expect(inspected.projects[1]?.config).toEqual({ worktree: { setup: "npm ci" } });
});

test("isolates unreadable config and reports its exact source path", () => {
  const unreadable = createRepository("unreadable", null);
  mkdirSync(path.join(unreadable, ".conductor", "settings.toml"), { recursive: true });

  const inspected = inspectCatalog({
    repos: [repoRecord("unreadable", unreadable)],
    workspaces: [],
  });

  expect(inspected.projects[0]?.config).toBeNull();
  expect(inspected.projects[0]?.notices).toEqual([
    {
      code: "malformed-project-config",
      level: "warning",
      message: `Skipped project config for ${unreadable}: unable to read or parse .conductor/settings.toml.`,
    },
  ]);
});

test("reports an unknown workspace state by its exact value", () => {
  const repo = createRepository("unknown-state", null);
  const inspected = inspectCatalog({
    repos: [repoRecord("repo", repo)],
    workspaces: [
      {
        id: "workspace-paused",
        repoId: "repo",
        branch: "main",
        state: "paused",
        path: null,
        archiveCommit: null,
      },
    ],
  });

  expect(inspected.projects[0]?.workspaces[0]).toMatchObject({
    sourceId: "workspace-paused",
    state: "paused",
    disposition: "invalid",
    notices: [
      {
        code: "unknown-workspace-state",
        level: "warning",
        message: 'Skipped workspace workspace-paused: unsupported state "paused".',
      },
    ],
  });
});

test("does not adopt an existing worktree on a different branch", () => {
  const repo = createRepository("wrong-worktree-branch", null);
  execFileSync("git", ["commit", "--allow-empty", "-m", "initial"], {
    cwd: repo,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Paseo Test",
      GIT_AUTHOR_EMAIL: "test@paseo.local",
      GIT_COMMITTER_NAME: "Paseo Test",
      GIT_COMMITTER_EMAIL: "test@paseo.local",
    },
  });
  execFileSync("git", ["branch", "recorded-branch"], { cwd: repo });

  const inspected = inspectCatalog({
    repos: [repoRecord("repo", repo)],
    workspaces: [
      {
        id: "workspace-wrong-branch",
        repoId: "repo",
        branch: "recorded-branch",
        state: "ready",
        path: repo,
        archiveCommit: null,
      },
    ],
  });

  expect(inspected.projects[0]?.workspaces[0]).toMatchObject({
    sourceId: "workspace-wrong-branch",
    disposition: "invalid",
    notices: [{ code: "invalid-worktree" }],
  });
});

function createRepository(name: string, settings: string | null): string {
  const repo = mkdtempSync(path.join(os.tmpdir(), `paseo-inspect-${name}-`));
  cleanup.push(repo);
  execFileSync("git", ["init", "-b", "main"], { cwd: repo });
  if (settings !== null) {
    mkdirSync(path.join(repo, ".conductor"), { recursive: true });
    writeFileSync(path.join(repo, ".conductor", "settings.toml"), settings);
  }
  return realpathSync(repo);
}

function repoRecord(id: string, rootPath: string) {
  return {
    id,
    rootPath,
    name: id,
    hidden: false,
    databaseSettings: {},
    notices: [],
  };
}
