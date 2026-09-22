import { useMemo, useRef } from "react";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type {
  SidebarProjectEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSessionStore } from "@/stores/session-store";
import { useSidebarWorkspacePinStore } from "@/stores/sidebar-workspace-pin-store";

export interface PinnedSidebarKeys {
  pinnedWorkspaceKeys: string[];
  // workspaceKey -> pinnedAt ISO string, used to order by recency.
  pinnedAtByKey: Record<string, string>;
}

export interface PinnedSidebarGroups {
  pinnedChats: SidebarWorkspacePlacement[];
  unpinnedProjects: SidebarProjectEntry[];
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

export function useProjectPinnedSidebarKeys(projects: SidebarProjectEntry[]): PinnedSidebarKeys {
  const pinnedAtByWorkspaceKey = useSidebarWorkspacePinStore(
    (state) => state.projectPinnedAtByWorkspaceKey,
  );
  return useMemo(() => {
    const pinnedWorkspaceKeys: string[] = [];
    const pinnedAtByKey: Record<string, string> = {};
    for (const project of projects) {
      for (const workspace of project.workspaces) {
        const pinnedAt = pinnedAtByWorkspaceKey[workspace.workspaceKey];
        if (!pinnedAt) continue;
        pinnedWorkspaceKeys.push(workspace.workspaceKey);
        pinnedAtByKey[workspace.workspaceKey] = pinnedAt;
      }
    }
    return { pinnedWorkspaceKeys, pinnedAtByKey };
  }, [pinnedAtByWorkspaceKey, projects]);
}

export function splitPinnedSidebarGroups(input: {
  projects: SidebarProjectEntry[];
  keys: PinnedSidebarKeys;
}): PinnedSidebarGroups {
  const { projects, keys } = input;
  if (keys.pinnedWorkspaceKeys.length === 0) {
    return { pinnedChats: [], unpinnedProjects: projects };
  }
  const pinnedWorkspaceKeySet = new Set(keys.pinnedWorkspaceKeys);
  const pinnedChats: SidebarWorkspacePlacement[] = [];
  const unpinnedProjects: SidebarProjectEntry[] = [];

  for (const project of projects) {
    const remainingWorkspaces: SidebarWorkspacePlacement[] = [];
    for (const workspace of project.workspaces) {
      if (pinnedWorkspaceKeySet.has(workspace.workspaceKey)) {
        pinnedChats.push(workspace);
      } else {
        remainingWorkspaces.push(workspace);
      }
    }
    unpinnedProjects.push(
      remainingWorkspaces.length === project.workspaces.length
        ? project
        : { ...project, workspaces: remainingWorkspaces },
    );
  }

  pinnedChats.sort((left, right) =>
    (keys.pinnedAtByKey[right.workspaceKey] ?? "").localeCompare(
      keys.pinnedAtByKey[left.workspaceKey] ?? "",
    ),
  );
  return { pinnedChats, unpinnedProjects };
}

// 工作区内置顶不会改变所属项目，只在项目内部按最近置顶时间提前。
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
