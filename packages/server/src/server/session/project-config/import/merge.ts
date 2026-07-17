import type { PaseoConfigRaw } from "@getpaseo/protocol/messages";
import type { ProjectConfigImportCandidate, ProjectConfigImportPreview } from "./service.js";

interface MergeProjectConfigImportInput {
  repoRoot: string;
  source: ProjectConfigImportPreview["source"];
  candidate: ProjectConfigImportCandidate | null;
  paseoConfig: PaseoConfigRaw;
  paseoRevision: ProjectConfigImportPreview["paseoRevision"];
}

export function mergeProjectConfigImport(
  input: MergeProjectConfigImportInput,
): ProjectConfigImportPreview {
  if (!input.candidate) {
    return {
      repoRoot: input.repoRoot,
      source: input.source,
      status: "not_found",
      sourceRevision: null,
      paseoRevision: input.paseoRevision,
      inputs: [],
      items: [],
      preview: null,
    };
  }

  const base = input.paseoConfig;
  const merged: PaseoConfigRaw = { ...base };
  const items = input.candidate.items.map((item) => ({ ...item }));
  let importedCount = 0;

  const patchWorktree = input.candidate.patch.worktree ?? {};
  for (const key of ["setup", "teardown"] as const) {
    if (!Object.hasOwn(patchWorktree, key)) continue;
    if (hasLifecycle(base.worktree?.[key])) {
      setOutcome(items, `worktree.${key}`, `Paseo already has ${key} commands.`);
      continue;
    }
    merged.worktree = { ...merged.worktree, [key]: patchWorktree[key] };
    importedCount += 1;
  }

  const patchScripts = input.candidate.patch.scripts ?? {};
  for (const [scriptId, script] of Object.entries(patchScripts)) {
    const key = `scripts.${scriptId}`;
    if (base.scripts && Object.hasOwn(base.scripts, scriptId)) {
      setOutcome(items, key, `Paseo already has a "${scriptId}" script.`);
      continue;
    }
    merged.scripts = { ...merged.scripts, [scriptId]: script };
    importedCount += 1;
  }

  return {
    repoRoot: input.repoRoot,
    source: input.source,
    status: importedCount > 0 ? "available" : "nothing_to_import",
    sourceRevision: input.candidate.sourceRevision,
    paseoRevision: input.paseoRevision,
    inputs: input.candidate.inputs,
    items,
    preview: importedCount > 0 ? merged : null,
  };
}

function hasLifecycle(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === "string" && entry.trim().length > 0);
  }
  return false;
}

function setOutcome(items: ProjectConfigImportPreview["items"], key: string, detail: string): void {
  const item = items.find((entry) => entry.key === key);
  if (!item) {
    items.push({
      key,
      label: key,
      outcome: "collision",
      detail,
    });
    return;
  }
  item.outcome = "collision";
  item.detail = detail;
}
