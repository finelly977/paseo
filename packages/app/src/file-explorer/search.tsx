import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, TextInput, View, FlatList } from "react-native";
import { useFetchQuery } from "@/data/query";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { Button } from "@/components/ui/button";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { Alert } from "@/components/ui/alert";
import { useStableEvent } from "@/hooks/use-stable-event";
import type { DirectorySuggestionsResponse } from "@getpaseo/protocol/messages";

type SearchEntry = DirectorySuggestionsResponse["payload"]["entries"][number];

function searchEntryKey(entry: SearchEntry): string {
  return entry.path;
}

function SearchResult({
  entry,
  onOpenFile,
}: {
  entry: SearchEntry;
  onOpenFile: ((path: string) => void) | undefined;
}) {
  const icon = useMemo(() => <MaterialFileIcon fileName={entry.path} size={16} />, [entry.path]);
  const open = useStableEvent(() => onOpenFile?.(entry.path));
  return (
    <Button variant="ghost" size="sm" leftIcon={icon} onPress={open} style={styles.result}>
      {entry.path}
    </Button>
  );
}

export function ExplorerFileSearch({
  client,
  serverId,
  root,
  onOpenFile,
  onActiveChange,
}: {
  client: DaemonClient | null;
  serverId: string;
  root: string;
  onOpenFile?: (path: string) => void;
  onActiveChange: (active: boolean) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    onActiveChange(value.trim().length > 0);
    const timer = setTimeout(() => setQuery(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [onActiveChange, value]);
  const result = useFetchQuery({
    queryKey: ["workspaceFileSearch", serverId, root, query],
    dataShape: "value",
    staleTimeMs: 5000,
    enabled: Boolean(query && client),
    retry: false,
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      const found = await client.getDirectorySuggestions({
        cwd: root,
        query,
        includeFiles: true,
        includeDirectories: false,
        matchMode: "fuzzy",
        limit: 100,
      });
      if (found.error) throw new Error(found.error);
      return found.entries;
    },
  });
  const clear = useStableEvent(() => setValue(""));
  const retry = useStableEvent(() => void result.refetch());
  const renderResult = useCallback(
    ({ item }: { item: SearchEntry }) => <SearchResult entry={item} onOpenFile={onOpenFile} />,
    [onOpenFile],
  );
  const active = value.trim().length > 0;
  return (
    <View style={[styles.container, active && styles.active]}>
      <TextInput
        value={value}
        onChangeText={setValue}
        style={styles.input}
        placeholder={t("workspace.fileActions.searchFiles")}
        accessibilityLabel={t("workspace.fileActions.searchFiles")}
        testID="file-explorer-search"
      />
      {active ? (
        <>
          <Button size="xs" variant="ghost" onPress={clear}>
            {t("workspace.fileActions.clearSearch")}
          </Button>
          {result.isFetching ? <Text style={styles.hint}>{t("panels.file.loading")}</Text> : null}
          {result.error ? (
            <Alert variant="error" description={result.error.message}>
              <Button size="xs" onPress={retry}>
                {t("workspace.fileExplorer.actions.retry")}
              </Button>
            </Alert>
          ) : null}
          {!result.isFetching && !result.error && result.data?.length === 0 ? (
            <Text style={styles.hint}>{t("workspace.fileActions.noSearchResults")}</Text>
          ) : null}
          <FlatList
            data={result.data ?? []}
            keyExtractor={searchEntryKey}
            renderItem={renderResult}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { padding: theme.spacing[2], gap: theme.spacing[1] },
  active: { flex: 1, minHeight: 0 },
  input: {
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    padding: theme.spacing[2],
    fontSize: theme.fontSize.sm,
  },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  result: { justifyContent: "flex-start" },
}));
