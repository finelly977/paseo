import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PaseoConfigRaw, PaseoConfigRevision } from "@getpaseo/protocol/messages";
import { afterEach, expect, test } from "vitest";
import { migrate } from "./migrate.js";
import { createConductorSource } from "./sources/conductor/index.js";
import type { MigrationEvent, PaseoMigrationPort } from "./types.js";
import { openFixtureDatabase, saveFixtureDatabase } from "./sources/conductor/sqlite.fixture.js";

const cleanup: string[] = [];

afterEach(() => {
  for (const target of cleanup.splice(0)) rmSync(target, { recursive: true, force: true });
});

test("imports real catalog, config, and Git worktree shapes through observable Paseo state", async () => {
  const fixture = await createInstallationFixture();
  const paseo = new InMemoryPaseo({
    [fixture.repo]: {
      worktree: { setup: "keep existing setup" },
      scripts: { dev: { command: "keep existing dev" } },
    },
  });
  const events: MigrationEvent[] = [];

  const result = await migrate({
    source: createConductorSource({ databasePath: fixture.databasePath, platform: "win32" }),
    paseo,
    dryRun: false,
    output: (event) => events.push(event),
  });

  expect([...paseo.projects]).toEqual([fixture.repo]);
  expect(paseo.configs.get(fixture.repo)).toEqual({
    worktree: { setup: "keep existing setup", teardown: "npm run cleanup" },
    scripts: {
      dev: { command: "keep existing dev" },
      test: { command: "npm test" },
      "db-run": { command: "npm run db" },
    },
    metadataGeneration: {
      branchName: { instructions: "Name a branch" },
      title: { instructions: "Write a concise task title" },
    },
  });
  expect(paseo.openedCheckouts).toEqual([fixture.liveWorktree]);
  expect(paseo.configs.get(fixture.liveWorktree)).toEqual(paseo.configs.get(fixture.repo));
  expect(paseo.createdCheckouts).toEqual([
    { rootPath: fixture.repo, refName: "create-branch", directoryName: "missing-create" },
  ]);
  expect(result.notices.map((notice) => notice.code)).toEqual(
    expect.arrayContaining([
      "hidden-project",
      "invalid-project",
      "recoverable-from-commit",
      "missing-workspace-ref",
      "archived-workspace",
    ]),
  );
  expect(result.inventory.projects[0]?.config?.worktree?.setup).not.toContain("never-read");
  expect(events.map((event) => event.message).join("\n")).not.toContain("never-read");
  expect(events.map((event) => event.message)).toEqual(
    expect.arrayContaining([
      `Registered project ${fixture.repo}.`,
      `Updated project config for ${fixture.repo}.`,
      `Adopted worktree ${fixture.liveWorktree}.`,
      expect.stringMatching(/^Recreated worktree .+ from create-branch\.$/),
      expect.stringMatching(/^Migration summary:/),
    ]),
  );

  const secondEvents: MigrationEvent[] = [];
  const second = await migrate({
    source: createConductorSource({ databasePath: fixture.databasePath }),
    paseo,
    dryRun: false,
    output: (event) => secondEvents.push(event),
  });
  expect(second.notices.some((notice) => notice.code === "project-apply-failed")).toBe(false);
  expect(paseo.configWrites).toBe(2);
  expect(secondEvents.map((event) => event.message)).toContain(
    `Worktree ${path.join(fixture.repo, ".paseo", "missing-create")} already exists for create-branch.`,
  );
});

test("reports a revision-stale config write without retrying or replacing existing values", async () => {
  const fixture = await createInstallationFixture();
  const paseo = new InMemoryPaseo({ [fixture.repo]: {} });
  paseo.rejectWrites = true;

  const result = await migrate({
    source: createConductorSource({ databasePath: fixture.databasePath }),
    paseo,
    dryRun: false,
    output: () => undefined,
  });

  expect(paseo.configWrites).toBe(2);
  expect(paseo.configs.get(fixture.repo)).toEqual({});
  expect(paseo.openedCheckouts).toEqual([fixture.liveWorktree]);
  expect(paseo.createdCheckouts).toEqual([
    { rootPath: fixture.repo, refName: "create-branch", directoryName: "missing-create" },
  ]);
  expect(result.notices).toContainEqual({
    code: "project-config-apply-failed",
    level: "error",
    message: `${fixture.repo}: stale_project_config`,
  });
});

class InMemoryPaseo implements PaseoMigrationPort {
  readonly projects = new Set<string>();
  readonly configs = new Map<string, PaseoConfigRaw>();
  readonly openedCheckouts: string[] = [];
  readonly createdCheckouts: Array<{
    rootPath: string;
    refName: string;
    directoryName: string;
  }> = [];
  configWrites = 0;
  rejectWrites = false;

  constructor(configs: Record<string, PaseoConfigRaw>) {
    for (const [rootPath, config] of Object.entries(configs)) this.configs.set(rootPath, config);
  }

  async addProject(rootPath: string): Promise<void> {
    this.projects.add(rootPath);
  }

  async openCheckout(checkoutPath: string): Promise<void> {
    if (!this.openedCheckouts.includes(checkoutPath)) this.openedCheckouts.push(checkoutPath);
  }

  async readProjectConfig(rootPath: string): Promise<{
    config: PaseoConfigRaw | null;
    revision: PaseoConfigRevision | null;
  }> {
    return { config: this.configs.get(rootPath) ?? null, revision: { mtimeMs: 1, size: 1 } };
  }

  async writeProjectConfig(input: {
    rootPath: string;
    config: PaseoConfigRaw;
    expectedRevision: PaseoConfigRevision | null;
  }): Promise<void> {
    this.configWrites += 1;
    if (this.rejectWrites) throw new Error("stale_project_config");
    this.configs.set(input.rootPath, input.config);
  }

  async ensureCheckout(input: {
    rootPath: string;
    refName: string;
    directoryName: string;
  }): Promise<{ path: string; created: boolean }> {
    const existing = this.createdCheckouts.find(
      (checkout) =>
        checkout.refName === input.refName && checkout.directoryName === input.directoryName,
    );
    if (existing) {
      return { path: path.join(input.rootPath, ".paseo", input.directoryName), created: false };
    }
    this.createdCheckouts.push(input);
    return { path: path.join(input.rootPath, ".paseo", input.directoryName), created: true };
  }
}

async function createInstallationFixture(): Promise<{
  databasePath: string;
  repo: string;
  liveWorktree: string;
}> {
  const directory = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "paseo-conductor-installation-")),
  );
  cleanup.push(directory);
  const repo = path.join(directory, "repo");
  const liveWorktree = path.join(directory, "live-worktree");
  execFileSync("git", ["init", "-b", "main", repo]);
  execFileSync("git", ["config", "user.email", "fixture@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: repo });
  writeFileSync(path.join(repo, "README.md"), "fixture\n");
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"], { cwd: repo });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  execFileSync("git", ["branch", "live-branch"], { cwd: repo });
  execFileSync("git", ["branch", "create-branch"], { cwd: repo });
  execFileSync("git", ["worktree", "add", liveWorktree, "live-branch"], { cwd: repo });
  writeFileSync(path.join(liveWorktree, "dirty.txt"), "uncommitted fixture change\n");
  cpSync(fixturePath("current/.conductor"), path.join(repo, ".conductor"), {
    recursive: true,
  });

  const databasePath = path.join(directory, "conductor.db");
  cpSync(fixturePath("conductor.db"), databasePath);
  const database = await openFixtureDatabase(databasePath);
  database.run("UPDATE repos SET root_path = ? WHERE id = 'repo-current'", [repo]);
  database.run("UPDATE workspaces SET path = ? WHERE id = 'ready-live'", [liveWorktree]);
  database.run("UPDATE workspaces SET archive_commit = ? WHERE id = 'recoverable'", [commit]);
  saveFixtureDatabase(databasePath, database);

  expect(existsSync(liveWorktree)).toBe(true);
  return { databasePath, repo: realpathSync(repo), liveWorktree: realpathSync(liveWorktree) };
}

function fixturePath(relativePath: string): string {
  return fileURLToPath(new URL(`../fixtures/conductor/${relativePath}`, import.meta.url));
}
