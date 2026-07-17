import { describe, expect, it } from "vitest";
import {
  buildProjectConfigImportCalloutPolicy,
  buildWorktreeSetupCalloutPolicy,
  selectActiveGitWorkspaceProject,
  shouldShowWorktreeSetupCallout,
  type WorktreeSetupWorkspaceInput,
} from "./worktree-setup-callout-policy";

function gitWorkspace(
  overrides: Partial<WorktreeSetupWorkspaceInput> = {},
): WorktreeSetupWorkspaceInput {
  return {
    projectId: "project-1",
    projectKind: "git",
    projectRootPath: "/repo/project-1",
    project: { checkout: { mainRepoRoot: "/repo/main-project-1" } },
    ...overrides,
  };
}

describe("selectActiveGitWorkspaceProject", () => {
  it("selects the active git workspace project from checkout metadata", () => {
    expect(selectActiveGitWorkspaceProject("server-1", gitWorkspace())).toEqual({
      serverId: "server-1",
      projectKey: "project-1",
      repoRoot: "/repo/main-project-1",
    });
  });

  it("falls back to the workspace project root when checkout metadata has no main root", () => {
    expect(
      selectActiveGitWorkspaceProject(
        "server-1",
        gitWorkspace({ project: { checkout: { mainRepoRoot: null } } }),
      ),
    ).toEqual({
      serverId: "server-1",
      projectKey: "project-1",
      repoRoot: "/repo/project-1",
    });
  });

  it("ignores non-git workspaces and blank project coordinates", () => {
    expect(
      selectActiveGitWorkspaceProject("server-1", gitWorkspace({ projectKind: "local" })),
    ).toBe(null);
    expect(selectActiveGitWorkspaceProject("server-1", gitWorkspace({ projectId: " " }))).toBe(
      null,
    );
    expect(
      selectActiveGitWorkspaceProject(
        "server-1",
        gitWorkspace({ projectRootPath: " ", project: null }),
      ),
    ).toBe(null);
  });
});

describe("shouldShowWorktreeSetupCallout", () => {
  it("shows the callout when paseo config was read and setup commands are missing", () => {
    expect(shouldShowWorktreeSetupCallout({ ok: true, config: {} })).toBe(true);
    expect(shouldShowWorktreeSetupCallout({ ok: true, config: null })).toBe(true);
  });

  it("does not show the callout when setup commands are present", () => {
    expect(
      shouldShowWorktreeSetupCallout({ ok: true, config: { worktree: { setup: "npm install" } } }),
    ).toBe(false);
    expect(
      shouldShowWorktreeSetupCallout({
        ok: true,
        config: { worktree: { setup: [" ", "npm install"] } },
      }),
    ).toBe(false);
  });

  it("does not show the callout when reading paseo config fails or has not completed", () => {
    expect(shouldShowWorktreeSetupCallout(undefined)).toBe(false);
    expect(shouldShowWorktreeSetupCallout({ ok: false })).toBe(false);
  });
});

describe("buildWorktreeSetupCalloutPolicy", () => {
  it("builds the stable sidebar callout identity and action route", () => {
    expect(
      buildWorktreeSetupCalloutPolicy({
        serverId: "server-1",
        projectKey: "project-1",
        repoRoot: "/repo/project-1",
      }),
    ).toEqual({
      id: "worktree-setup-missing:project-1",
      dismissalKey: "worktree-setup-missing:project-1",
      priority: 100,
      title: "Set up worktree scripts",
      description:
        "Add setup commands so new worktrees can install dependencies and prepare themselves automatically.",
      actionLabel: "Open project settings",
      projectSettingsRoute: "/settings/projects/project-1",
      testID: "worktree-setup-callout-project-1",
    });
  });

  it("builds a host-bound import route with a single-use intent", () => {
    expect(
      buildProjectConfigImportCalloutPolicy(
        {
          serverId: "server-1",
          projectKey: "remote:github.com/acme/app",
          repoRoot: "/repo/project-1",
        },
        {
          status: "one",
          sourceDisplayName: "Fake Source",
          sourceRouteValue: "fake",
          intentId: "intent-1",
        },
      ),
    ).toEqual({
      id: "worktree-setup-missing:remote:github.com/acme/app",
      dismissalKey: "worktree-setup-missing:remote:github.com/acme/app",
      priority: 100,
      title: "Fake Source setup found",
      description: "Import workspace setup and run scripts from Fake Source.",
      actionLabel: "Review migration",
      projectSettingsRoute:
        "/settings/projects/remote%3Agithub.com%2Facme%2Fapp?importSource=fake&importServerId=server-1&importIntentId=intent-1",
      testID: "worktree-setup-callout-remote:github.com/acme/app",
    });
  });

  it("routes many import sources to project settings without selecting a source", () => {
    expect(
      buildProjectConfigImportCalloutPolicy(
        {
          serverId: "server-1",
          projectKey: "remote:github.com/acme/app",
          repoRoot: "/repo/project-1",
        },
        { status: "many" },
      ),
    ).toMatchObject({
      title: "Project setup imports found",
      description: "Review available project setup imports in Project Settings.",
      projectSettingsRoute: "/settings/projects/remote%3Agithub.com%2Facme%2Fapp",
    });
  });
});
