import { Text, View } from "react-native";
import { useMemo } from "react";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type {
  ProjectConfigImportItem,
  ProjectConfigImportPreview,
  ProjectConfigRpcError,
} from "@getpaseo/protocol/messages";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { settingsStyles } from "@/styles/settings";
import type { ProjectConfigImportIntent } from "./route";

export type ProjectConfigImportVisibleError =
  | ProjectConfigRpcError
  | { code: "capability_missing" }
  | { code: "transport"; message: string };

export type ProjectConfigImportState =
  | { status: "loading"; intent: ProjectConfigImportIntent; preview: null; error: null }
  | {
      status: "ready" | "applying";
      intent: ProjectConfigImportIntent;
      preview: ProjectConfigImportPreview;
      error: null;
    }
  | {
      status: "error";
      intent: ProjectConfigImportIntent;
      preview: ProjectConfigImportPreview | null;
      error: ProjectConfigImportVisibleError;
      retryAction: "refresh" | "apply";
    };

interface ProjectConfigImportSheetProps {
  visible: boolean;
  state: ProjectConfigImportState;
  sourceName: string;
  onClose: () => void;
  onRefresh: () => void;
  onApply: () => void;
}

export function ProjectConfigImportSheet({
  visible,
  state,
  sourceName,
  onClose,
  onRefresh,
  onApply,
}: ProjectConfigImportSheetProps) {
  const { t } = useTranslation();
  const header = useMemo(
    () => ({ title: t("settings.project.import.sheetTitle", { source: sourceName }) }),
    [sourceName, t],
  );
  const preview = state.preview;
  const visibleError = state.status === "error" ? state.error : null;
  const retryAction = state.status === "error" ? state.retryAction : "refresh";
  const canImport =
    state.status === "ready" &&
    state.preview.status === "available" &&
    Boolean(state.preview.preview);
  const isLoading = state.status === "loading";
  const isApplying = state.status === "applying";

  return (
    <AdaptiveModalSheet
      visible={visible}
      header={header}
      onClose={onClose}
      testID="project-config-import-sheet"
      desktopMaxWidth={640}
    >
      <View style={styles.content}>
        {isLoading ? (
          <View style={styles.loading}>
            <LoadingSpinner color={styles.spinnerColor.color} />
          </View>
        ) : null}

        {visibleError ? (
          <Alert
            testID="project-config-import-error"
            variant="error"
            title={t("settings.project.import.errorTitle")}
            description={projectConfigImportErrorText(visibleError, t, sourceName)}
          >
            <ImportErrorRetryButton
              error={visibleError}
              retryAction={retryAction}
              onRefresh={onRefresh}
              onApply={onApply}
            />
            <Button
              testID="project-config-import-cancel-error"
              onPress={onClose}
              variant="ghost"
              size="sm"
            >
              {t("settings.project.actions.cancel")}
            </Button>
          </Alert>
        ) : null}

        {preview ? <PreviewBody preview={preview} /> : null}

        <View style={styles.footer}>
          <Button testID="project-config-import-cancel" onPress={onClose} variant="ghost" size="md">
            {t("settings.project.actions.cancel")}
          </Button>
          <Button
            testID="project-config-import-apply"
            onPress={onApply}
            variant="default"
            size="md"
            disabled={!canImport || isApplying}
            loading={isApplying}
          >
            {isApplying
              ? t("settings.project.import.importing")
              : t("settings.project.import.import")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

function ImportErrorRetryButton(input: {
  error: ProjectConfigImportVisibleError;
  retryAction: "refresh" | "apply";
  onRefresh: () => void;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  if (input.error.code === "capability_missing") {
    return null;
  }
  const needsRefresh =
    input.error.code === "stale_source_config" ||
    input.error.code === "stale_project_config" ||
    input.error.code === "nothing_to_import";
  if (needsRefresh) {
    return (
      <Button
        testID="project-config-import-refresh"
        onPress={input.onRefresh}
        variant="outline"
        size="sm"
      >
        {t("settings.project.import.refreshPreview")}
      </Button>
    );
  }
  return (
    <Button
      testID="project-config-import-retry"
      onPress={input.retryAction === "apply" ? input.onApply : input.onRefresh}
      variant="outline"
      size="sm"
    >
      {t("settings.project.actions.tryAgain")}
    </Button>
  );
}

function PreviewBody({ preview }: { preview: ProjectConfigImportPreview }) {
  const { t } = useTranslation();
  const sections = [
    {
      title: t("settings.project.import.sources"),
      items: preview.inputs.map((input) => ({
        key: `${input.role}:${input.relativePath}`,
        label: input.relativePath,
        outcome: "import" as const,
        detail: input.role,
      })),
    },
    {
      title: t("settings.project.import.willImport"),
      items: preview.items.filter((item) => item.outcome === "import"),
    },
    {
      title: t("settings.project.import.needsAttention"),
      items: preview.items.filter(
        (item) => item.outcome === "rewrite" || item.outcome === "collision",
      ),
    },
    {
      title: t("settings.project.import.notSupported"),
      items: preview.items.filter((item) => item.outcome === "unsupported"),
    },
  ];
  return (
    <View style={styles.preview}>
      {sections.map((section) => (
        <PreviewItemGroup key={section.title} title={section.title} items={section.items} />
      ))}
    </View>
  );
}

function PreviewItemGroup({ title, items }: { title: string; items: ProjectConfigImportItem[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={settingsStyles.card}>
        {items.map((item, index) => (
          <View key={`${item.key}:${item.outcome}:${item.detail ?? ""}`} style={rowStyle(index)}>
            <Text style={settingsStyles.rowTitle}>{item.label}</Text>
            {item.detail ? <Text style={styles.commandText}>{item.detail}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function rowStyle(index: number) {
  return index === 0 ? settingsStyles.row : styles.rowWithBorder;
}

function projectConfigImportErrorText(
  error: ProjectConfigImportVisibleError,
  t: ReturnType<typeof useTranslation>["t"],
  sourceName: string,
): string {
  switch (error.code) {
    case "transport":
      return error.message;
    case "capability_missing":
      return t("settings.project.import.errors.capabilityMissing");
    case "source_config_not_found":
      return t("settings.project.import.errors.notFound", { source: sourceName });
    case "invalid_source_config":
      return t("settings.project.import.errors.invalid", { path: error.relativePath });
    case "stale_source_config":
      return t("settings.project.import.errors.staleSource", { source: sourceName });
    case "stale_project_config":
      return t("settings.project.import.errors.staleProject");
    case "nothing_to_import":
      return t("settings.project.import.errors.nothing");
    case "write_failed":
      return t("settings.project.writeFailures.failedDescription");
    case "invalid_project_config":
      return t("settings.project.readFailures.invalidDescription");
    case "project_not_found":
      return t("settings.project.readFailures.missingSingleHost");
  }
}

const styles = StyleSheet.create((theme) => ({
  content: {
    gap: theme.spacing[4],
  },
  loading: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  preview: {
    gap: theme.spacing[4],
  },
  group: {
    gap: theme.spacing[2],
  },
  groupTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  rowWithBorder: {
    ...settingsStyles.row,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  commandText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
}));
