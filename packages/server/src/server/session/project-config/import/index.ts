import {
  readPaseoConfigForEdit,
  writePaseoConfigForEdit,
} from "../../../../utils/paseo-config-file.js";
import { inspectConductorImport } from "./sources/conductor.js";
import { mergeProjectConfigImport } from "./merge.js";
import {
  InvalidProjectConfigImportSourceError,
  type ApplyProjectConfigImportInput,
  type InspectProjectConfigImportInput,
  type ProjectConfigImportApplyResult,
  type ProjectConfigImportCandidate,
  type ProjectConfigImportPreview,
  type ProjectConfigImportSource,
} from "./model.js";

export type {
  ProjectConfigImportApplyResult,
  ProjectConfigImportPreview,
  ProjectConfigImportSource,
};

export function inspectProjectConfigImport(
  input: InspectProjectConfigImportInput,
): ProjectConfigImportPreview {
  let candidate: ProjectConfigImportCandidate | null;
  switch (input.source.kind) {
    case "conductor":
      candidate = inspectConductorImport({
        repoRoot: input.repoRoot,
        source: input.source,
      });
      break;
  }

  return mergeProjectConfigImport({
    repoRoot: input.repoRoot,
    source: input.source,
    candidate,
    paseoConfig: input.paseoConfig,
    paseoRevision: input.paseoRevision,
  });
}

export function applyProjectConfigImport(
  input: ApplyProjectConfigImportInput,
): ProjectConfigImportApplyResult {
  const currentConfig = readPaseoConfigForEdit(input.repoRoot);
  if (!currentConfig.ok) {
    return { ok: false, repoRoot: input.repoRoot, error: currentConfig.error };
  }

  let preview: ProjectConfigImportPreview;
  try {
    preview = inspectProjectConfigImport({
      repoRoot: input.repoRoot,
      source: input.source,
      paseoConfig: currentConfig.config ?? {},
      paseoRevision: currentConfig.revision,
    });
  } catch (error) {
    if (error instanceof InvalidProjectConfigImportSourceError) {
      return {
        ok: false,
        repoRoot: input.repoRoot,
        error: {
          code: "invalid_source_config",
          source: error.source,
          relativePath: error.relativePath,
        },
      };
    }
    throw error;
  }

  if (preview.status === "not_found" || !preview.sourceRevision) {
    return {
      ok: false,
      repoRoot: input.repoRoot,
      error: { code: "source_config_not_found", source: input.source },
    };
  }
  if (preview.sourceRevision !== input.expectedSourceRevision) {
    return {
      ok: false,
      repoRoot: input.repoRoot,
      error: { code: "stale_source_config", source: input.source },
    };
  }
  if (!paseoConfigRevisionsEqual(currentConfig.revision, input.expectedPaseoRevision)) {
    return {
      ok: false,
      repoRoot: input.repoRoot,
      error: { code: "stale_project_config", currentRevision: currentConfig.revision },
    };
  }
  if (preview.status === "nothing_to_import" || !preview.preview) {
    return { ok: false, repoRoot: input.repoRoot, error: { code: "nothing_to_import" } };
  }

  const written = writePaseoConfigForEdit({
    repoRoot: input.repoRoot,
    config: preview.preview,
    expectedRevision: input.expectedPaseoRevision,
  });
  if (!written.ok) {
    return { ok: false, repoRoot: input.repoRoot, error: written.error };
  }
  return {
    ok: true,
    repoRoot: input.repoRoot,
    source: input.source,
    config: written.config,
    revision: written.revision,
    items: preview.items,
  };
}

function paseoConfigRevisionsEqual(
  left: ProjectConfigImportPreview["paseoRevision"],
  right: ProjectConfigImportPreview["paseoRevision"],
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}
