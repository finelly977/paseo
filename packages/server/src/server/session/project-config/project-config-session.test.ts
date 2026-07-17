import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import pino from "pino";
import {
  ProjectConfigImportSourceSchema,
  type ProjectConfigImportSource,
} from "@getpaseo/protocol/messages";
import { ProjectConfigSession, type ProjectConfigSessionHost } from "./project-config-session.js";
import type { PersistedProjectRecord } from "../../workspace-registry.js";
import type { SessionOutboundMessage } from "../../messages.js";
import {
  InvalidProjectConfigImportSourceError,
  type ProjectConfigImportService,
} from "./import/service.js";

const tempDirs: string[] = [];
const PROTOCOL_PROJECT_CONFIG_IMPORT_SOURCE: ProjectConfigImportSource =
  ProjectConfigImportSourceSchema.options[0].parse({
    kind: ProjectConfigImportSourceSchema.options[0].shape.kind.value,
  });

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

function makeSubsystem(
  records: PersistedProjectRecord[],
  importService?: ProjectConfigImportService,
) {
  const emitted: SessionOutboundMessage[] = [];
  const host: ProjectConfigSessionHost = { emit: (msg) => emitted.push(msg) };
  const subsystem = new ProjectConfigSession({
    host,
    projectRegistry: { list: async () => records },
    ...(importService ? { importService } : {}),
    logger: pino({ level: "silent" }),
  });
  return { subsystem, emitted };
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

  test("import preview rejects archived and unknown roots without touching the import service", async () => {
    const archivedRoot = makeRoot();
    const unknownRoot = makeRoot();
    const serviceCalls: string[] = [];
    const { subsystem, emitted } = makeSubsystem(
      [projectRecord(archivedRoot, "2026-01-02T00:00:00.000Z")],
      {
        inspect: () => {
          serviceCalls.push("inspect");
          throw new Error("unexpected import inspect");
        },
        apply: () => {
          serviceCalls.push("apply");
          throw new Error("unexpected import apply");
        },
      },
    );

    await subsystem.handleGetProjectConfigImportRequest({
      type: "project.config.get_import.request",
      requestId: "import-archived-1",
      repoRoot: archivedRoot,
      source: PROTOCOL_PROJECT_CONFIG_IMPORT_SOURCE,
    });
    await subsystem.handleGetProjectConfigImportRequest({
      type: "project.config.get_import.request",
      requestId: "import-unknown-1",
      repoRoot: unknownRoot,
      source: PROTOCOL_PROJECT_CONFIG_IMPORT_SOURCE,
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
    expect(serviceCalls).toEqual([]);
  });

  test("import preview emits a fake service preview", async () => {
    const repoRoot = makeRoot();
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)], {
      inspect: (input) => ({
        repoRoot: input.repoRoot,
        source: input.source,
        status: "available",
        sourceRevision: "source-revision-1",
        paseoRevision: input.paseoRevision,
        inputs: [{ role: "shared", relativePath: "source/config.json" }],
        items: [{ key: "worktree.setup", label: "Worktree setup", outcome: "import" }],
        preview: { worktree: { setup: "npm ci" } },
      }),
      apply: () => {
        throw new Error("unexpected import apply");
      },
    });

    await subsystem.handleGetProjectConfigImportRequest({
      type: "project.config.get_import.request",
      requestId: "import-preview-1",
      repoRoot,
      source: PROTOCOL_PROJECT_CONFIG_IMPORT_SOURCE,
    });

    expect(emitted[0]).toMatchObject({
      type: "project.config.get_import.response",
      payload: {
        requestId: "import-preview-1",
        repoRoot,
        ok: true,
        sourceRevision: "source-revision-1",
        inputs: [{ role: "shared", relativePath: "source/config.json" }],
      },
    });
  });

  test("import preview reports invalid source errors from the injected service", async () => {
    const repoRoot = makeRoot();
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)], {
      inspect: () => {
        throw new InvalidProjectConfigImportSourceError(
          PROTOCOL_PROJECT_CONFIG_IMPORT_SOURCE,
          "source/config.json",
        );
      },
      apply: () => {
        throw new Error("unexpected import apply");
      },
    });

    await subsystem.handleGetProjectConfigImportRequest({
      type: "project.config.get_import.request",
      requestId: "import-invalid-1",
      repoRoot,
      source: PROTOCOL_PROJECT_CONFIG_IMPORT_SOURCE,
    });

    expect(emitted[0]).toMatchObject({
      type: "project.config.get_import.response",
      payload: {
        requestId: "import-invalid-1",
        repoRoot,
        ok: false,
        error: {
          code: "invalid_source_config",
          source: PROTOCOL_PROJECT_CONFIG_IMPORT_SOURCE,
          relativePath: "source/config.json",
        },
      },
    });
  });

  test("apply import returns the injected service result", async () => {
    const repoRoot = makeRoot();
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)], {
      inspect: () => {
        throw new Error("unexpected import inspect");
      },
      apply: (input) => ({
        ok: true,
        repoRoot: input.repoRoot,
        source: input.source,
        config: { worktree: { setup: "npm ci" } },
        revision: { mtimeMs: 2, size: 42 },
        items: [{ key: "worktree.setup", label: "Worktree setup", outcome: "import" }],
      }),
    });

    await subsystem.handleApplyProjectConfigImportRequest({
      type: "project.config.apply_import.request",
      requestId: "import-apply-1",
      repoRoot,
      source: PROTOCOL_PROJECT_CONFIG_IMPORT_SOURCE,
      expectedSourceRevision: "source-revision-1",
      expectedPaseoRevision: null,
    });

    expect(emitted[0]).toMatchObject({
      type: "project.config.apply_import.response",
      payload: {
        requestId: "import-apply-1",
        repoRoot,
        ok: true,
        config: { worktree: { setup: "npm ci" } },
      },
    });
  });
});
