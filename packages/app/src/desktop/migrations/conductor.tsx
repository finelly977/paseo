import { Image, Text, View } from "react-native";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { isElectronRuntimeMac } from "@/desktop/host";
import {
  MigrationSheet,
  type MigrationSourceDescriptor,
  useMigrationAvailability,
} from "./migration-sheet";

const conductorSource = {
  id: "conductor",
  icon: require("./conductor.svg"),
};

export function ConductorMigration() {
  const { t } = useTranslation();
  const source = useMemo<MigrationSourceDescriptor>(
    () => ({
      ...conductorSource,
      title: t("desktop.integrations.migration.conductor.title"),
      description: t("desktop.integrations.migration.conductor.description"),
      sheetTitle: t("desktop.integrations.migration.conductor.sheetTitle"),
      confirmation: t("desktop.integrations.migration.conductor.confirmation"),
    }),
    [t],
  );
  const migration = useMigrationAvailability(source.id);
  if (!isElectronRuntimeMac()) return null;

  return (
    <>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]} testID="conductor-migration-row">
        <View style={settingsStyles.rowContent}>
          <View style={styles.titleRow}>
            <Image source={source.icon} style={styles.icon} />
            <Text style={settingsStyles.rowTitle}>{source.title}</Text>
          </View>
          <Text style={settingsStyles.rowHint}>{migration.reason ?? source.description}</Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          onPress={migration.open}
          disabled={!migration.available}
          testID="conductor-migration-open"
        >
          {t("desktop.integrations.migration.actions.import")}
        </Button>
      </View>
      <MigrationSheet source={source} visible={migration.visible} onClose={migration.close} />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  titleRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  icon: { width: theme.iconSize.md, height: theme.iconSize.md },
}));
