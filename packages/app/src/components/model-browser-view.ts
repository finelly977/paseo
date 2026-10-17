import {
  filterAndRankModelRows,
  getAllProviderModelRows,
  type ProviderSelectionModelRow,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";

export type ModelBrowserView =
  | { kind: "all" }
  | { kind: "provider"; providerId: string; providerLabel: string };

export function resolveModelBrowserScrolling({
  isNative,
  isCompact,
}: {
  isNative: boolean;
  isCompact: boolean;
}): "sheet" | "independent" {
  return isNative && isCompact ? "sheet" : "independent";
}

/** What the root view shows: the provider drill-down, or ranked cross-provider results. */
export type ModelBrowserAllView =
  | { kind: "browse" }
  | { kind: "searchResults"; rows: ProviderSelectionModelRow[] }
  | { kind: "noSearchMatches" };

export function resolveModelBrowserAllView({
  providers,
  normalizedQuery,
}: {
  providers: ProviderSelectorProvider[];
  normalizedQuery: string;
}): ModelBrowserAllView {
  if (!normalizedQuery) {
    return { kind: "browse" };
  }
  const rows = filterAndRankModelRows(getAllProviderModelRows(providers), normalizedQuery);
  if (rows.length === 0) {
    return { kind: "noSearchMatches" };
  }
  return { kind: "searchResults", rows };
}

/** 已选择智能体就直达该智能体模型，根页仍可通过返回入口访问。 */
export function resolveInitialModelBrowserView({
  providers,
  selectedProvider,
  hasProfiles,
}: {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  hasProfiles: boolean;
  providerLocked?: boolean;
}): ModelBrowserView {
  const provider = providers.find((entry) => entry.id === selectedProvider);
  if (provider) return { kind: "provider", providerId: provider.id, providerLabel: provider.label };
  if (hasProfiles) {
    return { kind: "all" };
  }

  const singleProvider = providers.length === 1 ? providers[0] : undefined;
  if (singleProvider) {
    return {
      kind: "provider",
      providerId: singleProvider.id,
      providerLabel: singleProvider.label,
    };
  }

  return { kind: "all" };
}

// 少量选项按内容收缩；长列表增加至 400 像素，让更多模型直接可见。
export function resolveCompactModelMenuHeight(modelCount: number, profileCount = 0): number {
  return Math.min(
    400,
    112 + Math.max(modelCount + profileCount, 1) * 40 + (profileCount > 0 ? 24 : 0),
  );
}
