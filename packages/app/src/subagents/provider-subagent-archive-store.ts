import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface ProviderSubagentArchiveState {
  hiddenFromTrack: Set<string>;
  hide(keys: readonly string[]): void;
  reveal(key: string): void;
}

interface PersistedProviderSubagentArchiveState {
  hiddenFromTrack: string[];
}

const PersistedProviderSubagentArchiveStateSchema = z.strictObject({
  hiddenFromTrack: z.array(z.string().min(1)),
});

export function createProviderSubagentArchiveStore(backingStorage: StateStorage) {
  return create<ProviderSubagentArchiveState>()(
    persist<ProviderSubagentArchiveState, [], [], PersistedProviderSubagentArchiveState>(
      (set) => ({
        hiddenFromTrack: new Set(),
        hide: (keys) => {
          if (keys.length === 0) return;
          set((state) => {
            const hiddenFromTrack = new Set(state.hiddenFromTrack);
            for (const key of keys) {
              if (!key) throw new Error("归档提供方子智能体需要有效标识");
              hiddenFromTrack.add(key);
            }
            return { hiddenFromTrack };
          });
        },
        reveal: (key) => {
          if (!key) throw new Error("恢复提供方子智能体需要有效标识");
          set((state) => {
            if (!state.hiddenFromTrack.has(key)) return state;
            const hiddenFromTrack = new Set(state.hiddenFromTrack);
            hiddenFromTrack.delete(key);
            return { hiddenFromTrack };
          });
        },
      }),
      {
        name: "provider-subagent-track-archive",
        version: 1,
        storage: createValidatedPersistStorage(
          backingStorage,
          PersistedProviderSubagentArchiveStateSchema,
        ),
        partialize: (state) => ({ hiddenFromTrack: [...state.hiddenFromTrack] }),
        merge: (persisted, current) => {
          const restored = PersistedProviderSubagentArchiveStateSchema.parse(persisted);
          return {
            ...current,
            hiddenFromTrack: new Set(restored.hiddenFromTrack),
          };
        },
      },
    ),
  );
}

export const useProviderSubagentArchiveStore = createProviderSubagentArchiveStore(AsyncStorage);
