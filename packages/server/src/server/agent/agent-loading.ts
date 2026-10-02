import type { Logger } from "pino";

import type { AgentProvider } from "./agent-sdk-types.js";
import type { AgentManager, ManagedAgent } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
import {
  buildConfigOverrides,
  buildSessionConfig,
  extractTimestamps,
  isStoredAgentProviderAvailable,
  toAgentPersistenceHandle,
} from "../persistence-hooks.js";

interface PendingAgentInitialization {
  promise: Promise<ManagedAgent>;
  options: { broadcastTimeline: boolean; replaceTimeline: boolean; phase: "loading" | "hydrating" };
}

const pendingInitializationsByManager = new WeakMap<
  AgentLoaderManager,
  Map<string, PendingAgentInitialization>
>();

export async function waitForAgentInitialization(
  manager: AgentLoaderManager,
  agentId: string,
): Promise<void> {
  const pending = pendingInitializationsByManager.get(manager)?.get(agentId);
  if (pending) await pending.promise;
}

export type AgentLoaderManager = Pick<
  AgentManager,
  | "createAgent"
  | "getAgent"
  | "getRegisteredProviderIds"
  | "hydrateTimelineFromProvider"
  | "resumeAgentFromPersistence"
  | "reloadAgentSession"
> &
  Partial<Pick<AgentManager, "touchAgentActivity" | "waitForAgentClose" | "waitForAgentReload">>;

export interface EnsureAgentLoadedDeps {
  agentManager: AgentLoaderManager;
  agentStorage: AgentStorage;
  validProviders?: Iterable<AgentProvider>;
  broadcastTimeline?: boolean;
  replaceTimeline?: boolean;
  logger: Logger;
}

async function joinInitialization(
  agentId: string,
  pending: PendingAgentInitialization,
  deps: EnsureAgentLoadedDeps,
): Promise<ManagedAgent> {
  if (deps.replaceTimeline && !pending.options.replaceTimeline) {
    if (pending.options.phase === "hydrating") {
      await pending.promise;
      return deps.agentManager.reloadAgentSession(agentId, undefined, { rehydrateFromDisk: true });
    }
    pending.options.replaceTimeline = true;
  }
  pending.options.broadcastTimeline ||= deps.broadcastTimeline === true;
  return pending.promise;
}

export async function ensureUnarchivedAgentLoaded(
  agentId: string,
  deps: EnsureAgentLoadedDeps & {
    agentManager: AgentLoaderManager & Pick<AgentManager, "closeAgent">;
  },
): Promise<ManagedAgent> {
  const record = await deps.agentStorage.get(agentId);
  if (record?.archivedAt) {
    throw new Error(`Agent is archived: ${agentId}`);
  }

  const agent = await ensureAgentLoaded(agentId, deps);
  const latestRecord = await deps.agentStorage.get(agentId);
  if (latestRecord?.archivedAt) {
    await deps.agentManager.closeAgent(agentId).catch((error: unknown) => {
      deps.logger.warn({ err: error, agentId }, "Failed to close concurrently archived agent");
    });
    throw new Error(`Agent is archived: ${agentId}`);
  }

  return agent;
}

export async function ensureAgentLoaded(
  agentId: string,
  deps: EnsureAgentLoadedDeps,
): Promise<ManagedAgent> {
  await deps.agentManager.waitForAgentReload?.(agentId);
  await deps.agentManager.waitForAgentClose?.(agentId);
  await deps.agentManager.waitForAgentReload?.(agentId);
  let pendingAgentInitializations = pendingInitializationsByManager.get(deps.agentManager);
  if (!pendingAgentInitializations) {
    pendingAgentInitializations = new Map();
    pendingInitializationsByManager.set(deps.agentManager, pendingAgentInitializations);
  }

  const inflight = pendingAgentInitializations.get(agentId);
  if (inflight) {
    return joinInitialization(agentId, inflight, deps);
  }

  const existing =
    deps.agentManager.touchAgentActivity?.(agentId) ?? deps.agentManager.getAgent(agentId);
  if (existing) {
    if (deps.replaceTimeline)
      return deps.agentManager.reloadAgentSession(agentId, undefined, { rehydrateFromDisk: true });
    return existing;
  }

  // A close may have started after the first barrier observed no in-flight
  // work. Once the live lookup is empty, this second barrier closes that gap
  // before storage-backed resume begins.
  await deps.agentManager.waitForAgentClose?.(agentId);
  await deps.agentManager.waitForAgentReload?.(agentId);

  const laterInflight = pendingAgentInitializations.get(agentId);
  if (laterInflight) {
    return joinInitialization(agentId, laterInflight, deps);
  }

  const pendingOptions: PendingAgentInitialization["options"] = {
    broadcastTimeline: deps.broadcastTimeline === true,
    replaceTimeline: deps.replaceTimeline === true,
    phase: "loading",
  };
  const initPromise = (async () => {
    const record = await deps.agentStorage.get(agentId);
    if (!record) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const validProviders = deps.validProviders ?? deps.agentManager.getRegisteredProviderIds();
    if (!isStoredAgentProviderAvailable(record, validProviders)) {
      throw new Error(`Agent ${agentId} references unavailable provider '${record.provider}'`);
    }

    const handle = toAgentPersistenceHandle(validProviders, record.persistence);

    let snapshot: ManagedAgent;
    if (handle) {
      snapshot = await deps.agentManager.resumeAgentFromPersistence(
        handle,
        buildConfigOverrides(record),
        agentId,
        extractTimestamps(record),
        record.archivedAt ? { purpose: "history" } : undefined,
      );
      deps.logger.info({ agentId, provider: record.provider }, "Agent resumed from persistence");
    } else {
      const config = buildSessionConfig(record, {
        validProviders,
      });
      if (!config) {
        throw new Error(`Agent ${agentId} references unavailable provider '${record.provider}'`);
      }
      snapshot = await deps.agentManager.createAgent(config, agentId, {
        labels: record.labels,
        workspaceId: record.workspaceId,
        owner: record.owner,
      });
      deps.logger.info({ agentId, provider: record.provider }, "Agent created from stored config");
    }

    pendingOptions.phase = "hydrating";
    await deps.agentManager.hydrateTimelineFromProvider(agentId, {
      force: pendingOptions.replaceTimeline,
      broadcast: () => pendingOptions.broadcastTimeline || pendingOptions.replaceTimeline,
      broadcastTimeline: () => pendingOptions.broadcastTimeline && !pendingOptions.replaceTimeline,
      emitReplacement: pendingOptions.replaceTimeline,
    });
    return deps.agentManager.getAgent(agentId) ?? snapshot;
  })();

  const pending: PendingAgentInitialization = { promise: initPromise, options: pendingOptions };
  pendingAgentInitializations.set(agentId, pending);

  try {
    return await initPromise;
  } finally {
    const current = pendingAgentInitializations.get(agentId);
    if (current === pending) {
      pendingAgentInitializations.delete(agentId);
    }
  }
}
