import { buildStatusGroups, type StatusGroup } from "@/hooks/sidebar-status-view-model";
import { applyWorkspaceLocalPins, type PinnedSidebarKeys } from "@/hooks/use-sidebar-pins";
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
  projects: SidebarProjectEntry[];
  statusGroups: StatusGroup[];
  shortcutModel: SidebarShortcutModel;
}

export function buildSidebarProjection(input: {
  projects: SidebarProjectEntry[];
  pinnedKeys: PinnedSidebarKeys;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectNamesByKey: Map<string, string>;
  groupMode: SidebarGroupMode;
  collapsedProjectKeys: ReadonlySet<string>;
  collapsedStatusGroupKeys: ReadonlySet<string>;
}): SidebarProjection {
  const projects = applyWorkspaceLocalPins({
    projects: input.projects,
    keys: input.pinnedKeys,
  });
  const statusGroups =
    input.groupMode === "status"
      ? buildStatusGroups(Array.from(input.workspaceEntriesByKey.values()), input.projectNamesByKey)
      : [];

  const sections: SidebarShortcutSection[] = [];
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
    projects,
    statusGroups,
    shortcutModel: buildSidebarShortcutSections({ sections }),
  };
}
