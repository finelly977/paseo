import type { PaseoConfigRaw } from "@getpaseo/protocol/messages";
import type { ProjectConfigImportCandidate, ProjectConfigImportPreview } from "./model.js";

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
  if (Object.hasOwn(patchWorktree, "setup")) {
    if (hasLifecycle(base.worktree?.setup)) {
      setOutcome(items, "worktree.setup", "collision", "Paseo already has setup commands.");
    } else {
      merged.worktree = { ...merged.worktree, setup: patchWorktree.setup };
      importedCount += 1;
    }
  }
  if (Object.hasOwn(patchWorktree, "teardown")) {
    if (hasLifecycle(base.worktree?.teardown)) {
      setOutcome(items, "worktree.teardown", "collision", "Paseo already has teardown commands.");
    } else {
      merged.worktree = { ...merged.worktree, teardown: patchWorktree.teardown };
      importedCount += 1;
    }
  }

  const patchScripts = input.candidate.patch.scripts ?? {};
  for (const [scriptId, script] of Object.entries(patchScripts)) {
    const key = `scripts.${scriptId}`;
    if (base.scripts && Object.hasOwn(base.scripts, scriptId)) {
      setOutcome(items, key, "collision", `Paseo already has a "${scriptId}" script.`);
      continue;
    }
    merged.scripts = { ...merged.scripts, [scriptId]: script };
    importedCount += 1;
  }

  return {
    repoRoot: input.repoRoot,
    source: input.candidate.source,
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

function setOutcome(
  items: ProjectConfigImportPreview["items"],
  key: string,
  outcome: "collision",
  detail: string,
): void {
  const item = items.find((entry) => entry.key === key);
  if (!item) {
    items.push({
      key,
      label: key,
      outcome,
      detail,
    });
    return;
  }
  item.outcome = outcome;
  item.detail = detail;
}
