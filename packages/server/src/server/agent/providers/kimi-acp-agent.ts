import type { Logger } from "pino";

import type { AgentModelDefinition } from "../agent-sdk-types.js";
import {
  type ACPCatalogModelResolverContext,
  resolvePerModelThinkingCatalog,
} from "./acp-agent.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";

interface KimiACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  providerParams?: unknown;
}

/**
 * Kimi reports different thinking-effort levels per model (a boolean on/off toggle for one
 * model, a multi-level select for another), but only exposes the *currently selected*
 * model's levels through `configOptions` — the model list itself carries no per-model
 * effort metadata. `deriveModelDefinitionsFromACP` can only see whichever model the probe
 * session defaulted to, so every other model would otherwise inherit that one model's
 * thinking options.
 *
 * Delegates to the shared {@link resolvePerModelThinkingCatalog} helper while keeping the
 * Kimi-specific guard (`probeWhenInitialThoughtLevelMissing: false`) so probes without a
 * thinking picker pay zero extra round trips.
 */
export async function resolveKimiCatalogModels(
  context: ACPCatalogModelResolverContext,
): Promise<AgentModelDefinition[]> {
  return resolvePerModelThinkingCatalog(context, {
    probeWhenInitialThoughtLevelMissing: false,
  });
}

export class KimiACPAgentClient extends GenericACPAgentClient {
  constructor(options: KimiACPAgentClientOptions) {
    super({
      logger: options.logger,
      command: options.command,
      env: options.env,
      providerId: options.providerId,
      label: options.label,
      providerParams: options.providerParams,
      catalogModelResolver: resolveKimiCatalogModels,
    });
  }
}
