import type { ProjectConfigImportSource } from "@getpaseo/protocol/messages";
import { ProjectConfigImportSourceSchema } from "@getpaseo/protocol/messages";
import type {
  ProjectConfigImportSourceDescriptor,
  ProjectConfigImportSourceRegistry,
} from "./sources";

export interface ProjectConfigImportIntent<
  TSource extends ProjectConfigImportSourceDescriptor = ProjectConfigImportSourceDescriptor,
  TProtocolSource extends ProjectConfigImportSourceDescriptor = ProjectConfigImportSource,
> {
  serverId: string;
  source: TSource;
  protocolSource: TProtocolSource;
  intentId: string;
}

export function parseProjectConfigImportIntent(
  input: {
    importSource?: string | string[];
    importServerId?: string | string[];
    importIntentId?: string | string[];
  },
  registry: ProjectConfigImportSourceRegistry,
): ProjectConfigImportIntent | null;

export function parseProjectConfigImportIntent<TSource extends ProjectConfigImportSourceDescriptor>(
  input: {
    importSource?: string | string[];
    importServerId?: string | string[];
    importIntentId?: string | string[];
  },
  registry: ProjectConfigImportSourceRegistry,
  parseSource: (source: ProjectConfigImportSourceDescriptor) => TSource | null,
): ProjectConfigImportIntent<ProjectConfigImportSourceDescriptor, TSource> | null;

export function parseProjectConfigImportIntent(
  input: {
    importSource?: string | string[];
    importServerId?: string | string[];
    importIntentId?: string | string[];
  },
  registry: ProjectConfigImportSourceRegistry,
  parseSource?: (
    source: ProjectConfigImportSourceDescriptor,
  ) => ProjectConfigImportSourceDescriptor | null,
): ProjectConfigImportIntent<
  ProjectConfigImportSourceDescriptor,
  ProjectConfigImportSourceDescriptor
> | null {
  const source = first(input.importSource);
  const serverId = first(input.importServerId);
  const intentId = first(input.importIntentId);
  const routeSource = source ? registry.fromRouteValue(source)?.source : null;
  const parsedSource = routeSource ? (parseSource ?? parseProtocolSource)(routeSource) : null;
  return parsedSource && routeSource && serverId && intentId
    ? { serverId, source: routeSource, protocolSource: parsedSource, intentId }
    : null;
}

export function createProjectConfigImportIntentFromRegistration(input: {
  serverId: string;
  registration: {
    source: ProjectConfigImportSourceDescriptor;
    protocolSource: ProjectConfigImportSource | null;
  };
  intentId: string;
}): ProjectConfigImportIntent | null {
  return input.registration.protocolSource
    ? {
        serverId: input.serverId,
        source: input.registration.source,
        protocolSource: input.registration.protocolSource,
        intentId: input.intentId,
      }
    : null;
}

function parseProtocolSource(
  source: ProjectConfigImportSourceDescriptor,
): ProjectConfigImportSource | null {
  const parsed = ProjectConfigImportSourceSchema.safeParse(source);
  return parsed.success ? parsed.data : null;
}

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}
