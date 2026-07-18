import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { MigrationNotice, MigrationProject, MigrationWorkspace } from "../../types.js";
import type {
  ConductorCatalog,
  ConductorRepoRecord,
  ConductorWorkspaceRecord,
} from "./database.js";
import {
  inspectConductorProjectConfig,
  InvalidConductorProjectConfigError,
} from "./project-config.js";

export function inspectCatalog(catalog: ConductorCatalog): {
  projects: MigrationProject[];
  skippedSettings: MigrationNotice[];
} {
  const projects: MigrationProject[] = [];
  const skippedSettings: MigrationNotice[] = [];
  const workspacesByRepo = new Map<string, ConductorWorkspaceRecord[]>();
  for (const workspace of catalog.workspaces) {
    const workspaces = workspacesByRepo.get(workspace.repoId) ?? [];
    workspaces.push(workspace);
    workspacesByRepo.set(workspace.repoId, workspaces);
  }

  for (const repo of catalog.repos) {
    if (repo.hidden) {
      skippedSettings.push(
        notice("hidden-project", `Skipped hidden project ${repo.name ?? repo.id}.`),
      );
      continue;
    }
    if (!isGitRepository(repo.rootPath)) {
      skippedSettings.push(
        notice(
          "invalid-project",
          `Skipped ${repo.rootPath}: path is missing or is not a Git repository.`,
        ),
      );
      continue;
    }
    let projectConfig: ReturnType<typeof inspectConductorProjectConfig>;
    try {
      projectConfig = inspectConductorProjectConfig(repo.rootPath, repo.databaseSettings);
    } catch (error) {
      const detail = invalidConfigDetail(error);
      projectConfig = {
        config: null,
        notices: [
          notice(
            "malformed-project-config",
            `Skipped project config for ${repo.rootPath}: unable to read or parse ${detail}.`,
          ),
        ],
      };
    }
    projects.push({
      sourceId: repo.id,
      rootPath: realpathSync(repo.rootPath),
      config: projectConfig.config,
      notices: [...repo.notices, ...projectConfig.notices],
      workspaces: (workspacesByRepo.get(repo.id) ?? []).map((workspace) =>
        inspectWorkspace(repo, workspace),
      ),
    });
  }
  return { projects, skippedSettings };
}

function invalidConfigDetail(error: unknown): string {
  if (error instanceof InvalidConductorProjectConfigError) return error.relativePath;
  if (error instanceof Error) return error.message;
  return String(error);
}

function inspectWorkspace(
  repo: ConductorRepoRecord,
  workspace: ConductorWorkspaceRecord,
): MigrationWorkspace {
  const directoryName = safeDirectoryName(workspace);
  if (workspace.state === "archived") {
    return {
      sourceId: workspace.id,
      state: "archived",
      path: workspace.path,
      branch: workspace.branch,
      archiveCommit: workspace.archiveCommit,
      directoryName,
      disposition: "archived",
      notices: [notice("archived-workspace", `Skipped archived workspace ${workspace.id}.`)],
    };
  }

  if (workspace.state !== "ready") {
    return {
      sourceId: workspace.id,
      state: workspace.state,
      path: workspace.path,
      branch: workspace.branch,
      archiveCommit: workspace.archiveCommit,
      directoryName,
      disposition: "invalid",
      notices: [
        notice(
          "unknown-workspace-state",
          `Skipped workspace ${workspace.id}: unsupported state "${workspace.state}".`,
        ),
      ],
    };
  }

  if (workspace.path && isDirectory(workspace.path)) {
    const valid = isLinkedWorktree(repo.rootPath, workspace.path);
    return {
      sourceId: workspace.id,
      state: "ready",
      path: workspace.path,
      branch: workspace.branch,
      archiveCommit: workspace.archiveCommit,
      directoryName,
      disposition: valid ? "adopt" : "invalid",
      notices: valid
        ? []
        : [
            notice(
              "invalid-worktree",
              `Skipped ${workspace.path}: not linked to ${repo.rootPath}.`,
            ),
          ],
    };
  }

  if (workspace.branch && refExists(repo.rootPath, workspace.branch)) {
    return {
      sourceId: workspace.id,
      state: "ready",
      path: workspace.path,
      branch: workspace.branch,
      archiveCommit: workspace.archiveCommit,
      directoryName,
      disposition: "create",
      notices: [],
    };
  }

  const recoverable = workspace.archiveCommit && refExists(repo.rootPath, workspace.archiveCommit);
  return {
    sourceId: workspace.id,
    state: "ready",
    path: workspace.path,
    branch: workspace.branch,
    archiveCommit: workspace.archiveCommit,
    directoryName,
    disposition: recoverable ? "recoverable-from-commit" : "missing-ref",
    notices: [
      notice(
        recoverable ? "recoverable-from-commit" : "missing-workspace-ref",
        recoverable
          ? `${workspace.id} can be recovered from commit ${workspace.archiveCommit}; no branch was invented.`
          : `Skipped ${workspace.id}: no usable branch or archive commit exists.`,
      ),
    ],
  };
}

function isGitRepository(rootPath: string): boolean {
  if (!isDirectory(rootPath)) return false;
  try {
    return git(rootPath, ["rev-parse", "--is-inside-work-tree"]) === "true";
  } catch {
    return false;
  }
}

function isLinkedWorktree(rootPath: string, workspacePath: string): boolean {
  try {
    const rootCommon = resolveGitPath(rootPath, git(rootPath, ["rev-parse", "--git-common-dir"]));
    const workspaceCommon = resolveGitPath(
      workspacePath,
      git(workspacePath, ["rev-parse", "--git-common-dir"]),
    );
    return realpathSync(rootCommon) === realpathSync(workspaceCommon);
  } catch {
    return false;
  }
}

function resolveGitPath(cwd: string, value: string): string {
  return path.resolve(cwd, value);
}

function refExists(rootPath: string, ref: string): boolean {
  try {
    git(rootPath, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function safeDirectoryName(workspace: ConductorWorkspaceRecord): string {
  const candidate = workspace.path ? path.basename(workspace.path.replaceAll("\\", "/")) : "";
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(candidate) && candidate !== "." && candidate !== "..") {
    return candidate;
  }
  return `conductor-${workspace.id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32)}`;
}

function isDirectory(target: string): boolean {
  if (!existsSync(target)) return false;
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function notice(code: string, message: string): MigrationNotice {
  return { code, level: "warning", message };
}
