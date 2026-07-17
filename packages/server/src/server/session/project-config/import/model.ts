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
  source: ProjectConfigImportSource;
  sourceRevision: string;
  inputs: ProjectConfigImportInput[];
  items: ProjectConfigImportItem[];
  patch: PaseoConfigRaw;
}

export interface InspectProjectConfigImportInput {
  repoRoot: string;
  source: ProjectConfigImportSource;
  paseoConfig: PaseoConfigRaw;
  paseoRevision: PaseoConfigRevision | null;
}

export interface ApplyProjectConfigImportInput {
  repoRoot: string;
  source: ProjectConfigImportSource;
  expectedSourceRevision: string;
  expectedPaseoRevision: PaseoConfigRevision | null;
}

export type ProjectConfigImportApplyResult =
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
