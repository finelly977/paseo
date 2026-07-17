import { Pressable, Text, View } from "react-native";
import { useCallback } from "react";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { stableProjectConfigImportSourceKey } from "./preview-cache";
import type { ProjectConfigImportIntent } from "./route";
import { ProjectConfigImportSheet } from "./project-config-import-sheet";
import type { ProjectConfigImportSourceRegistration } from "./sources";
import { getProjectConfigImportViewModule } from "./sources/view";
import { useProjectConfigImportModel } from "./use-project-config-import-model";

export function ProjectConfigImportSection(input: {
  client: DaemonClient;
  serverId: string;
  repoRoot: string;
  routeIntent: ProjectConfigImportIntent | null;
  onRouteIntentConsumed?: () => void;
  projectConfigLoaded: boolean;
  projectConfigQueryKey: readonly [string, string, string];
  hasUnsavedChanges: boolean;
}) {
  const model = useProjectConfigImportModel(input);

  return (
    <>
      {model.sources.map((source) => (
        <ProjectConfigImportRow
          key={stableProjectConfigImportSourceKey(source.source)}
          source={source}
          activeSourceKind={model.intent?.source.kind ?? null}
          isAvailable={model.availability.availableSourceKeys.has(
            stableProjectConfigImportSourceKey(source.source),
          )}
          onOpen={model.open}
        />
      ))}
      {model.state ? (
        <ProjectConfigImportSheet
          visible
          state={model.state}
          sourceName={model.activeSourceName ?? model.state.intent.source.kind}
          onClose={model.close}
          onRefresh={model.refresh}
          onApply={model.apply}
        />
      ) : null}
    </>
  );
}

function ProjectConfigImportRow({
  source,
  activeSourceKind,
  isAvailable,
  onOpen,
}: {
  source: ProjectConfigImportSourceRegistration;
  activeSourceKind: string | null;
  isAvailable: boolean;
  onOpen: (source: ProjectConfigImportSourceRegistration) => void;
}) {
  const { t } = useTranslation();
  const shouldShow = isAvailable || activeSourceKind === source.kind;
  const handleOpen = useCallback(() => {
    onOpen(source);
  }, [onOpen, source]);

  if (!shouldShow) {
    return null;
  }

  const SourceIcon = getProjectConfigImportViewModule(source.source).Icon;

  const rowTitle = t("settings.project.import.rowTitle", { source: source.module.displayName });
  return (
    <SettingsSection title={rowTitle} testID="project-config-import-section">
      <Pressable
        testID="project-config-import-row"
        accessibilityRole="button"
        accessibilityLabel={rowTitle}
        onPress={handleOpen}
        style={settingsStyles.card}
      >
        <View style={styles.importRow}>
          <SourceIcon size={16} color={styles.iconColor.color} />
          <View style={styles.importText}>
            <Text style={settingsStyles.rowTitle}>{rowTitle}</Text>
            <Text style={settingsStyles.rowHint} numberOfLines={2}>
              {t("settings.project.import.rowDescription", { source: source.module.displayName })}
            </Text>
          </View>
        </View>
      </Pressable>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  importRow: {
    ...settingsStyles.row,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  importText: {
    flex: 1,
    minWidth: 0,
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
}));
