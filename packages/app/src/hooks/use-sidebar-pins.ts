import { useMemo, useRef } from "react";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useSessionStore } from "@/stores/session-store";

export interface PinnedSidebarKeys {
  pinnedWorkspaceKeys: string[];
  // workspaceKey -> pinnedAt ISO string, used to order by recency.
  pinnedAtByKey: Record<string, string>;
}

function buildPinnedSidebarKeys(
  projects: SidebarProjectEntry[],
  workspaceMaps: ReadonlyMap<string, ReadonlyMap<string, { pinnedAt?: string | null }>>,
): PinnedSidebarKeys {
  const pinnedWorkspaceKeys: string[] = [];
  const pinnedAtByKey: Record<string, string> = {};

  for (const project of projects) {
    for (const placement of project.workspaces) {
      const workspace = workspaceMaps.get(placement.serverId)?.get(placement.workspaceId);
      if (workspace?.pinnedAt) {
        pinnedWorkspaceKeys.push(placement.workspaceKey);
        pinnedAtByKey[placement.workspaceKey] = workspace.pinnedAt;
      }
    }
  }
  return { pinnedWorkspaceKeys, pinnedAtByKey };
}

function arePinnedSidebarKeysEqual(left: PinnedSidebarKeys, right: PinnedSidebarKeys): boolean {
  if (left.pinnedWorkspaceKeys.length !== right.pinnedWorkspaceKeys.length) {
    return false;
  }
  for (let index = 0; index < left.pinnedWorkspaceKeys.length; index += 1) {
    const workspaceKey = left.pinnedWorkspaceKeys[index];
    if (
      workspaceKey !== right.pinnedWorkspaceKeys[index] ||
      (workspaceKey && left.pinnedAtByKey[workspaceKey] !== right.pinnedAtByKey[workspaceKey])
    ) {
      return false;
    }
  }
  return true;
}

export function usePinnedSidebarKeys(projects: SidebarProjectEntry[]): PinnedSidebarKeys {
  const previousKeysRef = useRef<PinnedSidebarKeys>({
    pinnedWorkspaceKeys: [],
    pinnedAtByKey: {},
  });
  const serverIds = useMemo(
    () =>
      Array.from(
        new Set(
          projects.flatMap((project) => project.workspaces.map((workspace) => workspace.serverId)),
        ),
      ),
    [projects],
  );
  const workspaceMaps = useStoreWithEqualityFn(
    useSessionStore,
    (state) => serverIds.map((serverId) => state.sessions[serverId]?.workspaces ?? null),
    shallow,
  );
  return useMemo(() => {
    const workspaceMapByServerId = new Map<
      string,
      ReadonlyMap<string, { pinnedAt?: string | null }>
    >();
    for (let index = 0; index < serverIds.length; index += 1) {
      const serverId = serverIds[index];
      const workspaceMap = workspaceMaps[index];
      if (serverId && workspaceMap) {
        workspaceMapByServerId.set(serverId, workspaceMap);
      }
    }
    const nextKeys = buildPinnedSidebarKeys(projects, workspaceMapByServerId);
    if (arePinnedSidebarKeysEqual(previousKeysRef.current, nextKeys)) {
      return previousKeysRef.current;
    }
    previousKeysRef.current = nextKeys;
    return nextKeys;
  }, [projects, serverIds, workspaceMaps]);
}

// 置顶只在会话所属工作区内生效：置顶会话留在原工作区，并按最近
// 置顶时间排在该工作区其他会话之前。不再将它们提升到跨工作区全局分组。
export function applyWorkspaceLocalPins(input: {
  projects: SidebarProjectEntry[];
  keys: PinnedSidebarKeys;
}): SidebarProjectEntry[] {
  const { projects, keys } = input;
  if (keys.pinnedWorkspaceKeys.length === 0) {
    return projects;
  }
  const pinnedWorkspaceKeySet = new Set(keys.pinnedWorkspaceKeys);

  const locallyPinnedProjects: SidebarProjectEntry[] = [];
  for (const project of projects) {
    const hasPinnedWorkspace = project.workspaces.some((workspace) =>
      pinnedWorkspaceKeySet.has(workspace.workspaceKey),
    );
    if (!hasPinnedWorkspace) {
      locallyPinnedProjects.push(project);
      continue;
    }

    const workspaces = [...project.workspaces].sort((left, right) => {
      const leftPinnedAt = keys.pinnedAtByKey[left.workspaceKey] ?? null;
      const rightPinnedAt = keys.pinnedAtByKey[right.workspaceKey] ?? null;
      if (leftPinnedAt && rightPinnedAt) {
        return rightPinnedAt.localeCompare(leftPinnedAt);
      }
      if (leftPinnedAt) return -1;
      if (rightPinnedAt) return 1;
      return 0;
    });
    locallyPinnedProjects.push({ ...project, workspaces });
  }
  return locallyPinnedProjects;
}
