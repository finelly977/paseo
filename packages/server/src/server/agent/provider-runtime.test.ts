import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { ProviderSnapshotManager } from "./provider-snapshot-manager.js";
import { createAgentProviderRuntime } from "./provider-runtime.js";
import { OpenCodeBridge } from "./providers/opencode/bridge.js";
import type { PaseoToolCatalog } from "./tools/types.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agent provider runtime", () => {
  test("owns bridge injection, catalog forwarding, and idempotent shutdown", async () => {
    vi.spyOn(OpenCodeBridge.prototype, "start").mockResolvedValue();
    const setManifestCatalog = vi
      .spyOn(OpenCodeBridge.prototype, "setManifestCatalog")
      .mockImplementation(() => undefined);
    const close = vi.spyOn(OpenCodeBridge.prototype, "close").mockResolvedValue();
    const runtime = await createAgentProviderRuntime({
      paseoHome: "/tmp/paseo-provider-runtime-test",
      logger: createTestLogger(),
      snapshotManager: {},
    });
    const catalog = emptyCatalog();

    expect(
      runtime.snapshotManager.getAgentManagerProviderState().clients.opencode?.capabilities
        .supportsNativePaseoTools,
    ).toBe(true);
    runtime.setPaseoToolCatalog(catalog);
    await Promise.all([runtime.shutdown(), runtime.shutdown()]);

    expect(setManifestCatalog).toHaveBeenCalledOnce();
    expect(setManifestCatalog).toHaveBeenCalledWith(catalog);
    expect(close).toHaveBeenCalledOnce();
  });

  test("closes the bridge when startup fails", async () => {
    vi.spyOn(OpenCodeBridge.prototype, "start").mockRejectedValue(new Error("startup failed"));
    const close = vi.spyOn(OpenCodeBridge.prototype, "close").mockResolvedValue();

    await expect(
      createAgentProviderRuntime({
        paseoHome: "/tmp/paseo-provider-runtime-test",
        logger: createTestLogger(),
        snapshotManager: {},
      }),
    ).rejects.toThrow("startup failed");
    expect(close).toHaveBeenCalledOnce();
  });

  test("preserves both startup and bridge cleanup failures", async () => {
    const startupError = new Error("startup failed");
    const cleanupError = new Error("cleanup failed");
    vi.spyOn(OpenCodeBridge.prototype, "start").mockRejectedValue(startupError);
    vi.spyOn(OpenCodeBridge.prototype, "close").mockRejectedValue(cleanupError);

    const failure = await createAgentProviderRuntime({
      paseoHome: "/tmp/paseo-provider-runtime-test",
      logger: createTestLogger(),
      snapshotManager: {},
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).cause).toBe(startupError);
    expect((failure as Error & { cleanupError: unknown }).cleanupError).toBe(cleanupError);
  });

  test("still closes the bridge and preserves both shutdown failures", async () => {
    const snapshotError = new Error("snapshot shutdown failed");
    const bridgeError = new Error("bridge shutdown failed");
    vi.spyOn(OpenCodeBridge.prototype, "start").mockResolvedValue();
    vi.spyOn(ProviderSnapshotManager.prototype, "shutdown").mockRejectedValue(snapshotError);
    const close = vi.spyOn(OpenCodeBridge.prototype, "close").mockRejectedValue(bridgeError);
    const runtime = await createAgentProviderRuntime({
      paseoHome: "/tmp/paseo-provider-runtime-test",
      logger: createTestLogger(),
      snapshotManager: {},
    });

    const failure = await runtime.shutdown().catch((error: unknown) => error);

    expect(close).toHaveBeenCalledOnce();
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([snapshotError, bridgeError]);
  });
});

function emptyCatalog(): PaseoToolCatalog {
  return {
    tools: new Map(),
    getTool: () => undefined,
    executeTool: async () => {
      throw new Error("Unknown tool");
    },
  };
}
