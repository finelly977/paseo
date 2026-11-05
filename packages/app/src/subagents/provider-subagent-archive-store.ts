import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface ProviderSubagentArchiveState {
  hiddenFromTrack: Set<string>;
  hiddenRunIdByKey: Record<string, string | null>;
  hydrated: boolean;
  hide(entries: readonly ProviderSubagentArchiveEntry[]): void;
  observe(entry: ProviderSubagentArchiveEntry): void;
  markHydrated(): void;
}

interface ProviderSubagentArchiveEntry {
  key: string;
  runId: string | null;
}

const LegacyProviderSubagentArchiveStateSchema = z.strictObject({
  hiddenFromTrack: z.array(z.string().min(1)),
});
const PersistedProviderSubagentArchiveStateSchema = z.strictObject({
  hiddenRunIdByKey: z.record(z.string().min(1), z.string().min(1).nullable()),
});
const StoredProviderSubagentArchiveStateSchema = z.union([
  LegacyProviderSubagentArchiveStateSchema,
  PersistedProviderSubagentArchiveStateSchema,
]);
type PersistedProviderSubagentArchiveState = z.infer<
  typeof PersistedProviderSubagentArchiveStateSchema
>;
type StoredProviderSubagentArchiveState = z.infer<typeof StoredProviderSubagentArchiveStateSchema>;

function normalizePersistedState(
  persisted: StoredProviderSubagentArchiveState,
): PersistedProviderSubagentArchiveState {
  if ("hiddenRunIdByKey" in persisted) return persisted;
  return {
    hiddenRunIdByKey: Object.fromEntries(persisted.hiddenFromTrack.map((key) => [key, null])),
  };
}

function hasHiddenEntry(state: ProviderSubagentArchiveState, key: string): boolean {
  return Object.hasOwn(state.hiddenRunIdByKey, key);
}

export function createProviderSubagentArchiveStore(backingStorage: StateStorage) {
  return create<ProviderSubagentArchiveState>()(
    persist<ProviderSubagentArchiveState, [], [], StoredProviderSubagentArchiveState>(
      (set) => ({
        hiddenFromTrack: new Set(),
        hiddenRunIdByKey: {},
        hydrated: false,
        hide: (entries) => {
          if (entries.length === 0) return;
          set((state) => {
            const hiddenRunIdByKey = { ...state.hiddenRunIdByKey };
            for (const entry of entries) {
              if (!entry.key) throw new Error("归档提供方子智能体需要有效标识");
              hiddenRunIdByKey[entry.key] = entry.runId;
            }
            return {
              hiddenRunIdByKey,
              hiddenFromTrack: new Set(Object.keys(hiddenRunIdByKey)),
            };
          });
        },
        observe: (entry) => {
          if (!entry.key) throw new Error("核对子智能体归档状态需要有效标识");
          set((state) => {
            if (!hasHiddenEntry(state, entry.key)) return state;
            if (entry.runId === null) return state;
            const hiddenRunId = state.hiddenRunIdByKey[entry.key];
            if (hiddenRunId === null) {
              return {
                hiddenRunIdByKey: {
                  ...state.hiddenRunIdByKey,
                  [entry.key]: entry.runId,
                },
              };
            }
            if (entry.runId === hiddenRunId) return state;

            const hiddenRunIdByKey = { ...state.hiddenRunIdByKey };
            delete hiddenRunIdByKey[entry.key];
            const hiddenFromTrack = new Set(state.hiddenFromTrack);
            hiddenFromTrack.delete(entry.key);
            return { hiddenRunIdByKey, hiddenFromTrack };
          });
        },
        markHydrated: () => set({ hydrated: true }),
      }),
      {
        name: "provider-subagent-track-archive",
        version: 2,
        storage: createValidatedPersistStorage(
          backingStorage,
          StoredProviderSubagentArchiveStateSchema,
        ),
        partialize: (state) => ({ hiddenRunIdByKey: state.hiddenRunIdByKey }),
        migrate: (persisted) =>
          normalizePersistedState(StoredProviderSubagentArchiveStateSchema.parse(persisted)),
        merge: (persisted, current) => {
          if (persisted === undefined) return current;
          const restored = normalizePersistedState(
            StoredProviderSubagentArchiveStateSchema.parse(persisted),
          );
          return {
            ...current,
            hiddenRunIdByKey: restored.hiddenRunIdByKey,
            hiddenFromTrack: new Set(Object.keys(restored.hiddenRunIdByKey)),
          };
        },
        onRehydrateStorage: () => (state, error) => {
          if (error) {
            console.error("[提供方子智能体] 读取本地归档状态失败", error);
          }
          state?.markHydrated();
        },
      },
    ),
  );
}

export const useProviderSubagentArchiveStore = createProviderSubagentArchiveStore(AsyncStorage);
