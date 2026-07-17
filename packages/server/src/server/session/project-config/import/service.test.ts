import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  createProjectConfigImportRegistry,
  productionProjectConfigImportSourceSet,
  type ProjectConfigImportAdapter,
} from "./registry.js";
import { createProjectConfigImportService, type ProjectConfigImportCandidate } from "./service.js";

const tempDirs: string[] = [];
const PROTOCOL_SOURCE = productionProjectConfigImportSourceSet.parse({
  kind: productionProjectConfigImportSourceSet.kinds()[0],
})!;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "project-config-import-service-test-"));
  tempDirs.push(repo);
  return repo;
}

function createFakeService(candidate: () => ProjectConfigImportCandidate | null) {
  const adapter = {
    source: PROTOCOL_SOURCE,
    inspect: () => candidateFor(candidate()),
  } satisfies ProjectConfigImportAdapter<typeof PROTOCOL_SOURCE>;
  return createProjectConfigImportService(
    createProjectConfigImportRegistry([adapter], productionProjectConfigImportSourceSet),
  );
}

function candidateFor(
  candidate: ProjectConfigImportCandidate | null,
): ProjectConfigImportCandidate | null {
  if (!candidate) {
    return null;
  }
  return {
    ...candidate,
    inputs: [{ role: "shared", relativePath: "source/config.json" }],
  };
}

function baseCandidate(sourceRevision = "source-1"): ProjectConfigImportCandidate {
  return {
    sourceRevision,
    inputs: [{ role: "shared", relativePath: "source/config.json" }],
    items: [{ key: "worktree.setup", label: "Worktree setup", outcome: "import" }],
    patch: { worktree: { setup: "npm ci" }, scripts: { dev: { command: "npm run dev" } } },
  };
}

describe("project config import service", () => {
  test("previews missing, available, and collision-only imports through an injected adapter", () => {
    const repo = makeRepo();
    expect(
      createFakeService(() => null).inspect({
        repoRoot: repo,
        source: PROTOCOL_SOURCE,
        paseoConfig: {},
        paseoRevision: null,
      }),
    ).toMatchObject({ status: "not_found", preview: null, sourceRevision: null });

    const service = createFakeService(() => baseCandidate());
    expect(
      service.inspect({
        repoRoot: repo,
        source: PROTOCOL_SOURCE,
        paseoConfig: {},
        paseoRevision: null,
      }),
    ).toMatchObject({
      status: "available",
      preview: { worktree: { setup: "npm ci" }, scripts: { dev: { command: "npm run dev" } } },
    });
    expect(
      service.inspect({
        repoRoot: repo,
        source: PROTOCOL_SOURCE,
        paseoConfig: {
          worktree: { setup: "pnpm install" },
          scripts: { dev: { command: "pnpm dev" } },
        },
        paseoRevision: null,
      }),
    ).toMatchObject({
      status: "nothing_to_import",
      preview: null,
      items: [
        expect.objectContaining({ key: "worktree.setup", outcome: "collision" }),
        expect.objectContaining({ key: "scripts.dev", outcome: "collision" }),
      ],
    });
  });

  test("apply recomputes from disk and writes formatted paseo.json", () => {
    const repo = makeRepo();
    let revision = "source-1";
    const service = createFakeService(() => baseCandidate(revision));

    const result = service.apply({
      repoRoot: repo,
      source: PROTOCOL_SOURCE,
      expectedSourceRevision: "source-1",
      expectedPaseoRevision: null,
    });

    expect(result).toMatchObject({
      ok: true,
      repoRoot: repo,
      config: { worktree: { setup: "npm ci" } },
    });
    expect(readFileSync(join(repo, "paseo.json"), "utf8")).toContain('"setup": "npm ci"');

    revision = "source-2";
    expect(
      service.apply({
        repoRoot: repo,
        source: PROTOCOL_SOURCE,
        expectedSourceRevision: "source-1",
        expectedPaseoRevision: null,
      }),
    ).toEqual({
      ok: false,
      repoRoot: repo,
      error: { code: "stale_source_config", source: PROTOCOL_SOURCE },
    });
  });

  test("apply rejects stale paseo.json revision after recomputing the source", () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "paseo.json"), '{"custom":true}\n');
    const service = createFakeService(() => baseCandidate());

    expect(
      service.apply({
        repoRoot: repo,
        source: PROTOCOL_SOURCE,
        expectedSourceRevision: "source-1",
        expectedPaseoRevision: { mtimeMs: 1, size: 1 },
      }),
    ).toMatchObject({
      ok: false,
      repoRoot: repo,
      error: { code: "stale_project_config" },
    });
  });
});
