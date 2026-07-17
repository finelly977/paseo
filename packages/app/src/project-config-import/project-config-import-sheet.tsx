import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ProjectConfigImportPreview } from "@getpaseo/protocol/messages";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { settingsStyles } from "@/styles/settings";
import { ConductorIcon } from "./conductor-icon";
import {
  projectConfigImportCanApply,
  projectConfigImportNeedsRefresh,
  sourceLabel,
  type ProjectConfigImportState,
  type ProjectConfigImportVisibleError,
} from "./project-config-import-model";

interface ProjectConfigImportSheetProps {
  visible: boolean;
  state: ProjectConfigImportState;
  onClose: () => void;
  onRefresh: () => void;
  onApply: () => void;
}

export function ProjectConfigImportSheet({
  visible,
  state,
  onClose,
  onRefresh,
  onApply,
}: ProjectConfigImportSheetProps) {
  const { t } = useTranslation();
  const header = useMemo<SheetHeader>(
    () => ({
      title: t("settings.project.import.sheetTitle", { source: sourceLabel(state.intent.source) }),
    }),
    [state.intent.source, t],
  );
  const preview = state.preview;
  const visibleError = state.status === "error" ? state.error : null;
  const needsRefresh = visibleError ? projectConfigImportNeedsRefresh(visibleError) : false;
  const retryAction = state.status === "error" ? state.retryAction : "refresh";
  const handleRetry = retryAction === "apply" ? onApply : onRefresh;
  const canImport = projectConfigImportCanApply(state);
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
            description={projectConfigImportErrorText(visibleError, t)}
          >
            {needsRefresh ? (
              <Button
                testID="project-config-import-refresh"
                onPress={onRefresh}
                variant="outline"
                size="sm"
              >
                {t("settings.project.import.refreshPreview")}
              </Button>
            ) : (
              <Button
                testID="project-config-import-retry"
                onPress={handleRetry}
                variant="outline"
                size="sm"
              >
                {t("settings.project.actions.tryAgain")}
              </Button>
            )}
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

function PreviewBody({ preview }: { preview: ProjectConfigImportPreview }) {
  const { t } = useTranslation();
  const grouped = groupPreviewItems(preview);
  return (
    <View style={styles.preview}>
      <View style={styles.sourceRow}>
        <ConductorIcon size={18} color={styles.iconColor.color} />
        <Text style={settingsStyles.rowTitle}>{t("settings.project.import.sources")}</Text>
      </View>
      <View style={settingsStyles.card}>
        {preview.inputs.map((input, index) => (
          <View
            key={`${input.role}:${input.relativePath}`}
            style={index === 0 ? settingsStyles.row : styles.rowWithBorder}
          >
            <Text style={settingsStyles.rowTitle}>{input.relativePath}</Text>
            <Text style={settingsStyles.rowHint}>{input.role}</Text>
          </View>
        ))}
      </View>
      <ItemGroup title={t("settings.project.import.willImport")} items={grouped.imports} />
      <ItemGroup title={t("settings.project.import.needsAttention")} items={grouped.attention} />
      <ItemGroup title={t("settings.project.import.notSupported")} items={grouped.unsupported} />
    </View>
  );
}

function ItemGroup({
  title,
  items,
}: {
  title: string;
  items: ProjectConfigImportPreview["items"];
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={settingsStyles.card}>
        {items.map((item, index) => (
          <View
            key={`${item.key}:${item.outcome}:${item.detail ?? ""}`}
            style={index === 0 ? settingsStyles.row : styles.rowWithBorder}
          >
            <Text style={settingsStyles.rowTitle}>{item.label}</Text>
            {item.detail ? <Text style={styles.commandText}>{item.detail}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function groupPreviewItems(preview: ProjectConfigImportPreview) {
  return {
    imports: preview.items.filter((item) => item.outcome === "import"),
    attention: preview.items.filter(
      (item) => item.outcome === "rewrite" || item.outcome === "collision",
    ),
    unsupported: preview.items.filter((item) => item.outcome === "unsupported"),
  };
}

function projectConfigImportErrorText(
  error: ProjectConfigImportVisibleError,
  t: TFunction,
): string {
  switch (error.code) {
    case "transport":
      return error.message;
    case "source_config_not_found":
      return t("settings.project.import.errors.notFound");
    case "invalid_source_config":
      return t("settings.project.import.errors.invalid", { path: error.relativePath });
    case "stale_source_config":
      return t("settings.project.import.errors.staleSource");
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
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
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
  iconColor: {
    color: theme.colors.foreground,
  },
}));
