import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
  type TextInputProps,
} from "react-native";
import { useFetchQuery } from "@/data/query";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { Button } from "@/components/ui/button";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { Alert } from "@/components/ui/alert";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useStableEvent } from "@/hooks/use-stable-event";
import { isWeb } from "@/constants/platform";
import { MOTION_PRESS_SCALE } from "@/styles/motion";
import type { Theme } from "@/styles/theme";
import { Search, X } from "lucide-react-native";
import type { DirectorySuggestionsResponse } from "@getpaseo/protocol/messages";

const ThemedSearch = withUnistyles(Search);
const ThemedX = withUnistyles(X);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedTextInput = withUnistyles(TextInput);
const mutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const placeholderColorMapping = (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
});

type SearchEntry = DirectorySuggestionsResponse["payload"]["entries"][number];

function searchEntryKey(entry: SearchEntry): string {
  return entry.path;
}

function splitSearchPath(entryPath: string): { fileName: string; directory: string } {
  const normalized = entryPath.replaceAll("\\", "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) {
    return { fileName: normalized, directory: "" };
  }
  return {
    fileName: normalized.slice(lastSlash + 1),
    directory: normalized.slice(0, lastSlash),
  };
}

function searchResultRowStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.resultRow, (Boolean(hovered) || pressed) && styles.resultRowHovered];
}

function iconActionStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.iconAction,
    Boolean(hovered) && styles.iconActionHovered,
    pressed && styles.iconActionPressed,
  ];
}

function SearchResult({
  entry,
  onOpenFile,
}: {
  entry: SearchEntry;
  onOpenFile: ((path: string) => void) | undefined;
}) {
  const { fileName, directory } = useMemo(() => splitSearchPath(entry.path), [entry.path]);
  const open = useStableEvent(() => onOpenFile?.(entry.path));

  return (
    <Pressable
      onPress={open}
      style={searchResultRowStyle}
      accessibilityRole="button"
      accessibilityLabel={entry.path}
    >
      <View style={styles.resultIcon}>
        <MaterialFileIcon fileName={fileName} size={15} />
      </View>
      <View style={styles.resultLabels}>
        <Text style={styles.resultFileName} numberOfLines={1}>
          {fileName}
        </Text>
        {directory ? (
          <Text style={styles.resultDirectory} numberOfLines={1} ellipsizeMode="middle">
            {directory}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function ExplorerFileSearch({
  client,
  serverId,
  root,
  onOpenFile,
  onActiveChange,
  onClose,
}: {
  client: DaemonClient | null;
  serverId: string;
  root: string;
  onOpenFile?: (path: string) => void;
  onActiveChange: (active: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [query, setQuery] = useState("");
  const [isFocused, setFocused] = useState(false);
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
  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);
  const renderResult = useCallback(
    ({ item }: { item: SearchEntry }) => <SearchResult entry={item} onOpenFile={onOpenFile} />,
    [onOpenFile],
  );
  const active = value.trim().length > 0;
  const handleKeyPress = useCallback<NonNullable<TextInputProps["onKeyPress"]>>(
    (event) => {
      if (event.nativeEvent.key === "Escape") onClose();
    },
    [onClose],
  );

  return (
    <View style={[styles.container, active && styles.active]}>
      <View style={styles.searchRow}>
        <View style={[styles.inputShell, isFocused && styles.inputShellFocused]}>
          <ThemedSearch size={13} strokeWidth={1.75} uniProps={mutedIconColorMapping} />
          <ThemedTextInput
            autoFocus
            value={value}
            onChangeText={setValue}
            style={styles.input}
            placeholder={t("workspace.fileActions.searchFiles")}
            uniProps={placeholderColorMapping}
            accessibilityLabel={t("workspace.fileActions.searchFiles")}
            testID="file-explorer-search"
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyPress={handleKeyPress}
          />
          {value.length > 0 ? (
            <Pressable
              onPress={clear}
              style={iconActionStyle}
              accessibilityRole="button"
              accessibilityLabel={t("workspace.fileActions.clearSearch")}
              testID="file-explorer-search-clear"
              hitSlop={4}
            >
              <ThemedX size={12} strokeWidth={1.9} uniProps={mutedIconColorMapping} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={onClose}
          style={iconActionStyle}
          accessibilityRole="button"
          accessibilityLabel={t("common.actions.close")}
          testID="file-explorer-search-close"
          hitSlop={4}
        >
          <ThemedX size={14} strokeWidth={1.75} uniProps={mutedIconColorMapping} />
        </Pressable>
      </View>
      {active ? (
        <View style={styles.resultsArea}>
          {result.isFetching ? (
            <View style={styles.statusRow}>
              <ThemedLoadingSpinner size={12} uniProps={mutedIconColorMapping} />
              <Text style={styles.hint}>{t("panels.file.loading")}</Text>
            </View>
          ) : null}
          {result.error ? (
            <Alert variant="error" description={result.error.message}>
              <Button size="xs" onPress={retry}>
                {t("workspace.fileExplorer.actions.retry")}
              </Button>
            </Alert>
          ) : null}
          {!result.isFetching && !result.error && result.data?.length === 0 ? (
            <View style={styles.statusRow}>
              <Text style={styles.hint}>{t("workspace.fileActions.noSearchResults")}</Text>
            </View>
          ) : null}
          <FlatList
            data={result.data ?? []}
            keyExtractor={searchEntryKey}
            renderItem={renderResult}
            contentContainerStyle={styles.resultsContent}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: theme.spacing[1.5],
  },
  active: {
    flex: 1,
    minHeight: 0,
    borderBottomWidth: 0,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  inputShell: {
    flex: 1,
    minWidth: 0,
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[1],
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    ...(isWeb ? ({ transition: "border-color 120ms ease" } as object) : {}),
  },
  inputShellFocused: {
    borderColor: theme.colors.borderAccent,
  },
  input: {
    ...(isWeb ? { outlineWidth: 0 } : {}),
    flex: 1,
    minWidth: 0,
    height: "100%",
    paddingVertical: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sidebar,
  },
  iconAction: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    ...(isWeb
      ? ({ transition: "background-color 120ms ease, transform 100ms ease" } as object)
      : {}),
  },
  iconActionHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  iconActionPressed: {
    transform: [{ scale: MOTION_PRESS_SCALE.iconButton }],
  },
  resultsArea: {
    flex: 1,
    minHeight: 0,
  },
  resultsContent: {
    paddingBottom: theme.spacing[4],
    gap: 1,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 30,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    ...(isWeb ? ({ transition: "background-color 120ms ease" } as object) : {}),
  },
  resultRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  resultIcon: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  resultLabels: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing[1.5],
  },
  resultFileName: {
    color: theme.colors.foregroundSidebar,
    fontSize: theme.fontSize.sidebar,
    flexShrink: 0,
    maxWidth: "70%",
  },
  resultDirectory: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: 13,
  },
}));
