import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  type ProjectConfigImportAdvertisedSource,
  type ProjectConfigImportSource,
  type ProjectConfigRpcError,
} from "@getpaseo/protocol/messages";
import { useToast } from "@/contexts/toast-context";
import { useFetchQueries, useFetchQuery } from "@/data/query";
import { useSessionStore } from "@/stores/session-store";
import {
  projectConfigImportPreviewQueryKey,
  projectConfigImportPreviewQueryInput,
  stableProjectConfigImportSourceKey,
  type ProjectConfigImportPreviewResult,
} from "./preview-cache";
import type {
  ProjectConfigImportState,
  ProjectConfigImportVisibleError,
} from "./project-config-import-sheet";
import {
  createProjectConfigImportIntentFromRegistration,
  type ProjectConfigImportIntent,
} from "./route";
import {
  type ProjectConfigImportSourceRegistration,
  projectConfigImportSourceRegistry,
  type ProjectConfigImportSourceRegistry,
} from "./sources";

const EMPTY_IMPORT_SOURCES: readonly ProjectConfigImportAdvertisedSource[] = [];
type ProjectConfigImportPreviewSuccess = Extract<ProjectConfigImportPreviewResult, { ok: true }>;

export function useProjectConfigImportModel(input: {
  routeIntent: ProjectConfigImportIntent | null;
  repoRoot: string;
  serverId: string;
  client: DaemonClient | null;
  projectConfigLoaded: boolean;
  projectConfigQueryKey: readonly [string, string, string];
  hasUnsavedChanges: boolean;
  registry?: ProjectConfigImportSourceRegistry;
  onRouteIntentConsumed?: () => void;
}) {
  const registry = input.registry ?? projectConfigImportSourceRegistry;
  const onRouteIntentConsumed = input.onRouteIntentConsumed;
  const sources = useAdvertisedProjectConfigImportSources(input.serverId, registry);
  const [intent, setIntent] = useState<ProjectConfigImportIntent | null>(null);
  const consumedRouteIntentKeyRef = useRef<string | null>(null);
  const acknowledgedRouteIntentKeyRef = useRef<string | null>(null);
  const [applyError, setApplyError] = useState<ProjectConfigImportVisibleError | null>(null);
  const [retryAction, setRetryAction] = useState<ProjectConfigImportRetryAction>("apply");
  const activeSource = intent ? registry.get(intent.source) : null;
  const routeIntentCapabilityMissing = isRouteIntentCapabilityMissing({
    intent,
    routeIntent: input.routeIntent,
    sources,
  });
  const activePreview = useProjectConfigImportPreviewQuery({
    client: input.client,
    serverId: input.serverId,
    repoRoot: input.repoRoot,
    source: intent?.source ?? null,
    protocolSource: intent?.protocolSource ?? null,
    enabled: Boolean(
      intent &&
      input.projectConfigLoaded &&
      !routeIntentCapabilityMissing &&
      !input.hasUnsavedChanges,
    ),
  });
  const preview = activePreview.data?.ok ? activePreview.data : null;
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    const routeIntentKey = input.routeIntent
      ? `${input.routeIntent.serverId}:${stableProjectConfigImportSourceKey(input.routeIntent.source)}:${input.routeIntent.intentId}`
      : null;
    if (
      input.routeIntent?.serverId === input.serverId &&
      routeIntentKey &&
      consumedRouteIntentKeyRef.current !== routeIntentKey
    ) {
      consumedRouteIntentKeyRef.current = routeIntentKey;
      setIntent(input.routeIntent);
    }
  }, [input.routeIntent, input.serverId]);

  useEffect(() => {
    const routeIntentKey = input.routeIntent
      ? `${input.routeIntent.serverId}:${stableProjectConfigImportSourceKey(input.routeIntent.source)}:${input.routeIntent.intentId}`
      : null;
    const openIntentKey = intent
      ? `${intent.serverId}:${stableProjectConfigImportSourceKey(intent.source)}:${intent.intentId}`
      : null;
    if (
      routeIntentKey &&
      routeIntentKey === openIntentKey &&
      acknowledgedRouteIntentKeyRef.current !== routeIntentKey
    ) {
      acknowledgedRouteIntentKeyRef.current = routeIntentKey;
      onRouteIntentConsumed?.();
    }
  }, [input.routeIntent, intent, onRouteIntentConsumed]);

  useEffect(() => {
    setApplyError(null);
  }, [
    intent?.intentId,
    preview?.sourceRevision,
    preview?.paseoRevision?.mtimeMs,
    preview?.paseoRevision?.size,
  ]);

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!input.client || !intent || !preview?.sourceRevision) {
        throw new Error("Import preview is not available");
      }
      return input.client.applyProjectConfigImport({
        repoRoot: input.repoRoot,
        source: intent.protocolSource,
        expectedSourceRevision: preview.sourceRevision,
        expectedPaseoRevision: preview.paseoRevision,
      });
    },
    onSuccess: (result) => {
      if (!result.ok) {
        setApplyError(result.error);
        setRetryAction(projectConfigImportApplyFailureRetryAction(result.error));
        return;
      }
      queryClient.setQueryData(input.projectConfigQueryKey, {
        ok: true,
        config: result.config,
        revision: result.revision,
        requestId: "import-cache",
        repoRoot: input.repoRoot,
      });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({
        queryKey: projectConfigImportPreviewQueryKey(
          input.serverId,
          input.repoRoot,
          intent?.source ?? result.source,
        ),
        exact: true,
      });
      const appliedSource = registry.get(result.source);
      toast.show(
        t("settings.project.import.success", {
          source: appliedSource?.displayName ?? result.source.kind,
        }),
        { variant: "success" },
      );
      setIntent(null);
    },
    onError: (cause) => {
      setApplyError(
        normalizeProjectConfigImportError(
          cause instanceof Error ? cause : new Error(String(cause)),
        ),
      );
      setRetryAction("apply");
    },
  });

  const availability = useProjectConfigImportAvailability({
    client: input.client,
    serverId: input.serverId,
    repoRoot: input.repoRoot,
    enabled: input.projectConfigLoaded,
    registry,
  });
  const state = useMemo<ProjectConfigImportState | null>(() => {
    if (!intent) {
      return null;
    }
    const error = projectConfigImportVisibleError({
      routeIntentCapabilityMissing,
      hasUnsavedChanges: input.hasUnsavedChanges,
      applyError,
      preview,
      requestError:
        activePreview.data && !activePreview.data.ok
          ? activePreview.data.error
          : activePreview.error,
    });
    if (error) {
      return {
        status: "error",
        intent,
        preview,
        error,
        retryAction: applyError ? retryAction : "refresh",
      };
    }
    if (preview && applyMutation.isPending) {
      return { status: "applying", intent, preview, error: null };
    }
    if (preview) {
      return { status: "ready", intent, preview, error: null };
    }
    return { status: "loading", intent, preview: null, error: null };
  }, [
    activePreview.data,
    activePreview.error,
    applyError,
    applyMutation.isPending,
    intent,
    input.hasUnsavedChanges,
    preview,
    retryAction,
    routeIntentCapabilityMissing,
  ]);

  return {
    sources,
    intent,
    state,
    activeSourceName: activeSource?.displayName ?? null,
    availability,
    open: (source: ProjectConfigImportSourceRegistration) => {
      const nextIntent = createProjectConfigImportIntentFromRegistration({
        serverId: input.serverId,
        registration: source,
        intentId: String(Date.now()),
      });
      if (nextIntent) {
        setIntent(nextIntent);
      }
    },
    close: () => setIntent(null),
    refresh: () => {
      void activePreview.refetch();
    },
    apply: () => {
      if (!applyMutation.isPending && !input.hasUnsavedChanges) {
        setApplyError(null);
        applyMutation.mutate();
      }
    },
  };
}

function projectConfigImportPreviewError(
  preview: ProjectConfigImportPreviewSuccess | null,
): ProjectConfigRpcError | null {
  if (preview?.status === "not_found") {
    return { code: "source_config_not_found", source: preview.source };
  }
  if (preview?.status === "nothing_to_import") {
    return { code: "nothing_to_import" };
  }
  return null;
}

function projectConfigImportVisibleError(input: {
  routeIntentCapabilityMissing: boolean;
  hasUnsavedChanges: boolean;
  applyError: ProjectConfigImportVisibleError | null;
  preview: ProjectConfigImportPreviewSuccess | null;
  requestError: ProjectConfigRpcError | Error | null;
}): ProjectConfigImportVisibleError | null {
  if (input.routeIntentCapabilityMissing) {
    return { code: "capability_missing" };
  }
  if (input.hasUnsavedChanges) {
    return { code: "unsaved_changes" };
  }
  return (
    input.applyError ??
    projectConfigImportPreviewError(input.preview) ??
    normalizeProjectConfigImportError(input.requestError)
  );
}

export function useProjectConfigImportAvailability(input: {
  client: DaemonClient | null;
  serverId: string | null | undefined;
  repoRoot: string | null | undefined;
  enabled: boolean;
  registry?: ProjectConfigImportSourceRegistry;
}) {
  const registry = input.registry ?? projectConfigImportSourceRegistry;
  const serverId = input.serverId ?? "";
  const repoRoot = input.repoRoot ?? "";
  const sources = useAdvertisedProjectConfigImportSources(serverId, registry);
  const previews = useProjectConfigImportPreviewQueries({
    client: input.client,
    serverId,
    repoRoot,
    sources,
    enabled: input.enabled,
  });
  const availableSources = sources.filter((_, index) => {
    const data = previews[index]?.data;
    return data?.ok === true && data.status === "available";
  });
  const availableKinds = new Set(availableSources.map((source) => source.kind));
  const availableSourceKeys = new Set(
    availableSources.map((source) => stableProjectConfigImportSourceKey(source.source)),
  );

  return {
    status: projectConfigImportAvailabilityStatus(availableSources.length),
    source: availableSources.length === 1 ? availableSources[0] : null,
    sources: availableSources,
    availableKinds,
    availableSourceKeys,
  };
}

function projectConfigImportAvailabilityStatus(count: number): "none" | "one" | "many" {
  if (count === 0) {
    return "none";
  }
  return count === 1 ? "one" : "many";
}

function isRouteIntentCapabilityMissing(input: {
  intent: ProjectConfigImportIntent | null;
  routeIntent: ProjectConfigImportIntent | null;
  sources: ProjectConfigImportSourceRegistration[];
}): boolean {
  if (!input.intent || input.routeIntent?.intentId !== input.intent.intentId) {
    return false;
  }
  const intentSourceKey = stableProjectConfigImportSourceKey(input.intent.source);
  return !input.sources.some(
    (source) => stableProjectConfigImportSourceKey(source.source) === intentSourceKey,
  );
}

function useAdvertisedProjectConfigImportSources(
  serverId: string | null | undefined,
  registry: ProjectConfigImportSourceRegistry,
): ProjectConfigImportSourceRegistration[] {
  const advertised = useSessionStore(
    useCallback(
      (state) => {
        const id = serverId?.trim();
        return id
          ? (state.sessions[id]?.serverInfo?.features?.projectConfigImportSources ??
              EMPTY_IMPORT_SOURCES)
          : EMPTY_IMPORT_SOURCES;
      },
      [serverId],
    ),
  );
  return useMemo(() => registry.advertised(advertised), [advertised, registry]);
}

function useProjectConfigImportPreviewQueries(input: {
  client: DaemonClient | null;
  serverId: string;
  repoRoot: string;
  sources: readonly ProjectConfigImportSourceRegistration[];
  enabled: boolean;
}) {
  return useFetchQueries<ProjectConfigImportPreviewResult>(
    input.sources.map((source) =>
      projectConfigImportPreviewQueryInput({
        client: input.client,
        serverId: input.serverId,
        repoRoot: input.repoRoot,
        source: source.source,
        protocolSource: source.protocolSource,
        enabled: input.enabled,
      }),
    ),
  );
}

function useProjectConfigImportPreviewQuery(input: {
  client: DaemonClient | null;
  serverId: string;
  repoRoot: string;
  source: ProjectConfigImportSourceRegistration["source"] | null;
  protocolSource: ProjectConfigImportSource | null;
  enabled: boolean;
}) {
  return useFetchQuery(projectConfigImportPreviewQueryInput(input));
}

type ProjectConfigImportRetryAction = "refresh" | "apply";

function projectConfigImportApplyFailureRetryAction(
  error: ProjectConfigImportVisibleError,
): ProjectConfigImportRetryAction {
  return error.code === "stale_source_config" ||
    error.code === "stale_project_config" ||
    error.code === "nothing_to_import"
    ? "refresh"
    : "apply";
}

function normalizeProjectConfigImportError(
  error: ProjectConfigRpcError | Error | null,
): ProjectConfigImportVisibleError | null {
  if (!error) {
    return null;
  }
  return error instanceof Error
    ? { code: "transport", message: error.message || "The host did not respond." }
    : error;
}
