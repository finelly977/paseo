import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface SidebarWorkspacePinStoreState {
  projectPinnedAtByWorkspaceKey: Record<string, string>;
  setProjectPinned: (workspaceKey: string, pinned: boolean) => void;
}

const SidebarWorkspacePinPersistedStateSchema = z.strictObject({
  projectPinnedAtByWorkspaceKey: z.record(z.string(), z.string()).optional(),
});

function normalizeWorkspaceKey(workspaceKey: string): string {
  const normalized = workspaceKey.trim();
  if (!normalized) {
    throw new Error("工作区内置顶需要有效的工作区标识");
  }
  return normalized;
}

export const useSidebarWorkspacePinStore = create<SidebarWorkspacePinStoreState>()(
  persist(
    (set) => ({
      projectPinnedAtByWorkspaceKey: {},
      setProjectPinned: (workspaceKey, pinned) => {
        const normalizedKey = normalizeWorkspaceKey(workspaceKey);
        set((state) => {
          const currentPinnedAt = state.projectPinnedAtByWorkspaceKey[normalizedKey];
          if (pinned) {
            return {
              projectPinnedAtByWorkspaceKey: {
                ...state.projectPinnedAtByWorkspaceKey,
                [normalizedKey]: new Date().toISOString(),
              },
            };
          }
          if (!currentPinnedAt) {
            return state;
          }
          const next = { ...state.projectPinnedAtByWorkspaceKey };
          delete next[normalizedKey];
          return { projectPinnedAtByWorkspaceKey: next };
        });
      },
    }),
    {
      name: "sidebar-workspace-pin-scope",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, SidebarWorkspacePinPersistedStateSchema),
      partialize: (state) => ({
        projectPinnedAtByWorkspaceKey: state.projectPinnedAtByWorkspaceKey,
      }),
      migrate: (persistedState) => {
        const parsed = SidebarWorkspacePinPersistedStateSchema.parse(persistedState ?? {});
        return {
          projectPinnedAtByWorkspaceKey: parsed.projectPinnedAtByWorkspaceKey ?? {},
        };
      },
    },
  ),
);
