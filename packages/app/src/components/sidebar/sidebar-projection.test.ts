import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { buildSidebarProjection } from "./sidebar-projection";

function makeWorkspace(id: string, statusBucket: SidebarWorkspaceEntry["statusBucket"] = "done") {
  const placement: SidebarWorkspacePlacement = {
    workspaceKey: `srv:${id}`,
    serverId: "srv",
    workspaceId: id,
    projectKey: "project",
    projectName: "Project",
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
  };
  const entry: SidebarWorkspaceEntry = {
    ...placement,
    providerSessionId: null,
    agentProvider: null,
    title: null,
    currentBranch: null,
    statusBucket,
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
  };
  return { placement, entry };
}

function makeProject(workspaces: SidebarWorkspacePlacement[]): SidebarProjectEntry {
  return {
    projectKey: "project",
    projectName: "Project",
    projectKind: "git",
    iconWorkingDir: "/repo",
    hosts: [
      {
        serverId: "srv",
        projectId: "project",
        iconWorkingDir: "/repo",
        canCreateWorktree: true,
      },
    ],
    workspaces,
  };
}

function projectionInput(options?: { groupMode?: "project" | "status" }) {
  const pinned = makeWorkspace("pinned", "running");
  const unpinned = makeWorkspace("unpinned", "needs_input");
  pinned.entry.pinnedAt = "2026-07-12T12:00:00.000Z";
  return {
    projects: [makeProject([pinned.placement, unpinned.placement])],
    pinnedKeys: {
      pinnedWorkspaceKeys: [pinned.placement.workspaceKey],
      pinnedAtByKey: {
        [pinned.placement.workspaceKey]: "2026-07-12T12:00:00.000Z",
      },
    },
    workspaceEntriesByKey: new Map([
      [pinned.entry.workspaceKey, pinned.entry],
      [unpinned.entry.workspaceKey, unpinned.entry],
    ]),
    projectNamesByKey: new Map([["project", "Project"]]),
    groupMode: options?.groupMode ?? ("project" as const),
    collapsedProjectKeys: new Set<string>(),
    collapsedStatusGroupKeys: new Set<string>(),
  };
}

describe("buildSidebarProjection", () => {
  it("把置顶会话保留在原工作区内并用同一顺序生成快捷键", () => {
    const projection = buildSidebarProjection(projectionInput());

    expect(projection.projects[0]?.workspaces.map((entry) => entry.workspaceId)).toEqual([
      "pinned",
      "unpinned",
    ]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("状态视图中置顶会话仍留在它自己的状态分组", () => {
    const projection = buildSidebarProjection(projectionInput({ groupMode: "status" }));

    expect(projection.statusGroups.map((group) => group.bucket)).toEqual([
      "needs_input",
      "running",
    ]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "unpinned" },
      { serverId: "srv", workspaceId: "pinned" },
    ]);
  });
});
