import { isDeepStrictEqual } from "node:util";
import type { PaseoConfigRaw } from "@getpaseo/protocol/messages";
import type {
  MigrationInventory,
  MigrationNotice,
  MigrationOutput,
  MigrationProject,
  MigrationSource,
  MigrationWorkspace,
  PaseoMigrationPort,
} from "./types.js";

export interface MigrationResult {
  inventory: MigrationInventory;
  notices: MigrationNotice[];
}

interface MigrationStats {
  configs: number;
  adopted: number;
  created: number;
  existing: number;
}

interface MigrationContext {
  paseo: PaseoMigrationPort;
  dryRun: boolean;
  output: MigrationOutput;
  stats: MigrationStats;
  emitNotice(notice: MigrationNotice): void;
}

export async function migrate(input: {
  source: MigrationSource;
  paseo: PaseoMigrationPort;
  dryRun: boolean;
  output: MigrationOutput;
}): Promise<MigrationResult> {
  const inventory = await input.source.inspect();
  const notices: MigrationNotice[] = [];
  const stats: MigrationStats = { configs: 0, adopted: 0, created: 0, existing: 0 };
  const emitNotice = (notice: MigrationNotice) => {
    notices.push(notice);
    input.output(notice);
  };
  input.output({
    level: "info",
    message: `${input.dryRun ? "Dry-run plan" : "Migration"}: ${inventory.projects.length} project(s) discovered.`,
  });
  for (const notice of inventory.skippedSettings) emitNotice(notice);

  const context: MigrationContext = { ...input, stats, emitNotice };
  for (const project of inventory.projects) await migrateProject(project, context);

  const errors = notices.filter((notice) => notice.level === "error").length;
  input.output({
    level: errors > 0 ? "error" : "info",
    message: `${input.dryRun ? "Dry-run" : "Migration"} summary: ${inventory.projects.length} project(s), ${stats.configs} config update(s), ${stats.adopted} adopted, ${stats.created} recreated, ${stats.existing} already present, ${notices.length} notice(s), ${errors} error(s).`,
  });
  return { inventory, notices };
}

async function migrateProject(project: MigrationProject, context: MigrationContext): Promise<void> {
  for (const notice of project.notices) context.emitNotice(notice);
  let config = project.config;
  if (context.dryRun) planProject(project, context);
  else {
    const appliedConfig = await applyProject(project, context);
    if (!appliedConfig) return;
    config = appliedConfig;
  }
  await migrateWorkspaces(project, config, context);
}

function planProject(project: MigrationProject, context: MigrationContext): void {
  context.output({ level: "info", message: `Would register project ${project.rootPath}.` });
  if (!project.config) return;
  context.stats.configs += 1;
  context.output({
    level: "info",
    message: `Would merge supported project config for ${project.rootPath}.`,
  });
}

async function applyProject(
  project: MigrationProject,
  context: MigrationContext,
): Promise<PaseoConfigRaw | null> {
  try {
    await context.paseo.addProject(project.rootPath);
    context.output({ level: "info", message: `Registered project ${project.rootPath}.` });
  } catch (error) {
    context.emitNotice(applyFailure("project-apply-failed", project.rootPath, error));
    return null;
  }
  try {
    return await applyConfig(project.rootPath, project.config, context);
  } catch (error) {
    context.emitNotice(applyFailure("project-config-apply-failed", project.rootPath, error));
    return project.config ?? {};
  }
}

async function migrateWorkspaces(
  project: MigrationProject,
  config: PaseoConfigRaw | null,
  context: MigrationContext,
): Promise<void> {
  for (const workspace of project.workspaces) {
    for (const notice of workspace.notices) context.emitNotice(notice);
    if (context.dryRun) planWorkspace(project, workspace, context);
    else await applyWorkspace(project, config, workspace, context);
  }
}

function planWorkspace(
  project: MigrationProject,
  workspace: MigrationWorkspace,
  context: MigrationContext,
): void {
  if (workspace.disposition === "adopt" && workspace.path) {
    context.stats.adopted += 1;
    context.output({ level: "info", message: `Would adopt worktree ${workspace.path}.` });
    if (project.config) {
      context.stats.configs += 1;
      context.output({
        level: "info",
        message: `Would merge supported project config for ${workspace.path}.`,
      });
    }
  } else if (workspace.disposition === "create" && workspace.branch) {
    context.stats.created += 1;
    context.output({
      level: "info",
      message: `Would ensure branch ${workspace.branch} at checkout ${workspace.directoryName}.`,
    });
  }
}

async function applyWorkspace(
  project: MigrationProject,
  config: PaseoConfigRaw | null,
  workspace: MigrationWorkspace,
  context: MigrationContext,
): Promise<void> {
  try {
    if (workspace.disposition === "adopt" && workspace.path) {
      await context.paseo.openCheckout(workspace.path);
      await applyConfig(workspace.path, config, context);
      context.stats.adopted += 1;
      context.output({ level: "info", message: `Adopted worktree ${workspace.path}.` });
    } else if (workspace.disposition === "create" && workspace.branch) {
      const ensured = await context.paseo.ensureCheckout({
        rootPath: project.rootPath,
        refName: workspace.branch,
        directoryName: workspace.directoryName,
      });
      context.stats[ensured.created ? "created" : "existing"] += 1;
      context.output({
        level: "info",
        message: ensured.created
          ? `Recreated worktree ${ensured.path} from ${workspace.branch}.`
          : `Worktree ${ensured.path} already exists for ${workspace.branch}.`,
      });
    }
  } catch (error) {
    context.emitNotice(applyFailure("workspace-apply-failed", workspace.sourceId, error));
  }
}

async function applyConfig(
  rootPath: string,
  imported: PaseoConfigRaw | null,
  context: MigrationContext,
): Promise<PaseoConfigRaw> {
  const current = await context.paseo.readProjectConfig(rootPath);
  const merged = mergeExistingConfig(imported, current.config);
  if (isDeepStrictEqual(merged, current.config ?? {})) {
    context.output({ level: "info", message: `Project config already current for ${rootPath}.` });
    return current.config ?? {};
  }
  await context.paseo.writeProjectConfig({
    rootPath,
    config: merged,
    expectedRevision: current.revision,
  });
  context.stats.configs += 1;
  context.output({ level: "info", message: `Updated project config for ${rootPath}.` });
  return merged;
}

export function mergeExistingConfig(
  imported: PaseoConfigRaw | null,
  existing: PaseoConfigRaw | null,
): PaseoConfigRaw {
  const merged = mergeRecords(imported ?? {}, existing ?? {});
  if (isRecord(imported?.scripts) && isRecord(existing?.scripts)) {
    merged.scripts = { ...imported.scripts, ...existing.scripts };
  }
  return merged as PaseoConfigRaw;
}

function mergeRecords(base: Record<string, unknown>, override: Record<string, unknown>) {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = merged[key];
    merged[key] = isRecord(baseValue) && isRecord(value) ? mergeRecords(baseValue, value) : value;
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function applyFailure(code: string, subject: string, error: unknown): MigrationNotice {
  return { code, level: "error", message: `${subject}: ${errorMessage(error)}` };
}
