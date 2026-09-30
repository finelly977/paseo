import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { isHtmlFile, useOpenWorkspaceFileInBrowser } from "./open-in-browser";
import { useStableEvent } from "@/hooks/use-stable-event";

export function WorkspaceHtmlBrowserActions(input: {
  serverId: string;
  workspaceRoot: string;
  workspaceId?: string | null;
  path: string;
}) {
  const { t } = useTranslation();
  const browser = useOpenWorkspaceFileInBrowser(input);
  const openInternal = useStableEvent(() => void browser.open(input.path, "internal"));
  const openExternal = useStableEvent(() => void browser.open(input.path, "external"));
  if (!isHtmlFile(input.path)) return null;
  return (
    <View style={styles.toolbar}>
      <View style={styles.row}>
        <Button
          size="xs"
          variant="ghost"
          disabled={!browser.available || browser.pending}
          loading={browser.pending}
          onPress={openInternal}
          testID="html-open-in-browser"
        >
          {t("workspace.fileActions.openInBrowser")}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={!browser.available || browser.pending}
          onPress={openExternal}
          testID="html-open-in-external-browser"
        >
          {t("workspace.fileActions.openInExternalBrowser")}
        </Button>
      </View>
      {!browser.available ? (
        <Text style={styles.hint}>{t("workspace.fileActions.desktopHtmlPreview")}</Text>
      ) : null}
      {browser.error ? (
        <Alert variant="error" description={browser.error} testID="html-browser-error">
          <Button size="xs" variant="ghost" onPress={browser.dismissError}>
            {t("common.actions.dismiss")}
          </Button>
        </Alert>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  toolbar: {
    padding: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[1] },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
