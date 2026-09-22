import { buildStatusGroups, type StatusGroup } from "@/hooks/sidebar-status-view-model";
import {
  applyWorkspaceLocalPins,
  splitPinnedSidebarGroups,
  type PinnedSidebarGroups,
  type PinnedSidebarKeys,
} from "@/hooks/use-sidebar-pins";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";
import {
  buildSidebarShortcutSections,
  type SidebarShortcutModel,
  type SidebarShortcutSection,
} from "@/utils/sidebar-shortcuts";

export interface SidebarProjection {
  pinnedGroups: PinnedSidebarGroups;
  projects: SidebarProjectEntry[];
  statusGroups: StatusGroup[];
  shortcutModel: SidebarShortcutModel;
}

export function buildSidebarProjection(input: {
  projects: SidebarProjectEntry[];
  pinnedKeys: PinnedSidebarKeys;
  projectPinnedKeys: PinnedSidebarKeys;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectNamesByKey: Map<string, string>;
  groupMode: SidebarGroupMode;
  pinnedCollapsed: boolean;
  collapsedProjectKeys: ReadonlySet<string>;
  collapsedStatusGroupKeys: ReadonlySet<string>;
}): SidebarProjection {
  const globallyPinned = splitPinnedSidebarGroups({
    projects: input.projects,
    keys: input.pinnedKeys,
  });
  const projects = applyWorkspaceLocalPins({
    projects: globallyPinned.unpinnedProjects,
    keys: input.projectPinnedKeys,
  });
  const pinnedWorkspaceKeys = new Set(input.pinnedKeys.pinnedWorkspaceKeys);
  const statusGroups =
    input.groupMode === "status"
      ? buildStatusGroups(
          Array.from(input.workspaceEntriesByKey.values()).filter(
            (workspace) => !pinnedWorkspaceKeys.has(workspace.workspaceKey),
          ),
          input.projectNamesByKey,
        )
      : [];

  const sections: SidebarShortcutSection[] = [];
  if (!input.pinnedCollapsed) {
    sections.push({ workspaces: globallyPinned.pinnedChats });
  }
  if (input.groupMode === "status") {
    sections.push(
      ...statusGroups.map((group) => ({
        workspaces: group.rows,
        collapsed: input.collapsedStatusGroupKeys.has(group.bucket),
      })),
    );
  } else {
    sections.push(
      ...projects.map((project) => ({
        workspaces: project.workspaces,
        collapsed: input.collapsedProjectKeys.has(project.projectKey),
      })),
    );
  }

  return {
    pinnedGroups: {
      pinnedChats: globallyPinned.pinnedChats,
      unpinnedProjects: projects,
    },
    projects,
    statusGroups,
    shortcutModel: buildSidebarShortcutSections({ sections }),
  };
}
