import { useCallback, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { queryClient as appQueryClient } from "@/data/query-client";
import type { AppLanguage } from "@/i18n/locales";
import {
  DEFAULT_DESKTOP_SETTINGS,
  loadDesktopSettings,
  migrateLegacyDesktopSettings,
  useDesktopSettings,
} from "@/desktop/settings/desktop-settings";
import { isElectronRuntime } from "@/desktop/host";
import {
  APP_SETTINGS_KEY,
  APP_SETTINGS_QUERY_KEY,
  DEFAULT_APP_SETTINGS,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  DEFAULT_UI_FONT_SIZE,
  MAX_CODE_FONT_SIZE,
  MAX_TERMINAL_SCROLLBACK_LINES,
  MAX_UI_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_TERMINAL_SCROLLBACK_LINES,
  MIN_UI_FONT_SIZE,
  DEFAULT_MESSAGE_PARAGRAPH_SPACING,
  MIN_MESSAGE_PARAGRAPH_SPACING,
  MAX_MESSAGE_PARAGRAPH_SPACING,
  DEFAULT_SIDEBAR_WORKSPACE_VISIBLE_COUNT,
  MIN_SIDEBAR_WORKSPACE_VISIBLE_COUNT,
  MAX_SIDEBAR_WORKSPACE_VISIBLE_COUNT,
  loadAppSettingsFromStorage as loadAppSettingsFromStoragePure,
  loadSettingsFromStorage as loadSettingsFromStoragePure,
  normalizeAppSettings,
  parseBoundedInteger,
  parseClampedFontSize,
  parseTerminalScrollbackLines,
  sanitizeFontFamily,
  saveAppSettings as saveAppSettingsPure,
  type AppSettings,
  type DesktopSettingsBridge,
  type KeyValueStorage,
  type ReleaseChannel,
  type SendBehavior,
  type ServiceUrlBehavior,
  type Settings,
  type SettingsDeps,
  type WorkspaceTitleSource,
} from "./storage";
export {
  DEFAULT_CONVERSATION_HISTORY_LOAD_COUNT,
  DEFAULT_TOTAL_CONVERSATION_HISTORY_LIMIT,
  MAX_CONVERSATION_HISTORY_LOAD_COUNT,
  MAX_TOTAL_CONVERSATION_HISTORY_LIMIT,
  MIN_CONVERSATION_HISTORY_LOAD_COUNT,
  MIN_TOTAL_CONVERSATION_HISTORY_LIMIT,
} from "@/timeline/conversation-history-policy";

export {
  APP_SETTINGS_KEY,
  DEFAULT_APP_SETTINGS,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  DEFAULT_UI_FONT_SIZE,
  MAX_CODE_FONT_SIZE,
  MAX_TERMINAL_SCROLLBACK_LINES,
  MAX_UI_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_TERMINAL_SCROLLBACK_LINES,
  MIN_UI_FONT_SIZE,
  DEFAULT_MESSAGE_PARAGRAPH_SPACING,
  MIN_MESSAGE_PARAGRAPH_SPACING,
  MAX_MESSAGE_PARAGRAPH_SPACING,
  DEFAULT_SIDEBAR_WORKSPACE_VISIBLE_COUNT,
  MIN_SIDEBAR_WORKSPACE_VISIBLE_COUNT,
  MAX_SIDEBAR_WORKSPACE_VISIBLE_COUNT,
  parseClampedFontSize,
  parseBoundedInteger,
  parseTerminalScrollbackLines,
  sanitizeFontFamily,
};
export type {
  AppSettings,
  AppLanguage,
  DesktopSettingsBridge,
  KeyValueStorage,
  ReleaseChannel,
  SendBehavior,
  ServiceUrlBehavior,
  Settings,
  SettingsDeps,
  WorkspaceTitleSource,
};

const productionDeps: SettingsDeps = {
  storage: AsyncStorage,
  desktop: {
    isElectron: isElectronRuntime,
    loadDesktopSettings,
    migrateLegacyDesktopSettings,
  },
};

export interface UseAppSettingsReturn {
  settings: AppSettings;
  isLoading: boolean;
  error: unknown;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  resetSettings: () => Promise<void>;
}

export interface UseSettingsReturn {
  settings: Settings;
  isLoading: boolean;
  error: unknown;
  updateSettings: (updates: Partial<Settings>) => Promise<void>;
  resetSettings: () => Promise<void>;
}

type SettingsSelector<TSelected> = (settings: Settings) => TSelected;
type NumericAppSetting =
  | "uiFontSize"
  | "codeFontSize"
  | "messageParagraphSpacing"
  | "sidebarWorkspaceVisibleCount"
  | "conversationHistoryLoadCount"
  | "totalConversationHistoryLimit";

function copyDefinedNumericAppSetting(
  target: Partial<AppSettings>,
  source: Partial<Settings>,
  key: NumericAppSetting,
): void {
  const value = source[key];
  if (value !== undefined) {
    target[key] = value;
  }
}

export function useAppSettings(): UseAppSettingsReturn {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: () => loadAppSettingsFromStorage(),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const updateSettings = useCallback(
    async (updates: Partial<AppSettings>) => {
      try {
        await saveAppSettings({ queryClient, updates });
      } catch (err) {
        console.error("[AppSettings] Failed to save settings:", err);
        throw err;
      }
    },
    [queryClient],
  );

  const resetSettings = useCallback(async () => {
    try {
      const next = { ...DEFAULT_CLIENT_SETTINGS };
      queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, next);
      await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
    } catch (err) {
      console.error("[AppSettings] Failed to reset settings:", err);
      throw err;
    }
  }, [queryClient]);
  const settings = useMemo(() => normalizeAppSettings(data), [data]);

  return {
    settings,
    isLoading: isPending,
    error: error ?? null,
    updateSettings,
    resetSettings,
  };
}

export function useSettings(): UseSettingsReturn;
export function useSettings<TSelected>(selector: SettingsSelector<TSelected>): TSelected;
export function useSettings<TSelected>(
  selector?: SettingsSelector<TSelected>,
): UseSettingsReturn | TSelected {
  const appSettings = useAppSettings();
  const desktopSettings = useDesktopSettings();

  const updateSettings = useCallback(
    async (updates: Partial<Settings>) => {
      const appUpdates: Partial<AppSettings> = {};
      if (updates.theme !== undefined) {
        appUpdates.theme = updates.theme;
      }
      if (updates.language !== undefined) {
        appUpdates.language = updates.language;
      }
      if (updates.sendBehavior !== undefined) {
        appUpdates.sendBehavior = updates.sendBehavior;
      }
      if (updates.serviceUrlBehavior !== undefined) {
        appUpdates.serviceUrlBehavior = updates.serviceUrlBehavior;
      }
      if (updates.terminalScrollbackLines !== undefined) {
        appUpdates.terminalScrollbackLines = updates.terminalScrollbackLines;
      }
      if (updates.uiFontFamily !== undefined) {
        appUpdates.uiFontFamily = updates.uiFontFamily;
      }
      if (updates.monoFontFamily !== undefined) {
        appUpdates.monoFontFamily = updates.monoFontFamily;
      }
      copyDefinedNumericAppSetting(appUpdates, updates, "uiFontSize");
      copyDefinedNumericAppSetting(appUpdates, updates, "codeFontSize");
      copyDefinedNumericAppSetting(appUpdates, updates, "messageParagraphSpacing");
      copyDefinedNumericAppSetting(appUpdates, updates, "sidebarWorkspaceVisibleCount");
      copyDefinedNumericAppSetting(appUpdates, updates, "conversationHistoryLoadCount");
      copyDefinedNumericAppSetting(appUpdates, updates, "totalConversationHistoryLimit");
      if (updates.syntaxTheme !== undefined) {
        appUpdates.syntaxTheme = updates.syntaxTheme;
      }
      if (updates.workspaceTitleSource !== undefined) {
        appUpdates.workspaceTitleSource = updates.workspaceTitleSource;
      }
      if (updates.autoExpandReasoning !== undefined) {
        appUpdates.autoExpandReasoning = updates.autoExpandReasoning;
      }
      if (updates.toolCallDetailLevel !== undefined) {
        appUpdates.toolCallDetailLevel = updates.toolCallDetailLevel;
      }
      if (updates.vimKeybindings !== undefined) {
        appUpdates.vimKeybindings = updates.vimKeybindings;
      }
      const promises: Promise<void>[] = [];
      if (Object.keys(appUpdates).length > 0) {
        promises.push(appSettings.updateSettings(appUpdates));
      }

      if (isElectronRuntime()) {
        const desktopUpdates: Parameters<typeof desktopSettings.updateSettings>[0] = {};
        if (updates.manageBuiltInDaemon !== undefined) {
          desktopUpdates.daemon = {
            manageBuiltInDaemon: updates.manageBuiltInDaemon,
          };
        }
        if (updates.releaseChannel !== undefined) {
          desktopUpdates.releaseChannel = updates.releaseChannel;
        }
        if (Object.keys(desktopUpdates).length > 0) {
          promises.push(desktopSettings.updateSettings(desktopUpdates));
        }
      }

      await Promise.all(promises);
    },
    [appSettings, desktopSettings],
  );

  const resetSettings = useCallback(async () => {
    const resets: Promise<void>[] = [appSettings.resetSettings()];
    if (isElectronRuntime()) {
      resets.push(desktopSettings.updateSettings(DEFAULT_DESKTOP_SETTINGS));
    }
    await Promise.all(resets);
  }, [appSettings, desktopSettings]);

  const settings = {
    ...DEFAULT_APP_SETTINGS,
    ...appSettings.settings,
    manageBuiltInDaemon: desktopSettings.settings.daemon.manageBuiltInDaemon,
    releaseChannel: desktopSettings.settings.releaseChannel,
  };

  if (selector) {
    return selector(settings);
  }

  return {
    settings,
    isLoading: appSettings.isLoading || desktopSettings.isLoading,
    error: appSettings.error ?? desktopSettings.error,
    updateSettings,
    resetSettings,
  };
}

export async function persistAppSettings(updates: Partial<AppSettings>): Promise<void> {
  await saveAppSettings({ queryClient: appQueryClient, updates });
}

export async function saveAppSettings(input: {
  queryClient: QueryClient;
  updates: Partial<AppSettings>;
  deps?: SettingsDeps;
}): Promise<void> {
  await saveAppSettingsPure({
    queryClient: input.queryClient,
    updates: input.updates,
    deps: input.deps ?? productionDeps,
  });
}

export async function loadAppSettingsFromStorage(deps?: SettingsDeps): Promise<AppSettings> {
  return loadAppSettingsFromStoragePure(deps ?? productionDeps);
}

export async function loadSettingsFromStorage(deps?: SettingsDeps): Promise<Settings> {
  return loadSettingsFromStoragePure(deps ?? productionDeps);
}
