import {
  readPaseoConfigForEdit,
  writePaseoConfigForEdit,
} from "../../../../utils/paseo-config-file.js";
import { mergeProjectConfigImport } from "./merge.js";
import type { ProjectConfigImportRegistry } from "./registry.js";
import type {
  PaseoConfigRaw,
  PaseoConfigRevision,
  ProjectConfigImportInput,
  ProjectConfigImportItem,
  ProjectConfigImportPreview,
  ProjectConfigImportSource,
  ProjectConfigRpcError,
} from "@getpaseo/protocol/messages";

export type {
  ProjectConfigImportInput,
  ProjectConfigImportItem,
  ProjectConfigImportPreview,
  ProjectConfigImportSource,
};

export interface ProjectConfigImportCandidate {
  sourceRevision: string;
  inputs: ProjectConfigImportInput[];
  items: ProjectConfigImportItem[];
  patch: PaseoConfigRaw;
}

interface InspectProjectConfigImportInput {
  repoRoot: string;
  source: ProjectConfigImportSource;
  paseoConfig: PaseoConfigRaw;
  paseoRevision: PaseoConfigRevision | null;
}

interface ApplyProjectConfigImportInput {
  repoRoot: string;
  source: ProjectConfigImportSource;
  expectedSourceRevision: string;
  expectedPaseoRevision: PaseoConfigRevision | null;
}

type ProjectConfigImportApplyResult =
  | {
      ok: true;
      repoRoot: string;
      source: ProjectConfigImportSource;
      config: PaseoConfigRaw;
      revision: PaseoConfigRevision;
      items: ProjectConfigImportItem[];
    }
  | { ok: false; repoRoot: string; error: ProjectConfigRpcError };

export class InvalidProjectConfigImportSourceError extends Error {
  readonly source: ProjectConfigImportSource;
  readonly relativePath: string;

  constructor(source: ProjectConfigImportSource, relativePath: string) {
    super(`Invalid ${source.kind} config at ${relativePath}`);
    this.source = source;
    this.relativePath = relativePath;
  }
}

export interface ProjectConfigImportService {
  inspect(input: InspectProjectConfigImportInput): ProjectConfigImportPreview;
  apply(input: ApplyProjectConfigImportInput): ProjectConfigImportApplyResult;
}

export function createProjectConfigImportService(
  registry: ProjectConfigImportRegistry,
): ProjectConfigImportService {
  function inspect(input: InspectProjectConfigImportInput): ProjectConfigImportPreview {
    const adapter = registry.get(input.source.kind);
    const candidate: ProjectConfigImportCandidate | null = adapter
      ? adapter.inspect({ repoRoot: input.repoRoot, source: input.source })
      : null;

    return mergeProjectConfigImport({
      repoRoot: input.repoRoot,
      source: input.source,
      candidate,
      paseoConfig: input.paseoConfig,
      paseoRevision: input.paseoRevision,
    });
  }

  function apply(input: ApplyProjectConfigImportInput): ProjectConfigImportApplyResult {
    const currentConfig = readPaseoConfigForEdit(input.repoRoot);
    if (!currentConfig.ok) {
      return { ok: false, repoRoot: input.repoRoot, error: currentConfig.error };
    }

    let preview: ProjectConfigImportPreview;
    try {
      preview = inspect({
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

  return { inspect, apply };
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
