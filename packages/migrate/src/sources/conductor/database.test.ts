import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { readConductorCatalog, UnsupportedConductorDatabaseError } from "./database.js";
import { openFixtureDatabase, saveFixtureDatabase } from "./sqlite.fixture.js";

const fixturePath = fileURLToPath(
  new URL("../../../fixtures/conductor/conductor.db", import.meta.url),
);
const cleanup: string[] = [];

afterEach(() => {
  for (const target of cleanup.splice(0)) rmSync(target, { recursive: true, force: true });
});

test("reads the sanitized current catalog without selecting sensitive columns", async () => {
  const catalog = await readConductorCatalog(fixturePath);

  expect(catalog.repos.map((repo) => repo.rootPath)).toEqual([
    "/fixture/repo-current",
    "/fixture/repo-hidden",
    "C:\\Users\\fixture\\project",
  ]);
  expect(catalog.workspaces.map((workspace) => workspace.state)).toEqual([
    "ready",
    "ready",
    "ready",
    "ready",
    "archived",
  ]);
  expect(Object.keys(catalog.repos[0] ?? {}).sort()).toEqual([
    "databaseSettings",
    "hidden",
    "id",
    "name",
    "notices",
    "rootPath",
  ]);
});

test("accepts the current schema when optional project-config columns are absent", async () => {
  const databasePath = temporaryDatabase();
  const database = await openFixtureDatabase();
  database.run(`
    PRAGMA user_version = 112;
    CREATE TABLE repos (id TEXT, root_path TEXT, name TEXT, is_hidden INTEGER);
    CREATE TABLE workspaces (id TEXT, repo_id TEXT, branch TEXT, state TEXT, path TEXT, archive_commit TEXT);
    INSERT INTO repos VALUES ('repo', '/tmp/repo', 'Repo', 0);
  `);
  saveFixtureDatabase(databasePath, database);

  expect((await readConductorCatalog(databasePath)).repos[0]?.databaseSettings).toEqual({});
});

test("rejects an unsupported schema version before guessing at its contents", async () => {
  const databasePath = temporaryDatabase();
  cpSync(fixturePath, databasePath);
  const database = await openFixtureDatabase(databasePath);
  database.run("PRAGMA user_version = 111");
  saveFixtureDatabase(databasePath, database);

  await expect(readConductorCatalog(databasePath)).rejects.toThrow(
    UnsupportedConductorDatabaseError,
  );
});

test("reports malformed database JSON and script columns per project", async () => {
  const databasePath = temporaryDatabase();
  cpSync(fixturePath, databasePath);
  const database = await openFixtureDatabase(databasePath);
  database.run(
    "UPDATE repos SET run_scripts_json = ?, metadata_prompts_json = ?, setup_script = ? WHERE id = 'repo-current'",
    ["{bad", "[]", new Uint8Array([42])],
  );
  saveFixtureDatabase(databasePath, database);

  const repo = (await readConductorCatalog(databasePath)).repos.find(
    (candidate) => candidate.id === "repo-current",
  );

  expect(repo?.databaseSettings).toEqual({ scripts: { archive: "db teardown" } });
  expect(repo?.notices).toEqual([
    {
      code: "malformed-database-setting",
      level: "warning",
      message: "Skipped malformed run_scripts_json for project repo-current.",
    },
    {
      code: "malformed-database-setting",
      level: "warning",
      message: "Skipped malformed metadata_prompts_json for project repo-current.",
    },
    {
      code: "malformed-database-setting",
      level: "warning",
      message: "Skipped malformed setup_script for project repo-current.",
    },
  ]);
});

function temporaryDatabase(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "paseo-migrate-db-"));
  cleanup.push(directory);
  return path.join(directory, "conductor.db");
}
