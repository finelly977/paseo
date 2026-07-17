import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  createProjectConfigImportRegistry,
  productionProjectConfigImportSourceSet,
} from "../../registry.js";
import {
  createProjectConfigImportService,
  InvalidProjectConfigImportSourceError,
} from "../../service.js";
import { conductorProjectConfigImporter } from "./importer.js";

const tempDirs: string[] = [];
const CONDUCTOR_SOURCE = { kind: "conductor" } as const;
const service = createProjectConfigImportService(
  createProjectConfigImportRegistry(
    [conductorProjectConfigImporter],
    productionProjectConfigImportSourceSet,
  ),
);

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

function writeSharedJson(repo: string, value: unknown): void {
  mkdirSync(join(repo, ".conductor"), { recursive: true });
  writeFileSync(join(repo, ".conductor", "settings.json"), JSON.stringify(value));
}

function writeLocalJson(repo: string, value: unknown): void {
  mkdirSync(join(repo, ".conductor"), { recursive: true });
  writeFileSync(join(repo, ".conductor", "settings.local.json"), JSON.stringify(value));
}

function inspect(repo: string, paseoConfig = {}) {
  return service.inspect({
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
          command: "cd -- 'apps/web' && npm run dev -- --port $PASEO_PORT '--host' '0.0.0.0'",
        },
      },
    });
    expect(preview.preview?.scripts?.dev).not.toHaveProperty("port");
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
      ]),
    );
    expect(JSON.stringify(preview.items)).not.toContain("do-not-return");
  });

  test("merges legacy scoped JSON before TOML and lets local TOML win", () => {
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
    writeSharedJson(repo, {
      scripts: { setup: "scoped legacy shared setup", archive: "scoped legacy archive" },
    });
    writeLocalJson(repo, { scripts: { setup: "scoped legacy local setup" } });
    writeFileSync(
      join(repo, "conductor.json"),
      JSON.stringify({ scripts: { setup: "legacy setup", run: "legacy run" } }),
    );

    const preview = inspect(repo);

    expect(preview.inputs).toEqual([
      { role: "shared", relativePath: ".conductor/settings.json" },
      { role: "shared", relativePath: ".conductor/settings.toml" },
      { role: "local", relativePath: ".conductor/settings.local.json" },
      { role: "local", relativePath: ".conductor/settings.local.toml" },
    ]);
    expect(preview.preview).toMatchObject({
      worktree: { setup: "local setup", teardown: "scoped legacy archive" },
      scripts: { dev: { command: "local dev" } },
    });
  });

  test("deep-merges local run-script fields with shared commands", () => {
    const repo = makeRepo();
    writeSharedToml(
      repo,
      `
[scripts.run.dev]
command = "npm run dev"
args = ["--shared"]
[scripts.run.dev.options]
cwd = "apps/web"
`,
    );
    writeLocalToml(
      repo,
      `
[scripts.run.dev]
args = ["--local"]
[scripts.run.dev.options]
cwd = "apps/local-web"
`,
    );

    expect(inspect(repo).preview).toMatchObject({
      scripts: {
        dev: { command: "cd -- 'apps/local-web' && npm run dev '--local'" },
      },
    });
  });

  test("imports legacy scoped JSON settings with local overrides", () => {
    const repo = makeRepo();
    writeSharedJson(repo, {
      scripts: { setup: "shared setup", run: { dev: { command: "npm run dev" } } },
    });
    writeLocalJson(repo, { scripts: { run: { dev: { args: ["--local"] } } } });

    const preview = inspect(repo);

    expect(preview.inputs).toEqual([
      { role: "shared", relativePath: ".conductor/settings.json" },
      { role: "local", relativePath: ".conductor/settings.local.json" },
    ]);
    expect(preview.preview).toMatchObject({
      worktree: { setup: "shared setup" },
      scripts: { dev: { command: "npm run dev '--local'" } },
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

  test("preserves shell expansion for environment variables in script arguments", () => {
    const repo = makeRepo();
    writeSharedToml(
      repo,
      `
[scripts.run.dev]
command = "npm run dev"
args = ["--port", "$CONDUCTOR_PORT", "--label=$WORKSPACE_NAME"]
`,
    );

    expect(inspect(repo).preview).toMatchObject({
      scripts: {
        dev: {
          type: "service",
          command: `npm run dev '--port' "$PASEO_PORT" '--label='"$WORKSPACE_NAME"`,
        },
      },
    });
  });

  test("preserves shell parameter expansion in script arguments", () => {
    const repo = makeRepo();
    writeSharedToml(
      repo,
      `
[scripts.run.dev]
command = "npm run dev"
args = ["--port=\${CONDUCTOR_PORT:-3000}"]
`,
    );

    expect(inspect(repo).preview).toMatchObject({
      scripts: {
        dev: {
          type: "service",
          command: `npm run dev '--port='"\${PASEO_PORT:-3000}"`,
        },
      },
    });
  });

  test("rejects normalized working directories that escape the project root", () => {
    const repo = makeRepo();
    writeSharedToml(
      repo,
      `
[scripts.run.parent]
command = "npm test"
[scripts.run.parent.options]
cwd = "./.."

[scripts.run.nested]
command = "npm test"
[scripts.run.nested.options]
cwd = "apps/web/../../.."

[scripts.run.unc]
command = "npm test"
[scripts.run.unc.options]
cwd = '\\\\server\\share'
`,
    );

    const preview = inspect(repo);

    expect(preview.preview).toMatchObject({
      scripts: {
        parent: { command: "npm test" },
        nested: { command: "npm test" },
        unc: { command: "npm test" },
      },
    });
    expect(preview.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "scripts.parent.cwd", outcome: "unsupported" }),
        expect.objectContaining({ key: "scripts.nested.cwd", outcome: "unsupported" }),
        expect.objectContaining({ key: "scripts.unc.cwd", outcome: "unsupported" }),
      ]),
    );
  });

  test("emits normalized relative working directories", () => {
    const repo = makeRepo();
    writeSharedToml(
      repo,
      `
[scripts.run.dev]
command = "npm test"
[scripts.run.dev.options]
cwd = 'apps\\web'
`,
    );

    expect(inspect(repo).preview).toMatchObject({
      scripts: { dev: { command: "cd -- 'apps/web' && npm test" } },
    });
  });

  test("rewrites Conductor ports inside shell parameter expansions", () => {
    const repo = makeRepo();
    writeSharedToml(
      repo,
      `
[scripts.run.dev]
command = "npm run dev -- --port \${CONDUCTOR_PORT:-3000}"
`,
    );

    expect(inspect(repo).preview).toMatchObject({
      scripts: {
        dev: {
          type: "service",
          command: "npm run dev -- --port ${PASEO_PORT:-3000}",
        },
      },
    });
  });

  test("does not import scripts available only in Conductor cloud", () => {
    const repo = makeRepo();
    writeSharedToml(
      repo,
      `
[scripts.run.cloud]
command = "npm run cloud"
available_in = ["cloud"]

[scripts.run.everywhere]
command = "npm run everywhere"
available_in = ["local", "cloud"]
`,
    );

    const preview = inspect(repo);

    expect(preview.preview).toMatchObject({
      scripts: { everywhere: { command: "npm run everywhere" } },
    });
    expect(preview.preview?.scripts).not.toHaveProperty("cloud");
    expect(preview.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "scripts.cloud",
          outcome: "unsupported",
          detail: "Cloud-only scripts are not imported.",
        }),
      ]),
    );
  });

  test("does not import hidden Conductor run scripts", () => {
    const repo = makeRepo();
    writeSharedToml(
      repo,
      `
[scripts.run.helper]
command = "npm run helper"
hide = true
`,
    );

    const preview = inspect(repo);

    expect(preview.preview?.scripts ?? {}).not.toHaveProperty("helper");
    expect(preview.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "scripts.helper",
          outcome: "unsupported",
          detail: "Hidden scripts are not imported.",
        }),
      ]),
    );
  });

  test("reports nested environment variables, prompts, and Git settings", () => {
    const repo = makeRepo();
    writeSharedToml(
      repo,
      `
[environment_variables.local]
LOCAL_TOKEN = "local-secret"

[environment_variables.cloud]
CLOUD_TOKEN = "cloud-secret"

[prompts]
system = "custom prompt"

[git]
default_branch = "develop"
`,
    );

    expect(inspect(repo).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "environment_variables",
          outcome: "unsupported",
          detail: "Environment variable values are not imported. Found: CLOUD_TOKEN, LOCAL_TOKEN.",
        }),
        expect.objectContaining({ key: "prompts", outcome: "unsupported" }),
        expect.objectContaining({ key: "git", outcome: "unsupported" }),
      ]),
    );
  });

  test("preserves shared environment variable names under local scoped overrides", () => {
    const repo = makeRepo();
    writeSharedToml(
      repo,
      `
[environment_variables.local]
SHARED_TOKEN = "shared-secret"
`,
    );
    writeLocalToml(
      repo,
      `
[environment_variables.cloud]
CLOUD_TOKEN = "cloud-secret"
`,
    );

    expect(inspect(repo).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "environment_variables",
          detail: "Environment variable values are not imported. Found: CLOUD_TOKEN, SHARED_TOKEN.",
        }),
      ]),
    );
  });

  test("reports legacy run mode, privacy, and harness settings", () => {
    const repo = makeRepo();
    writeFileSync(
      join(repo, "conductor.json"),
      JSON.stringify({
        scripts: { setup: "npm ci" },
        runScriptMode: "nonconcurrent",
        enterpriseDataPrivacy: true,
        claude_code_executable_path: "/opt/claude",
        codex_executable_path: "/opt/codex",
        claude_provider: "bedrock",
        codex_provider: "custom",
        bedrock_region: "eu-west-1",
        vertex_project_id: "project",
        ssh_key_path: "~/.ssh/id_ed25519",
      }),
    );

    expect(inspect(repo).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "runScriptMode", outcome: "unsupported" }),
        expect.objectContaining({ key: "enterpriseDataPrivacy", outcome: "unsupported" }),
        expect.objectContaining({ key: "claude_code_executable_path", outcome: "unsupported" }),
        expect.objectContaining({ key: "codex_executable_path", outcome: "unsupported" }),
        expect.objectContaining({ key: "claude_provider", outcome: "unsupported" }),
        expect.objectContaining({ key: "codex_provider", outcome: "unsupported" }),
        expect.objectContaining({ key: "bedrock_region", outcome: "unsupported" }),
        expect.objectContaining({ key: "vertex_project_id", outcome: "unsupported" }),
        expect.objectContaining({ key: "ssh_key_path", outcome: "unsupported" }),
      ]),
    );
  });

  test("reports snake-case enterprise data privacy settings", () => {
    const repo = makeRepo();
    writeSharedToml(repo, "enterprise_data_privacy = true\n");

    expect(inspect(repo).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "enterprise_data_privacy", outcome: "unsupported" }),
      ]),
    );
  });

  test("reports default and icon fields on imported run scripts", () => {
    const repo = makeRepo();
    writeSharedToml(
      repo,
      `
[scripts.run.dev]
command = "npm run dev"
default = true
icon = "play"
`,
    );

    const preview = inspect(repo);

    expect(preview.preview).toMatchObject({ scripts: { dev: { command: "npm run dev" } } });
    expect(preview.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "scripts.dev.default", outcome: "unsupported" }),
        expect.objectContaining({ key: "scripts.dev.icon", outcome: "unsupported" }),
      ]),
    );
  });

  test("does not import services with colliding normalized environment names", () => {
    const repo = makeRepo();
    writeSharedToml(
      repo,
      `
[scripts.run.app-server]
command = "npm run app -- --port $CONDUCTOR_PORT"

[scripts.run."app.server"]
command = "npm run other -- --port $CONDUCTOR_PORT"
`,
    );

    const preview = inspect(repo);

    expect(preview.preview?.scripts).toMatchObject({
      "app-server": { type: "service" },
    });
    expect(preview.preview?.scripts).not.toHaveProperty("app.server");
    expect(preview.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "scripts.app.server",
          outcome: "collision",
          detail: 'Service environment name collides with "app-server" (APP_SERVER).',
        }),
      ]),
    );
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

  test("unreadable source paths identify the invalid relative file", () => {
    const repo = makeRepo();
    mkdirSync(join(repo, ".conductor", "settings.toml"), { recursive: true });

    expect(captureInvalidSourceError(repo)).toMatchObject({
      source: CONDUCTOR_SOURCE,
      relativePath: ".conductor/settings.toml",
    });
  });

  test(".worktreeinclude is reported and not converted to shell commands", () => {
    const repo = makeRepo();
    writeSharedToml(repo, '[scripts]\nsetup = "npm ci"\n');
    writeFileSync(join(repo, ".worktreeinclude"), "config/*.local\n");

    const initialPreview = inspect(repo);
    expect(initialPreview.inputs).toEqual([
      { role: "shared", relativePath: ".conductor/settings.toml" },
      { role: "include", relativePath: ".worktreeinclude" },
    ]);
    expect(initialPreview.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: ".worktreeinclude",
          outcome: "unsupported",
          detail: "Worktree include patterns are not converted to shell copy commands.",
        }),
      ]),
    );
    writeFileSync(join(repo, ".worktreeinclude"), "config/*.local\nsecrets/*.local\n");
    expect(inspect(repo).sourceRevision).not.toBe(initialPreview.sourceRevision);
  });
});
