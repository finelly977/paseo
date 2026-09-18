import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";
import { DaemonConfigStore } from "./daemon-config-store.js";
import { loadPersistedConfig } from "./persisted-config.js";

describe("Codex provider injection daemon config", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  test("persists the ordered injection list and credentials", () => {
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-codex-provider-injections-"));
    tempDirs.push(paseoHome);
    const store = new DaemonConfigStore(paseoHome, {
      relay: { enabled: false },
      mcp: { injectIntoAgents: false },
      browserTools: { enabled: false },
      providers: {},
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      enableTerminalAgentHooks: false,
      appendSystemPrompt: "",
    });
    const injections: NonNullable<MutableDaemonConfig["codexProviderInjections"]> = [
      {
        id: "proxy",
        name: "Proxy",
        modelProvider: "proxy_api",
        models: ["gpt-proxy", "gpt-proxy-fast"],
        definition: {
          name: "Proxy API",
          base_url: "https://proxy.example/v1",
          env_key: "PROXY_API_KEY",
          wire_api: "responses",
        },
        env: { PROXY_API_KEY: "secret" },
      },
    ];

    store.patch({ codexProviderInjections: injections });

    expect(store.get().codexProviderInjections).toEqual(injections);
    expect(loadPersistedConfig(paseoHome).daemon?.codexProviderInjections).toEqual(injections);
  });
});
