import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { randomUUID } from "expo-crypto";
import {
  SidebarGroupsSchema,
  EMPTY_SIDEBAR_GROUPS,
  validateGroupName,
  requireGroup,
  renameGroup,
  removeGroup,
  assignProject,
  reorderGroup,
  type SidebarGroups,
  type ProjectGroup,
} from "./model";

export const SIDEBAR_GROUPS_STORAGE_KEY = "@paseo:sidebar-project-groups";
interface GroupsStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
interface SidebarGroupsDependencies {
  storage: GroupsStorage;
  createId(): string;
}
export interface GroupNameRequest {
  projectKey: string | null;
  group: ProjectGroup | null;
}
interface CreateGroupInput {
  projectKey: string | null;
  name: string;
}
interface RenameGroupInput {
  groupId: string;
  name: string;
}
interface AssignProjectInput {
  projectKey: string;
  groupId: string | null;
}
interface ReorderGroupInput {
  groupId: string;
  offset: -1 | 1;
}
type GroupsLoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; error: Error };
interface SidebarGroupsState {
  dialog: GroupNameRequest | null;
  openDialog(request: GroupNameRequest): void;
  closeDialog(): void;
  data: SidebarGroups;
  loadState: GroupsLoadState;
  pending: number;
  load(): Promise<void>;
  createGroup(input: CreateGroupInput): Promise<void>;
  renameGroup(input: RenameGroupInput): Promise<void>;
  removeGroup(groupId: string): Promise<void>;
  assignProject(input: AssignProjectInput): Promise<void>;
  reorderGroup(input: ReorderGroupInput): Promise<void>;
  toggleCollapsed(groupId: string | null): Promise<void>;
}

export function createSidebarGroupsStore({ storage, createId }: SidebarGroupsDependencies) {
  let reading: Promise<void> | null = null;
  let writing: Promise<void> = Promise.resolve();
  return create<SidebarGroupsState>()((set, get) => {
    function load(): Promise<void> {
      if (get().loadState.status === "ready") return Promise.resolve();
      if (reading) return reading;
      set({ loadState: { status: "loading" } });
      reading = (async () => {
        try {
          const raw = await storage.getItem(SIDEBAR_GROUPS_STORAGE_KEY);
          const data =
            raw === null ? EMPTY_SIDEBAR_GROUPS : SidebarGroupsSchema.parse(JSON.parse(raw));
          set({ data, loadState: { status: "ready" } });
        } catch (error) {
          console.error("[侧栏分组] 读取失败", error);
          const failure =
            error instanceof Error ? error : new Error("分组读取失败", { cause: error });
          set({ loadState: { status: "error", error: failure } });
          throw failure;
        } finally {
          reading = null;
        }
      })();
      return reading;
    }
    function update(change: (data: SidebarGroups) => SidebarGroups): Promise<void> {
      set((state) => ({ pending: state.pending + 1 }));
      const run = async () => {
        try {
          await load();
          const next = change(get().data);
          SidebarGroupsSchema.parse(next);
          await storage.setItem(SIDEBAR_GROUPS_STORAGE_KEY, JSON.stringify(next));
          set({ data: next });
        } catch (error) {
          console.error("[侧栏分组] 保存失败", error);
          throw error;
        } finally {
          set((state) => ({ pending: state.pending - 1 }));
        }
      };
      // 前一次失败不会阻断后续重试；每次操作的错误仍交回对应调用者展示。
      writing = writing.then(run, run);
      return writing;
    }
    return {
      dialog: null,
      openDialog: (dialog) => set({ dialog }),
      closeDialog: () => set({ dialog: null }),
      data: EMPTY_SIDEBAR_GROUPS,
      loadState: { status: "loading" },
      pending: 0,
      load,
      createGroup: ({ projectKey, name }) =>
        update((project) => {
          const error = validateGroupName(project, { value: name, exceptId: null });
          if (error) throw new Error(error);
          const group = { id: createId(), name: name.trim(), collapsed: false };
          const next = { ...project, groups: [...project.groups, group] };
          return projectKey === null
            ? next
            : assignProject(next, { projectKey, groupId: group.id });
        }),
      renameGroup: ({ groupId, name }) =>
        update((project) => renameGroup(project, { groupId, name })),
      removeGroup: (groupId) => update((project) => removeGroup(project, groupId)),
      assignProject: ({ projectKey, groupId }) =>
        update((project) => assignProject(project, { projectKey, groupId })),
      reorderGroup: ({ groupId, offset }) =>
        update((project) => reorderGroup(project, { groupId, offset })),
      toggleCollapsed: (groupId) =>
        update((project) => {
          if (groupId === null)
            return { ...project, ungroupedCollapsed: !project.ungroupedCollapsed };
          const current = requireGroup(project, groupId);
          return {
            ...project,
            groups: project.groups.map((group) =>
              group.id === groupId ? { ...group, collapsed: !current.collapsed } : group,
            ),
          };
        }),
    };
  });
}

export const useSidebarGroupsStore = createSidebarGroupsStore({
  storage: AsyncStorage,
  createId: randomUUID,
});
