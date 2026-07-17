import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import pino from "pino";
import { ProjectConfigSession, type ProjectConfigSessionHost } from "./project-config-session.js";
import type { PersistedProjectRecord } from "../../workspace-registry.js";
import type { SessionOutboundMessage } from "../../messages.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "project-config-session-test-")));
  tempDirs.push(root);
  return root;
}

function projectRecord(rootPath: string, archivedAt: string | null = null): PersistedProjectRecord {
  return {
    projectId: `project:${rootPath}`,
    rootPath,
    kind: "git",
    displayName: "Project",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt,
  };
}

function makeSubsystem(records: PersistedProjectRecord[]) {
  const emitted: SessionOutboundMessage[] = [];
  const host: ProjectConfigSessionHost = { emit: (msg) => emitted.push(msg) };
  const subsystem = new ProjectConfigSession({
    host,
    projectRegistry: { list: async () => records },
    logger: pino({ level: "silent" }),
  });
  return { subsystem, emitted };
}

function expectImportPreview(
  emitted: SessionOutboundMessage[],
  index: number,
): Extract<SessionOutboundMessage, { type: "project.config.get_import.response" }>["payload"] & {
  ok: true;
} {
  const message = emitted[index];
  expect(message).toMatchObject({
    type: "project.config.get_import.response",
    payload: { ok: true },
  });
  if (message.type !== "project.config.get_import.response" || !message.payload.ok) {
    throw new Error("Expected import preview response");
  }
  return message.payload;
}

describe("ProjectConfigSession", () => {
  test("read resolves a known root despite a trailing slash and returns the raw config + revision", async () => {
    const repoRoot = makeRoot();
    writeFileSync(join(repoRoot, "paseo.json"), JSON.stringify({ worktree: { setup: "npm ci" } }));
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

    await subsystem.handleReadProjectConfigRequest({
      type: "read_project_config_request",
      requestId: "read-1",
      repoRoot: `${repoRoot}/`,
    });

    expect(emitted).toEqual([
      {
        type: "read_project_config_response",
        payload: {
          requestId: "read-1",
          repoRoot,
          ok: true,
          config: { worktree: { setup: "npm ci" } },
          revision: expect.objectContaining({
            mtimeMs: expect.any(Number),
            size: expect.any(Number),
          }),
        },
      },
    ]);
  });

  // POSIX-only: creates a directory symlink without Windows privileges.
  test.skipIf(process.platform === "win32")(
    "read resolves a symlink to an active root via realpath",
    async () => {
      const repoRoot = makeRoot();
      writeFileSync(
        join(repoRoot, "paseo.json"),
        JSON.stringify({ worktree: { setup: "npm ci" } }),
      );
      const linkRoot = join(makeRoot(), "link");
      symlinkSync(repoRoot, linkRoot, "dir");
      const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

      await subsystem.handleReadProjectConfigRequest({
        type: "read_project_config_request",
        requestId: "read-symlink-1",
        repoRoot: linkRoot,
      });

      expect(emitted).toEqual([
        {
          type: "read_project_config_response",
          payload: {
            requestId: "read-symlink-1",
            repoRoot,
            ok: true,
            config: { worktree: { setup: "npm ci" } },
            revision: expect.objectContaining({
              mtimeMs: expect.any(Number),
              size: expect.any(Number),
            }),
          },
        },
      ]);
    },
  );

  test("read rejects archived and unknown roots with project_not_found", async () => {
    const archivedRoot = makeRoot();
    const unknownRoot = makeRoot();
    const { subsystem, emitted } = makeSubsystem([
      projectRecord(archivedRoot, "2026-01-02T00:00:00.000Z"),
    ]);

    await subsystem.handleReadProjectConfigRequest({
      type: "read_project_config_request",
      requestId: "archived-1",
      repoRoot: archivedRoot,
    });
    await subsystem.handleReadProjectConfigRequest({
      type: "read_project_config_request",
      requestId: "unknown-1",
      repoRoot: unknownRoot,
    });

    expect(emitted).toEqual([
      {
        type: "read_project_config_response",
        payload: {
          requestId: "archived-1",
          repoRoot: archivedRoot,
          ok: false,
          error: { code: "project_not_found" },
        },
      },
      {
        type: "read_project_config_response",
        payload: {
          requestId: "unknown-1",
          repoRoot: unknownRoot,
          ok: false,
          error: { code: "project_not_found" },
        },
      },
    ]);
  });

  test("write round-trips a config to a known root and echoes the new revision", async () => {
    const repoRoot = makeRoot();
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

    await subsystem.handleWriteProjectConfigRequest({
      type: "write_project_config_request",
      requestId: "write-1",
      repoRoot,
      config: { worktree: { setup: "npm ci" } },
      expectedRevision: null,
    });

    expect(emitted).toEqual([
      {
        type: "write_project_config_response",
        payload: {
          requestId: "write-1",
          repoRoot,
          ok: true,
          config: { worktree: { setup: "npm ci" } },
          revision: expect.objectContaining({
            mtimeMs: expect.any(Number),
            size: expect.any(Number),
          }),
        },
      },
    ]);
  });

  test("write rejects a stale revision and an unknown root with their inline domain failures", async () => {
    const staleRoot = makeRoot();
    writeFileSync(join(staleRoot, "paseo.json"), JSON.stringify({ worktree: { setup: "old" } }));
    const unknownRoot = makeRoot();
    const { subsystem, emitted } = makeSubsystem([projectRecord(staleRoot)]);

    await subsystem.handleWriteProjectConfigRequest({
      type: "write_project_config_request",
      requestId: "stale-1",
      repoRoot: staleRoot,
      config: { worktree: { setup: "new" } },
      expectedRevision: { mtimeMs: 1, size: 1 },
    });
    await subsystem.handleWriteProjectConfigRequest({
      type: "write_project_config_request",
      requestId: "unknown-write-1",
      repoRoot: unknownRoot,
      config: { worktree: { setup: "new" } },
      expectedRevision: null,
    });

    expect(emitted).toEqual([
      {
        type: "write_project_config_response",
        payload: {
          requestId: "stale-1",
          repoRoot: staleRoot,
          ok: false,
          error: {
            code: "stale_project_config",
            currentRevision: expect.objectContaining({
              mtimeMs: expect.any(Number),
              size: expect.any(Number),
            }),
          },
        },
      },
      {
        type: "write_project_config_response",
        payload: {
          requestId: "unknown-write-1",
          repoRoot: unknownRoot,
          ok: false,
          error: { code: "project_not_found" },
        },
      },
    ]);
  });

  test("import preview rejects archived and unknown roots with project_not_found", async () => {
    const archivedRoot = makeRoot();
    const unknownRoot = makeRoot();
    const { subsystem, emitted } = makeSubsystem([
      projectRecord(archivedRoot, "2026-01-02T00:00:00.000Z"),
    ]);

    await subsystem.handleGetProjectConfigImportRequest({
      type: "project.config.get_import.request",
      requestId: "import-archived-1",
      repoRoot: archivedRoot,
      source: { kind: "conductor" },
    });
    await subsystem.handleGetProjectConfigImportRequest({
      type: "project.config.get_import.request",
      requestId: "import-unknown-1",
      repoRoot: unknownRoot,
      source: { kind: "conductor" },
    });

    expect(emitted).toEqual([
      {
        type: "project.config.get_import.response",
        payload: {
          requestId: "import-archived-1",
          repoRoot: archivedRoot,
          ok: false,
          error: { code: "project_not_found" },
        },
      },
      {
        type: "project.config.get_import.response",
        payload: {
          requestId: "import-unknown-1",
          repoRoot: unknownRoot,
          ok: false,
          error: { code: "project_not_found" },
        },
      },
    ]);
  });

  test("import preview reports malformed Conductor config with a safe relative path", async () => {
    const repoRoot = makeRoot();
    mkdirSync(join(repoRoot, ".conductor"), { recursive: true });
    writeFileSync(join(repoRoot, ".conductor", "settings.toml"), "[scripts\nsetup = nope");
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

    await subsystem.handleGetProjectConfigImportRequest({
      type: "project.config.get_import.request",
      requestId: "import-invalid-1",
      repoRoot,
      source: { kind: "conductor" },
    });

    expect(emitted).toEqual([
      {
        type: "project.config.get_import.response",
        payload: {
          requestId: "import-invalid-1",
          repoRoot,
          ok: false,
          error: {
            code: "invalid_source_config",
            source: { kind: "conductor" },
            relativePath: ".conductor/settings.toml",
          },
        },
      },
    ]);
  });

  test("apply import recomputes from disk and writes formatted paseo.json", async () => {
    const repoRoot = makeRoot();
    mkdirSync(join(repoRoot, ".conductor"), { recursive: true });
    writeFileSync(join(repoRoot, ".conductor", "settings.toml"), '[scripts]\nsetup = "npm ci"\n');
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

    await subsystem.handleGetProjectConfigImportRequest({
      type: "project.config.get_import.request",
      requestId: "import-preview-1",
      repoRoot,
      source: { kind: "conductor" },
    });
    const preview = expectImportPreview(emitted, 0);

    await subsystem.handleApplyProjectConfigImportRequest({
      type: "project.config.apply_import.request",
      requestId: "import-apply-1",
      repoRoot,
      source: { kind: "conductor" },
      expectedSourceRevision: preview.sourceRevision ?? "",
      expectedPaseoRevision: preview.paseoRevision,
    });

    expect(emitted[1]).toMatchObject({
      type: "project.config.apply_import.response",
      payload: {
        requestId: "import-apply-1",
        repoRoot,
        ok: true,
        config: { worktree: { setup: "npm ci" } },
      },
    });
    expect(readFileSync(join(repoRoot, "paseo.json"), "utf8")).toBe(
      '{\n  "worktree": {\n    "setup": "npm ci"\n  }\n}\n',
    );
  });

  test("apply import rejects stale source digest", async () => {
    const repoRoot = makeRoot();
    mkdirSync(join(repoRoot, ".conductor"), { recursive: true });
    writeFileSync(join(repoRoot, ".conductor", "settings.toml"), '[scripts]\nsetup = "npm ci"\n');
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

    await subsystem.handleApplyProjectConfigImportRequest({
      type: "project.config.apply_import.request",
      requestId: "import-stale-source-1",
      repoRoot,
      source: { kind: "conductor" },
      expectedSourceRevision: "old",
      expectedPaseoRevision: null,
    });

    expect(emitted).toEqual([
      {
        type: "project.config.apply_import.response",
        payload: {
          requestId: "import-stale-source-1",
          repoRoot,
          ok: false,
          error: { code: "stale_source_config", source: { kind: "conductor" } },
        },
      },
    ]);
  });

  test("apply import rejects stale paseo.json revision", async () => {
    const repoRoot = makeRoot();
    mkdirSync(join(repoRoot, ".conductor"), { recursive: true });
    writeFileSync(join(repoRoot, ".conductor", "settings.toml"), '[scripts]\nsetup = "npm ci"\n');
    writeFileSync(join(repoRoot, "paseo.json"), '{"custom":true}\n');
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

    await subsystem.handleGetProjectConfigImportRequest({
      type: "project.config.get_import.request",
      requestId: "import-preview-stale-project-1",
      repoRoot,
      source: { kind: "conductor" },
    });
    const preview = expectImportPreview(emitted, 0);
    writeFileSync(join(repoRoot, "paseo.json"), '{"custom":false}\n');

    await subsystem.handleApplyProjectConfigImportRequest({
      type: "project.config.apply_import.request",
      requestId: "import-stale-project-1",
      repoRoot,
      source: { kind: "conductor" },
      expectedSourceRevision: preview.sourceRevision ?? "",
      expectedPaseoRevision: preview.paseoRevision,
    });

    expect(emitted[1]).toMatchObject({
      type: "project.config.apply_import.response",
      payload: {
        requestId: "import-stale-project-1",
        repoRoot,
        ok: false,
        error: { code: "stale_project_config" },
      },
    });
  });
});
