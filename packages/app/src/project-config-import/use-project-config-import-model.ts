import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ProjectConfigImportPreview } from "@getpaseo/protocol/messages";
import { useToast } from "@/contexts/toast-context";
import {
  normalizeProjectConfigImportError,
  openProjectConfigImport,
  projectConfigImportApplyFailureRetryAction,
  type ProjectConfigImportIntent,
  type ProjectConfigImportRetryAction,
  type ProjectConfigImportState,
  type ProjectConfigImportVisibleError,
} from "./project-config-import-model";

export interface ProjectConfigImportModel {
  state: ProjectConfigImportState;
  apply: () => void;
}

export function useProjectConfigImportModel(input: {
  intent: ProjectConfigImportIntent;
  repoRoot: string;
  client: DaemonClient;
  preview: ProjectConfigImportPreview | null;
  isPreviewLoading: boolean;
  previewError: ProjectConfigImportVisibleError | null;
  projectConfigQueryKey: readonly [string, string, string];
  onClose: () => void;
}): ProjectConfigImportModel {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [applyError, setApplyError] = useState<ProjectConfigImportVisibleError | null>(null);
  const [applyErrorRetryAction, setApplyErrorRetryAction] =
    useState<ProjectConfigImportRetryAction>("apply");
  const previewRevisionKey = [
    input.intent.intentId,
    input.preview?.sourceRevision ?? "",
    input.preview?.paseoRevision?.mtimeMs ?? "",
    input.preview?.paseoRevision?.size ?? "",
  ].join(":");

  useEffect(() => {
    setApplyError(null);
  }, [previewRevisionKey]);

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!input.preview?.sourceRevision) {
        throw new Error("Import preview is not available");
      }
      return input.client.applyProjectConfigImport({
        repoRoot: input.repoRoot,
        source: input.intent.source,
        expectedSourceRevision: input.preview.sourceRevision,
        expectedPaseoRevision: input.preview.paseoRevision,
      });
    },
    onSuccess: (result) => {
      if (!result.ok) {
        setApplyError(result.error);
        setApplyErrorRetryAction(projectConfigImportApplyFailureRetryAction(result.error));
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
      toast.show(t("settings.project.import.success"), { variant: "success" });
      setApplyError(null);
      input.onClose();
    },
    onError: (error) => {
      setApplyError(
        normalizeProjectConfigImportError(
          error instanceof Error ? error : new Error(String(error)),
        ),
      );
      setApplyErrorRetryAction("apply");
    },
  });

  const apply = useCallback(() => {
    if (applyMutation.isPending) {
      return;
    }
    setApplyError(null);
    applyMutation.mutate();
  }, [applyMutation]);

  const state = useMemo(
    () =>
      openProjectConfigImport({
        intent: input.intent,
        preview: input.preview,
        isLoading: input.isPreviewLoading,
        error: applyError ?? input.previewError,
        errorRetryAction: applyError ? applyErrorRetryAction : "refresh",
        isApplying: applyMutation.isPending,
      }),
    [
      applyError,
      applyErrorRetryAction,
      applyMutation.isPending,
      input.intent,
      input.isPreviewLoading,
      input.preview,
      input.previewError,
    ],
  );

  return { state, apply };
}
