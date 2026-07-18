import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { inspectConductorProjectConfig } from "./project-config.js";

const cleanup: string[] = [];

afterEach(() => {
  for (const target of cleanup.splice(0)) rmSync(target, { recursive: true, force: true });
});

test("maps current shared and local TOML with local precedence and no secret values", () => {
  const repo = fixtureRepo("current");

  const inspected = inspectConductorProjectConfig(repo, {
    scripts: { setup: "database setup", run: { database: { command: "database run" } } },
  });

  expect(inspected.config).toEqual({
    worktree: { setup: "npm ci --prefer-offline", teardown: "npm run cleanup" },
    scripts: {
      database: { command: "database run" },
      dev: { command: "npm run dev -- --port $PASEO_PORT", type: "service" },
      test: { command: "npm test" },
    },
    metadataGeneration: { title: { instructions: "Write a concise task title" } },
  });
  expect(inspected.notices).toContainEqual({
    code: "conductor-setting-unsupported",
    level: "warning",
    message:
      "environment_variables: Environment variable values are not imported. Found: SECRET_TOKEN.",
  });
  expect(inspected.config?.worktree?.setup).not.toContain("fixture-secret-never-print");
  expect(inspected.notices.map((notice) => notice.message).join("\n")).not.toContain(
    "fixture-secret-never-print",
  );
});

test("maps legacy conductor.json when TOML is absent", () => {
  const inspected = inspectConductorProjectConfig(fixtureRepo("legacy"));

  expect(inspected.config).toEqual({
    worktree: { setup: "legacy setup", teardown: "legacy teardown" },
    scripts: { test: { command: "legacy test" } },
  });
});

test("imports only commands whose cwd and Conductor variables have exact semantics", () => {
  const repo = emptyRepo("safe-commands");
  writeSettings(
    repo,
    `
unknown_project_setting = true

[scripts]
setup = "echo $CONDUCTOR_WORKSPACE_NAME"

[scripts.run.safe]
command = "npm test"

[scripts.run.service]
command = "serve --port $CONDUCTOR_PORT"

[scripts.run.absolute]
command = "npm start"
[scripts.run.absolute.options]
cwd = "/tmp/outside"

[scripts.run.escape]
command = "npm start"
[scripts.run.escape.options]
cwd = "../outside"

[scripts.run.unknown_variable]
command = "echo $CONDUCTOR_UNSUPPORTED_VALUE"
`,
  );

  const inspected = inspectConductorProjectConfig(repo);

  expect(inspected.config).toEqual({
    scripts: {
      safe: { command: "npm test" },
      service: { command: "serve --port $PASEO_PORT", type: "service" },
    },
  });
  expect(inspected.notices.map((notice) => notice.message)).toEqual(
    expect.arrayContaining([
      "worktree.setup: Unsupported Conductor variables: CONDUCTOR_WORKSPACE_NAME. Command was not imported.",
      "scripts.absolute.cwd: Absolute or escaping cwd values are not imported.",
      "scripts.escape.cwd: Absolute or escaping cwd values are not imported.",
      "scripts.unknown_variable: Unsupported Conductor variables: CONDUCTOR_UNSUPPORTED_VALUE. Command was not imported.",
      "settings.unknown_project_setting: Unknown Conductor setting.",
    ]),
  );
});

test("reports malformed scripts instead of silently dropping them", () => {
  const repo = emptyRepo("malformed-scripts");
  writeSettings(
    repo,
    `
[scripts]
run = 42
`,
  );

  const inspected = inspectConductorProjectConfig(repo);

  expect(inspected.config).toBeNull();
  expect(inspected.notices).toContainEqual({
    code: "conductor-setting-malformed",
    level: "warning",
    message: "scripts.run: Expected a command string or script table.",
  });
});

test("skips cwd scripts on Windows instead of emitting POSIX shell syntax", () => {
  const repo = emptyRepo("windows-cwd");
  writeSettings(
    repo,
    `
[scripts.run.dev]
command = "npm run dev"
[scripts.run.dev.options]
cwd = "apps/web"
`,
  );

  const inspected = inspectConductorProjectConfig(repo, {}, "win32");

  expect(inspected.config).toBeNull();
  expect(inspected.notices).toContainEqual({
    code: "conductor-setting-unsupported",
    level: "warning",
    message: "scripts.dev.cwd: Working-directory scripts are not imported on Windows.",
  });
});

function fixtureRepo(name: "current" | "legacy"): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), `paseo-migrate-${name}-`));
  cleanup.push(directory);
  cpSync(
    fileURLToPath(new URL(`../../../fixtures/conductor/${name}`, import.meta.url)),
    directory,
    {
      recursive: true,
    },
  );
  return directory;
}

function emptyRepo(name: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), `paseo-migrate-${name}-`));
  cleanup.push(directory);
  return directory;
}

function writeSettings(repo: string, contents: string): void {
  const conductorDirectory = path.join(repo, ".conductor");
  mkdirSync(conductorDirectory, { recursive: true });
  writeFileSync(path.join(conductorDirectory, "settings.toml"), contents);
}
