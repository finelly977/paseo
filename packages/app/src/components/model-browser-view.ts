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

/** 固定智能体的会话直接显示模型；仍可切换智能体的新会话保留根页配置档案。 */
export function resolveInitialModelBrowserView({
  providers,
  selectedProvider,
  hasProfiles,
  providerLocked = false,
}: {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  hasProfiles: boolean;
  providerLocked?: boolean;
}): ModelBrowserView {
  if (providerLocked) {
    const provider = providers.find((entry) => entry.id === selectedProvider);
    if (provider)
      return { kind: "provider", providerId: provider.id, providerLabel: provider.label };
  }
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
