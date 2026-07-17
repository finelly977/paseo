import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ProjectConfigImportSource } from "@getpaseo/protocol/messages";
import type { QueryKey } from "@tanstack/react-query";
import type { FetchQueryInput } from "@/data/query";
import type { ProjectConfigImportSourceDescriptor } from "./sources";

export type ProjectConfigImportPreviewResult = Awaited<
  ReturnType<DaemonClient["getProjectConfigImport"]>
>;

type ProjectConfigImportPreviewQueryKey = QueryKey;

const PROJECT_CONFIG_IMPORT_PREVIEW_STALE_MS = 5_000;

export function projectConfigImportPreviewQueryInput(input: {
  client: Pick<DaemonClient, "getProjectConfigImport"> | null;
  serverId: string;
  repoRoot: string;
  source: ProjectConfigImportSourceDescriptor | null;
  protocolSource: ProjectConfigImportSource | null;
  enabled: boolean;
}): FetchQueryInput<
  ProjectConfigImportPreviewResult,
  Error,
  ProjectConfigImportPreviewResult,
  ProjectConfigImportPreviewQueryKey
> {
  return {
    queryKey: projectConfigImportPreviewQueryKey(input.serverId, input.repoRoot, input.source),
    queryFn: () => {
      if (!input.client || !input.protocolSource) {
        throw new Error("Project config import preview requires a daemon client and source");
      }
      return input.client.getProjectConfigImport({
        repoRoot: input.repoRoot,
        source: input.protocolSource,
      });
    },
    enabled:
      input.enabled &&
      Boolean(input.client && input.serverId && input.repoRoot && input.protocolSource),
    refetchOnMount: false,
    retry: false,
    staleTimeMs: PROJECT_CONFIG_IMPORT_PREVIEW_STALE_MS,
    dataShape: "value",
  };
}

export function projectConfigImportPreviewQueryKey(
  serverId: string,
  repoRoot: string,
  source: ProjectConfigImportSourceDescriptor | null,
): ProjectConfigImportPreviewQueryKey {
  return [
    "project-config-import",
    serverId,
    repoRoot,
    source ? stableProjectConfigImportSourceKey(source) : "none",
  ] as const;
}

export function stableProjectConfigImportSourceKey(
  source: ProjectConfigImportSourceDescriptor,
): string {
  return stableJson(source);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
