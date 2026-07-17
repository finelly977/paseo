import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { readPaseoConfigForEdit } from "../../../../utils/paseo-config-file.js";
import { applyProjectConfigImport, inspectProjectConfigImport } from "./index.js";
import { InvalidProjectConfigImportSourceError } from "./model.js";

const tempDirs: string[] = [];
const CONDUCTOR_SOURCE = { kind: "conductor" } as const;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "conductor-import-test-"));
  tempDirs.push(repo);
  return repo;
}

function writeSharedToml(repo: string, contents: string): void {
  mkdirSync(join(repo, ".conductor"), { recursive: true });
  writeFileSync(join(repo, ".conductor", "settings.toml"), contents);
}

function writeLocalToml(repo: string, contents: string): void {
  mkdirSync(join(repo, ".conductor"), { recursive: true });
  writeFileSync(join(repo, ".conductor", "settings.local.toml"), contents);
}

function inspect(repo: string, paseoConfig = {}) {
  return inspectProjectConfigImport({
    repoRoot: repo,
    source: CONDUCTOR_SOURCE,
    paseoConfig,
    paseoRevision: null,
  });
}

function captureInvalidSourceError(repo: string): InvalidProjectConfigImportSourceError {
  try {
    inspect(repo);
  } catch (error) {
    if (error instanceof InvalidProjectConfigImportSourceError) {
      return error;
    }
  }
  throw new Error("Expected invalid source config error");
}

function readValidPaseoConfig(
  repo: string,
): Extract<ReturnType<typeof readPaseoConfigForEdit>, { ok: true }> {
  const result = readPaseoConfigForEdit(repo);
  if (!result.ok) {
    throw new Error("Expected valid paseo config");
  }
  return result;
}

describe("Conductor project config import", () => {
  test("maps shared TOML setup, archive, run service, cwd, args, rewrites, and unsupported settings", () => {
    const repo = makeRepo();
    writeSharedToml(
      repo,
      `
file_include_globs = ["config/*.local"]

[scripts]
setup = "echo $CONDUCTOR_WORKSPACE_PATH && echo \${CONDUCTOR_ROOT_PATH}"
archive = "cleanup $CONDUCTOR_PORT"
run_mode = "nonconcurrent"
auto_run_after_setup = true

[scripts.run.dev]
command = "npm run dev -- --port $CONDUCTOR_PORT"
args = ["--host", "0.0.0.0"]
hide = true

[scripts.run.dev.options]
cwd = "apps/web"

[environment_variables]
SECRET_TOKEN = "do-not-return"

[spotlight_testing]
enabled = true
`,
    );

    const preview = inspect(repo);

    expect(preview.status).toBe("available");
    expect(preview.inputs).toEqual([{ role: "shared", relativePath: ".conductor/settings.toml" }]);
    expect(preview.preview).toMatchObject({
      worktree: {
        setup: "echo $PASEO_WORKTREE_PATH && echo ${PASEO_SOURCE_CHECKOUT_PATH}",
        teardown: "cleanup $PASEO_WORKTREE_PORT",
      },
      scripts: {
        dev: {
          type: "service",
          port: "$PASEO_PORT",
          command: "cd -- 'apps/web' && npm run dev -- --port $PASEO_PORT '--host' '0.0.0.0'",
        },
      },
    });
    expect(preview.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "worktree.setup", outcome: "import" }),
        expect.objectContaining({ key: "worktree.teardown", outcome: "import" }),
        expect.objectContaining({ key: "scripts.dev", outcome: "import" }),
        expect.objectContaining({ key: "variables.CONDUCTOR_WORKSPACE_PATH", outcome: "rewrite" }),
        expect.objectContaining({ key: "variables.CONDUCTOR_ROOT_PATH", outcome: "rewrite" }),
        expect.objectContaining({ key: "variables.CONDUCTOR_PORT", outcome: "rewrite" }),
        expect.objectContaining({ key: "scripts.run_mode", outcome: "unsupported" }),
        expect.objectContaining({ key: "scripts.auto_run_after_setup", outcome: "unsupported" }),
        expect.objectContaining({ key: "file_include_globs", outcome: "unsupported" }),
        expect.objectContaining({
          key: "environment_variables",
          outcome: "unsupported",
          detail: "Environment variable values are not imported. Found: SECRET_TOKEN.",
        }),
        expect.objectContaining({ key: "spotlight_testing", outcome: "unsupported" }),
        expect.objectContaining({ key: "scripts.dev.hide", outcome: "unsupported" }),
      ]),
    );
    expect(JSON.stringify(preview.items)).not.toContain("do-not-return");
  });

  test("local TOML overrides shared scripts and legacy JSON is ignored when shared TOML exists", () => {
    const repo = makeRepo();
    writeSharedToml(
      repo,
      `
[scripts]
setup = "shared setup"
[scripts.run.dev]
command = "shared dev"
`,
    );
    writeLocalToml(
      repo,
      `
[scripts]
setup = "local setup"
[scripts.run.dev]
command = "local dev"
`,
    );
    writeFileSync(
      join(repo, "conductor.json"),
      JSON.stringify({ scripts: { setup: "legacy setup", run: "legacy run" } }),
    );

    const preview = inspect(repo);

    expect(preview.inputs).toEqual([
      { role: "shared", relativePath: ".conductor/settings.toml" },
      { role: "local", relativePath: ".conductor/settings.local.toml" },
    ]);
    expect(preview.preview).toMatchObject({
      worktree: { setup: "local setup" },
      scripts: { dev: { command: "local dev" } },
    });
  });

  test("imports legacy conductor.json when shared TOML is absent", () => {
    const repo = makeRepo();
    writeFileSync(
      join(repo, "conductor.json"),
      JSON.stringify({ scripts: { setup: "legacy setup", run: "npm test" } }),
    );

    const preview = inspect(repo);

    expect(preview.inputs).toEqual([{ role: "legacy", relativePath: "conductor.json" }]);
    expect(preview.preview).toMatchObject({
      worktree: { setup: "legacy setup" },
      scripts: { run: { command: "npm test" } },
    });
  });

  test("reports missing and empty repository-local Conductor configs", () => {
    const missingRepo = makeRepo();
    const emptyRepo = makeRepo();
    writeSharedToml(emptyRepo, "");

    expect(inspect(missingRepo)).toEqual({
      repoRoot: missingRepo,
      source: CONDUCTOR_SOURCE,
      status: "not_found",
      sourceRevision: null,
      paseoRevision: null,
      inputs: [],
      items: [],
      preview: null,
    });
    expect(inspect(emptyRepo)).toMatchObject({
      repoRoot: emptyRepo,
      source: CONDUCTOR_SOURCE,
      status: "nothing_to_import",
      inputs: [{ role: "shared", relativePath: ".conductor/settings.toml" }],
      items: [],
      preview: null,
    });
  });

  test("preserves existing Paseo values as collisions and reports nothing to import on retry", () => {
    const repo = makeRepo();
    writeSharedToml(
      repo,
      `
[scripts]
setup = "npm ci"
[scripts.run.dev]
command = "npm run dev"
`,
    );

    const preview = inspect(repo, {
      custom: { keep: true },
      worktree: { setup: "pnpm install", extra: "field" },
      scripts: { dev: { command: "pnpm dev", color: "blue" } },
    });

    expect(preview.status).toBe("nothing_to_import");
    expect(preview.preview).toBeNull();
    expect(preview.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "worktree.setup", outcome: "collision" }),
        expect.objectContaining({ key: "scripts.dev", outcome: "collision" }),
      ]),
    );
  });

  test("does not rewrite variable substrings and warns for unsupported Conductor variables", () => {
    const repo = makeRepo();
    writeSharedToml(
      repo,
      `
[scripts]
setup = "echo $MY_CONDUCTOR_PORT_BACKUP $CONDUCTOR_DEFAULT_BRANCH"
`,
    );

    const preview = inspect(repo);

    expect(preview.preview).toMatchObject({
      worktree: { setup: "echo $MY_CONDUCTOR_PORT_BACKUP $CONDUCTOR_DEFAULT_BRANCH" },
    });
    expect(preview.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "variables.CONDUCTOR_DEFAULT_BRANCH",
          outcome: "unsupported",
        }),
      ]),
    );
    expect(preview.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "variables.CONDUCTOR_PORT" })]),
    );
  });

  test("source digest changes after a byte change and apply rejects stale source", () => {
    const repo = makeRepo();
    writeSharedToml(repo, '[scripts]\nsetup = "npm ci"\n');
    const preview = inspect(repo);
    writeSharedToml(repo, '[scripts]\nsetup = "pnpm install"\n');

    const result = applyProjectConfigImport({
      repoRoot: repo,
      source: CONDUCTOR_SOURCE,
      expectedSourceRevision: preview.sourceRevision ?? "",
      expectedPaseoRevision: null,
    });

    expect(result).toEqual({
      ok: false,
      repoRoot: repo,
      error: { code: "stale_source_config", source: CONDUCTOR_SOURCE },
    });
  });

  test("apply rejects a stale paseo.json revision", () => {
    const repo = makeRepo();
    writeSharedToml(repo, '[scripts]\nsetup = "npm ci"\n');
    writeFileSync(join(repo, "paseo.json"), '{"custom":true}\n');
    const paseoRevision = readValidPaseoConfig(repo);
    const preview = inspectProjectConfigImport({
      repoRoot: repo,
      source: CONDUCTOR_SOURCE,
      paseoConfig: paseoRevision.config ?? {},
      paseoRevision: paseoRevision.revision,
    });
    writeFileSync(join(repo, "paseo.json"), '{"custom":false}\n');

    expect(
      applyProjectConfigImport({
        repoRoot: repo,
        source: CONDUCTOR_SOURCE,
        expectedSourceRevision: preview.sourceRevision ?? "",
        expectedPaseoRevision: paseoRevision.revision,
      }),
    ).toMatchObject({
      ok: false,
      repoRoot: repo,
      error: { code: "stale_project_config" },
    });
  });

  test.skipIf(process.platform === "win32")("apply reports write failure visibly", () => {
    const repo = makeRepo();
    writeSharedToml(repo, '[scripts]\nsetup = "npm ci"\n');
    const preview = inspect(repo);
    chmodSync(repo, 0o555);
    try {
      expect(
        applyProjectConfigImport({
          repoRoot: repo,
          source: CONDUCTOR_SOURCE,
          expectedSourceRevision: preview.sourceRevision ?? "",
          expectedPaseoRevision: null,
        }),
      ).toEqual({
        ok: false,
        repoRoot: repo,
        error: { code: "write_failed" },
      });
    } finally {
      chmodSync(repo, 0o755);
    }
  });

  test("apply writes formatted paseo.json after recomputing from disk", () => {
    const repo = makeRepo();
    writeSharedToml(repo, '[scripts]\nsetup = "npm ci"\n');
    const preview = inspect(repo);

    const result = applyProjectConfigImport({
      repoRoot: repo,
      source: CONDUCTOR_SOURCE,
      expectedSourceRevision: preview.sourceRevision ?? "",
      expectedPaseoRevision: null,
    });

    expect(result).toMatchObject({
      ok: true,
      repoRoot: repo,
      config: { worktree: { setup: "npm ci" } },
    });
    expect(readFileSync(join(repo, "paseo.json"), "utf8")).toBe(
      '{\n  "worktree": {\n    "setup": "npm ci"\n  }\n}\n',
    );
    expect(readPaseoConfigForEdit(repo)).toMatchObject({
      ok: true,
      config: { worktree: { setup: "npm ci" } },
    });
  });

  test("malformed TOML identifies the safe relative source path", () => {
    const repo = makeRepo();
    writeSharedToml(repo, "[scripts\nsetup = nope");

    expect(() => inspect(repo)).toThrow(InvalidProjectConfigImportSourceError);
    expect(captureInvalidSourceError(repo)).toMatchObject({
      source: CONDUCTOR_SOURCE,
      relativePath: ".conductor/settings.toml",
    });
  });

  test("malformed local TOML identifies the local override path", () => {
    const repo = makeRepo();
    writeSharedToml(repo, '[scripts]\nsetup = "npm ci"\n');
    writeLocalToml(repo, "[scripts\nsetup = nope");

    expect(captureInvalidSourceError(repo)).toMatchObject({
      source: CONDUCTOR_SOURCE,
      relativePath: ".conductor/settings.local.toml",
    });
  });

  test(".worktreeinclude is reported and not converted to shell commands", () => {
    const repo = makeRepo();
    writeSharedToml(repo, '[scripts]\nsetup = "npm ci"\n');
    writeFileSync(join(repo, ".worktreeinclude"), "config/*.local\n");

    expect(inspect(repo).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: ".worktreeinclude",
          outcome: "unsupported",
          detail: "Worktree include patterns are not converted to shell copy commands.",
        }),
      ]),
    );
  });
});
