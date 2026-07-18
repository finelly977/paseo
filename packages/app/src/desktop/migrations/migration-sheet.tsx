import { useCallback, useEffect, useMemo, useState } from "react";
import type { ImageSourcePropType } from "react-native";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { getDesktopHost, type DesktopMigrationOutput } from "@/desktop/host";

type MigrationState =
  | { status: "confirm" }
  | { status: "running"; runId: string | null; output: string }
  | { status: "complete"; succeeded: boolean; output: string }
  | { status: "failed"; message: string; output: string };

export interface MigrationSourceDescriptor {
  id: string;
  icon: ImageSourcePropType;
  title: string;
  description: string;
  sheetTitle: string;
  confirmation: string;
}

export function useMigrationAvailability(source: string) {
  const { t } = useTranslation();
  const [availability, setAvailability] = useState<{
    available: boolean;
    reason: string | null;
  }>({
    available: false,
    reason: t("desktop.integrations.migration.availability.checking"),
  });
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let active = true;
    async function loadAvailability() {
      const next = await getDesktopHost()?.migrations?.getAvailability?.({ source });
      if (active && next) {
        setAvailability({
          available: next.available,
          reason: next.reason
            ? t(`desktop.integrations.migration.availability.${next.reason}`)
            : null,
        });
      }
    }
    void loadAvailability();
    return () => {
      active = false;
    };
  }, [source, t]);
  return {
    ...availability,
    visible,
    open: () => setVisible(true),
    close: () => setVisible(false),
  };
}

export function MigrationSheet({
  source,
  visible,
  onClose,
}: {
  source: MigrationSourceDescriptor;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<MigrationState>({ status: "confirm" });
  const header = useMemo<SheetHeader>(() => ({ title: source.sheetTitle }), [source.sheetTitle]);
  const close = useCallback(() => {
    if (state.status !== "running") onClose();
  }, [onClose, state.status]);

  useEffect(() => {
    if (!visible) setState({ status: "confirm" });
  }, [visible]);

  const start = useCallback(async () => {
    const bridge = getDesktopHost()?.migrations;
    if (!bridge?.run || !bridge.onOutput) {
      setState({
        status: "failed",
        message: t("desktop.integrations.migration.unavailable"),
        output: "",
      });
      return;
    }
    setState({ status: "running", runId: null, output: "" });
    let runId: string | null = null;
    const unsubscribe = bridge.onOutput((event: DesktopMigrationOutput) => {
      if (runId && event.runId !== runId) return;
      setState((current) => reduceOutput(current, event));
      if (event.stream === "status") unsubscribe();
    });
    try {
      const started = await bridge.run({ source: source.id });
      runId = started.runId;
      setState((current) =>
        current.status === "running" ? { ...current, runId: started.runId } : current,
      );
    } catch (error) {
      unsubscribe();
      setState({
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
        output: "",
      });
    }
  }, [source.id, t]);

  const footer = useMemo(() => {
    if (state.status === "confirm") {
      return (
        <Button onPress={start} testID="migration-confirm">
          {t("desktop.integrations.migration.actions.import")}
        </Button>
      );
    }
    if (state.status === "running") {
      return <Button disabled>{t("desktop.integrations.migration.actions.importing")}</Button>;
    }
    return (
      <Button onPress={close} testID="migration-done">
        {t("desktop.integrations.migration.actions.done")}
      </Button>
    );
  }, [close, start, state.status, t]);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={close}
      footer={footer}
      desktopMaxWidth={640}
      testID="migration-sheet"
    >
      {state.status === "confirm" ? (
        <Text style={styles.copy}>{source.confirmation}</Text>
      ) : (
        <View style={styles.content}>
          {state.status === "complete" ? (
            <Text testID="migration-result" style={styles.copy}>
              {state.succeeded
                ? t("desktop.integrations.migration.complete")
                : t("desktop.integrations.migration.failed")}
            </Text>
          ) : null}
          {state.status === "failed" ? (
            <Text testID="migration-error" style={styles.error}>
              {state.message}
            </Text>
          ) : null}
          <ScrollView style={styles.output}>
            <Text selectable testID="migration-output" style={styles.outputText}>
              {state.output}
            </Text>
          </ScrollView>
        </View>
      )}
    </AdaptiveModalSheet>
  );
}

function reduceOutput(state: MigrationState, event: DesktopMigrationOutput): MigrationState {
  if (state.status !== "running") return state;
  if (event.stream === "status") {
    return { status: "complete", succeeded: event.exitCode === 0, output: state.output };
  }
  return { ...state, output: `${state.output}${event.chunk ?? ""}` };
}

const styles = StyleSheet.create((theme) => ({
  content: { gap: theme.spacing[3] },
  copy: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  error: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
  output: {
    minHeight: 180,
    maxHeight: 360,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[3],
  },
  outputText: { color: theme.colors.foregroundMuted, fontFamily: "monospace", fontSize: 12 },
}));
