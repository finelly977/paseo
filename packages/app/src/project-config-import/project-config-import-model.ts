import type {
  ProjectConfigImportPreview,
  ProjectConfigImportSource,
  ProjectConfigRpcError,
} from "@getpaseo/protocol/messages";

export interface ProjectConfigImportIntent {
  serverId: string;
  source: ProjectConfigImportSource;
  intentId: string;
}

export type ProjectConfigImportState =
  | {
      status: "loading";
      intent: ProjectConfigImportIntent;
      preview: ProjectConfigImportPreview | null;
      error: null;
    }
  | {
      status: "ready";
      intent: ProjectConfigImportIntent;
      preview: ProjectConfigImportPreview;
      error: null;
    }
  | {
      status: "applying";
      intent: ProjectConfigImportIntent;
      preview: ProjectConfigImportPreview;
      error: null;
    }
  | {
      status: "error";
      intent: ProjectConfigImportIntent;
      preview: ProjectConfigImportPreview | null;
      error: ProjectConfigImportVisibleError;
      retryAction: ProjectConfigImportRetryAction;
    };

export type ProjectConfigImportVisibleError =
  | ProjectConfigRpcError
  | { code: "transport"; message: string };
export type ProjectConfigImportRetryAction = "refresh" | "apply";

export function openProjectConfigImport(input: {
  intent: ProjectConfigImportIntent;
  preview: ProjectConfigImportPreview | null;
  isLoading: boolean;
  error: ProjectConfigImportVisibleError | null;
  errorRetryAction?: ProjectConfigImportRetryAction;
  isApplying: boolean;
}): ProjectConfigImportState {
  if (input.error) {
    return {
      status: "error",
      intent: input.intent,
      preview: input.preview,
      error: input.error,
      retryAction: input.errorRetryAction ?? "refresh",
    };
  }
  if (input.preview && input.isApplying) {
    return {
      status: "applying",
      intent: input.intent,
      preview: input.preview,
      error: null,
    };
  }
  if (input.preview) {
    return {
      status: "ready",
      intent: input.intent,
      preview: input.preview,
      error: null,
    };
  }
  return {
    status: "loading",
    intent: input.intent,
    preview: null,
    error: null,
  };
}

export function projectConfigImportCanApply(state: ProjectConfigImportState): boolean {
  return (
    state.status === "ready" &&
    state.preview.status === "available" &&
    Boolean(state.preview.preview)
  );
}

export function projectConfigImportNeedsRefresh(error: ProjectConfigImportVisibleError): boolean {
  return (
    error.code === "stale_source_config" ||
    error.code === "stale_project_config" ||
    error.code === "nothing_to_import"
  );
}

export function projectConfigImportApplyFailureRetryAction(
  error: ProjectConfigImportVisibleError,
): ProjectConfigImportRetryAction {
  return projectConfigImportNeedsRefresh(error) ? "refresh" : "apply";
}

export function normalizeProjectConfigImportError(
  error: ProjectConfigRpcError | Error | null,
): ProjectConfigImportVisibleError | null {
  if (!error) {
    return null;
  }
  if (error instanceof Error) {
    return {
      code: "transport",
      message: error.message.length > 0 ? error.message : "The host did not respond.",
    };
  }
  return error;
}

export function parseProjectConfigImportIntent(input: {
  importSource?: string | string[];
  importServerId?: string | string[];
  importIntentId?: string | string[];
}): ProjectConfigImportIntent | null {
  const source = first(input.importSource);
  const serverId = first(input.importServerId);
  const intentId = first(input.importIntentId);
  if (source !== "conductor" || !serverId || !intentId) {
    return null;
  }
  return {
    serverId,
    source: { kind: "conductor" },
    intentId,
  };
}

export function projectConfigImportSourceFeature(source: ProjectConfigImportSource) {
  switch (source.kind) {
    case "conductor":
      return "projectConfigImportConductor" as const;
  }
}

export function sourceLabel(source: ProjectConfigImportSource): string {
  switch (source.kind) {
    case "conductor":
      return "Conductor";
  }
}

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
