import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ProjectConfigImportSource } from "@getpaseo/protocol/messages";
import { useFetchQuery } from "@/data/query";

export function projectConfigImportPreviewQueryKey(input: {
  serverId: string;
  repoRoot: string;
  source: ProjectConfigImportSource;
}) {
  return ["project-config-import", input.serverId, input.repoRoot, input.source.kind] as const;
}

export function useProjectConfigImportPreview(input: {
  client: DaemonClient | null;
  serverId: string;
  repoRoot: string;
  source: ProjectConfigImportSource;
  enabled: boolean;
}) {
  return useFetchQuery({
    queryKey: projectConfigImportPreviewQueryKey(input),
    queryFn: () => {
      if (!input.client) {
        throw new Error("Project config import preview requires a daemon client");
      }
      return input.client.getProjectConfigImport({
        repoRoot: input.repoRoot,
        source: input.source,
      });
    },
    dataShape: "value",
    enabled: input.enabled && Boolean(input.client && input.serverId && input.repoRoot),
    retry: false,
    staleTimeMs: 5_000,
  });
}
