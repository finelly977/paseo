import { z } from "zod";
import type { ProviderSelectionModelRow } from "@/provider-selection/provider-selection";

export const ModelLibraryPreferencesSchema = z.object({
  favorites: z.array(z.string()),
  order: z.array(z.string()),
});
export type ModelLibraryPreferences = z.infer<typeof ModelLibraryPreferencesSchema>;
export const EMPTY_MODEL_LIBRARY: ModelLibraryPreferences = { favorites: [], order: [] };

export function orderModelRows(
  rows: readonly ProviderSelectionModelRow[],
  preferences: ModelLibraryPreferences,
): ProviderSelectionModelRow[] {
  const favorites = new Set(preferences.favorites);
  const positions = new Map(preferences.order.map((key, index) => [key, index]));
  return [...rows].sort((a, b) => {
    const favoriteDifference =
      Number(favorites.has(b.favoriteKey)) - Number(favorites.has(a.favoriteKey));
    if (favoriteDifference) return favoriteDifference;
    // 未调整过的模型沿用提供方目录顺序，排在已有自定义顺序之后。
    return (
      (positions.get(a.favoriteKey) ?? preferences.order.length) -
      (positions.get(b.favoriteKey) ?? preferences.order.length)
    );
  });
}

export function toggleFavoriteModel(
  preferences: ModelLibraryPreferences,
  key: string,
): ModelLibraryPreferences {
  const favorites = preferences.favorites.includes(key)
    ? preferences.favorites.filter((entry) => entry !== key)
    : [...preferences.favorites, key];
  return { ...preferences, favorites };
}

export function reorderVisibleModels(
  preferences: ModelLibraryPreferences,
  catalog: readonly ProviderSelectionModelRow[],
  visible: readonly ProviderSelectionModelRow[],
): ModelLibraryPreferences {
  const visibleKeys = new Set(visible.map((row) => row.favoriteKey));
  if (visibleKeys.size !== visible.length) throw new Error("Duplicate model in reordered list");
  const favorites = new Set(preferences.favorites);
  const reordered = [
    ...visible.filter((row) => favorites.has(row.favoriteKey)),
    ...visible.filter((row) => !favorites.has(row.favoriteKey)),
  ];
  let index = 0;
  const ordered = orderModelRows(catalog, preferences).map((row) => {
    if (!visibleKeys.has(row.favoriteKey)) return row.favoriteKey;
    return reordered[index++].favoriteKey;
  });
  if (index !== visible.length) throw new Error("Reordered model is absent from catalog");
  const catalogKeys = new Set(ordered);
  return {
    ...preferences,
    order: [...ordered, ...preferences.order.filter((key) => !catalogKeys.has(key))],
  };
}

export interface ModelLibraryStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
export const modelLibraryStorageKey = (serverId: string) => `@paseo:model-library:${serverId}`;

export async function readModelLibrary(
  storage: ModelLibraryStorage,
  serverId: string,
): Promise<ModelLibraryPreferences> {
  const raw = await storage.getItem(modelLibraryStorageKey(serverId));
  return raw === null ? EMPTY_MODEL_LIBRARY : ModelLibraryPreferencesSchema.parse(JSON.parse(raw));
}

export async function updateModelLibrary(
  storage: ModelLibraryStorage,
  serverId: string,
  update: (current: ModelLibraryPreferences) => ModelLibraryPreferences,
): Promise<ModelLibraryPreferences> {
  const current = await readModelLibrary(storage, serverId);
  const next = ModelLibraryPreferencesSchema.parse(update(current));
  await storage.setItem(modelLibraryStorageKey(serverId), JSON.stringify(next));
  return next;
}
