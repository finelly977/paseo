import type { Logger } from "pino";

import {
  ProviderSnapshotManager,
  type ProviderSnapshotManagerOptions,
} from "./provider-snapshot-manager.js";
import { OpenCodeBridge } from "./providers/opencode/bridge.js";
import type { PaseoToolCatalog } from "./tools/types.js";

export interface AgentProviderRuntime {
  snapshotManager: ProviderSnapshotManager;
  setPaseoToolCatalog(catalog: PaseoToolCatalog | null): void;
  shutdown(): Promise<void>;
}

interface CreateAgentProviderRuntimeOptions {
  paseoHome: string;
  logger: Logger;
  snapshotManager: Omit<ProviderSnapshotManagerOptions, "logger" | "openCodeBridge">;
}

export async function createAgentProviderRuntime(
  options: CreateAgentProviderRuntimeOptions,
): Promise<AgentProviderRuntime> {
  const bridge = new OpenCodeBridge({ paseoHome: options.paseoHome, logger: options.logger });
  try {
    await bridge.start();
    const snapshotManager = new ProviderSnapshotManager({
      ...options.snapshotManager,
      logger: options.logger.child({ module: "provider-snapshot-manager" }),
      openCodeBridge: bridge,
    });
    let shutdownPromise: Promise<void> | null = null;
    return {
      snapshotManager,
      setPaseoToolCatalog: (catalog) => bridge.setManifestCatalog(catalog),
      shutdown: () => {
        shutdownPromise ??= shutdownProviderRuntime(snapshotManager, bridge);
        return shutdownPromise;
      },
    };
  } catch (error) {
    try {
      await bridge.close();
    } catch (cleanupError) {
      const failure = new Error(
        "Failed to create agent provider runtime and close the OpenCode bridge",
        { cause: error },
      );
      Object.assign(failure, { cleanupError });
      throw failure;
    }
    throw error;
  }
}

async function shutdownProviderRuntime(
  snapshotManager: ProviderSnapshotManager,
  bridge: OpenCodeBridge,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await snapshotManager.shutdown();
  } catch (error) {
    errors.push(error);
  }
  try {
    await bridge.close();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "Failed to stop the agent provider runtime cleanly");
  }
}
