import React, { useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ModelBrowserHeaderActions } from "./model-browser-actions";
import { resolveInitialModelBrowserView } from "./model-browser-view";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";

const providers: ProviderSelectorProvider[] = [
  { id: "pi", label: "Pi", modelSelection: { kind: "models", rows: [] } },
  { id: "codex", label: "Codex", modelSelection: { kind: "models", rows: [] } },
];
let root: Root | null = null;
let host: HTMLDivElement;
afterEach(() => {
  root?.unmount();
  root = null;
  host.remove();
});

function HeaderFixture({
  pending = false,
  onRefresh,
}: {
  pending?: boolean;
  onRefresh(provider: string): void;
}) {
  const [refreshing, setRefreshing] = useState(pending);
  const refresh = useCallback(
    (provider: string) => {
      onRefresh(provider);
      setRefreshing(true);
    },
    [onRefresh],
  );
  const view = resolveInitialModelBrowserView({
    providers,
    selectedProvider: "pi",
    selectedModel: "",
    hasProfiles: false,
  });
  if (view.kind !== "provider") throw new Error("已选择智能体未直接进入模型列表");
  return (
    <div>
      <h1>{view.providerLabel}</h1>
      <ModelBrowserHeaderActions
        provider={view.providerId}
        providerLabel={view.providerLabel}
        serverId="host"
        onRefresh={refresh}
        pending={refreshing}
      />
    </div>
  );
}

it("已选择的 Agent 直接显示模型头，刷新动作在设置旁且重复点击受控", async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const onRefresh = vi.fn<(provider: string) => void>();
  root.render(<HeaderFixture onRefresh={onRefresh} />);
  await vi.waitFor(() => expect(host.querySelector("h1")?.textContent).toBe("Pi"));
  const settings = host.querySelector('[data-testid="selector-header-settings-pi"]');
  const refresh = host.querySelector<HTMLButtonElement>(
    '[data-testid="selector-header-refresh-pi"]',
  );
  if (!settings || !refresh) throw new Error("模型设置或刷新动作未显示");
  expect(settings.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  refresh.click();
  await vi.waitFor(() => expect(refresh.getAttribute("aria-disabled")).toBe("true"));
  refresh.click();
  expect(onRefresh).toHaveBeenCalledExactlyOnceWith("pi");
});
