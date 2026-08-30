import { isSyntaxThemeId, type SyntaxThemeId } from "@getpaseo/highlight";
import type { ActiveTurnBehavior } from "@getpaseo/protocol/messages";
import type { QueryClient } from "@tanstack/react-query";
import type { DesktopSettings } from "@/desktop/settings/desktop-settings";
import { parseAppLanguage, type AppLanguage } from "@/i18n/locales";
import { PLUGIN_THEME_PREFERENCE, type ThemePreference } from "@/styles/theme";
import {
  DEFAULT_CONVERSATION_HISTORY_LOAD_COUNT,
  DEFAULT_TOTAL_CONVERSATION_HISTORY_LIMIT,
  MAX_CONVERSATION_HISTORY_LOAD_COUNT,
  MAX_TOTAL_CONVERSATION_HISTORY_LIMIT,
  MIN_CONVERSATION_HISTORY_LOAD_COUNT,
  MIN_TOTAL_CONVERSATION_HISTORY_LIMIT,
} from "@/timeline/conversation-history-policy";
import { z } from "zod";
import { readValidatedJson } from "@/storage/validated-storage";
import { APP_SETTINGS_KEY, LEGACY_SETTINGS_KEY } from "./keys";
import { migrateAppSettings } from "./migrations";

export { APP_SETTINGS_KEY } from "./keys";
export const APP_SETTINGS_QUERY_KEY = ["app-settings"];

export type SendBehavior = ActiveTurnBehavior | "queue";
export type ReleaseChannel = "stable" | "beta";
export type ServiceUrlBehavior = "ask" | "in-app" | "external";
export type WorkspaceTitleSource = "title" | "branch";
export type ToolCallDetailLevel = "overview" | "detailed";

export const DEFAULT_THEME_PREFERENCE = "auto" satisfies ThemePreference;
const ThemePreferenceSchema = z.enum([
  "light",
  "dark",
  "zinc",
  "midnight",
  "claude",
  "ghostty",
  "auto",
  PLUGIN_THEME_PREFERENCE,
]);
export const DEFAULT_TERMINAL_SCROLLBACK_LINES = 10_000;
export const MIN_TERMINAL_SCROLLBACK_LINES = 0;
export const MAX_TERMINAL_SCROLLBACK_LINES = 1_000_000;
export const DEFAULT_UI_FONT_SIZE = 16; // == FONT_SIZE.base
export const MIN_UI_FONT_SIZE = 11;
export const MAX_UI_FONT_SIZE = 24;
export const DEFAULT_CODE_FONT_SIZE = 12; // == FONT_SIZE.code
export const MIN_CODE_FONT_SIZE = 9;
export const MAX_CODE_FONT_SIZE = 22; // line-height 1.5×22=33 stays safe
export const MAX_FONT_FAMILY_LENGTH = 200;
export const DEFAULT_MESSAGE_PARAGRAPH_SPACING = 8; // 对应 SPACING[2]，默认的段落间距
export const MIN_MESSAGE_PARAGRAPH_SPACING = 0;
export const MAX_MESSAGE_PARAGRAPH_SPACING = 32;
export const DEFAULT_CONVERSATION_MESSAGE_SPACING = 12;
export const MIN_CONVERSATION_MESSAGE_SPACING = 0;
export const MAX_CONVERSATION_MESSAGE_SPACING = 32;
export const DEFAULT_CONVERSATION_DIVIDER_SPACING = 8;
export const MIN_CONVERSATION_DIVIDER_SPACING = 0;
export const MAX_CONVERSATION_DIVIDER_SPACING = 32;
export const DEFAULT_CONVERSATION_VERTICAL_PADDING = 16;
export const MIN_CONVERSATION_VERTICAL_PADDING = 0;
export const MAX_CONVERSATION_VERTICAL_PADDING = 48;
export const DEFAULT_CONVERSATION_HORIZONTAL_PADDING = 16;
export const MIN_CONVERSATION_HORIZONTAL_PADDING = 0;
export const MAX_CONVERSATION_HORIZONTAL_PADDING = 48;
export const DEFAULT_SIDEBAR_WORKSPACE_VISIBLE_COUNT = 5;
export const MIN_SIDEBAR_WORKSPACE_VISIBLE_COUNT = 1;
export const MAX_SIDEBAR_WORKSPACE_VISIBLE_COUNT = 100;
export const DEFAULT_SIDEBAR_PROJECT_SPACING = 2;
export const MIN_SIDEBAR_PROJECT_SPACING = 0;
export const MAX_SIDEBAR_PROJECT_SPACING = 24;
export const DEFAULT_SIDEBAR_SESSION_SPACING = 2;
export const MIN_SIDEBAR_SESSION_SPACING = 0;
export const MAX_SIDEBAR_SESSION_SPACING = 24;
export const DEFAULT_SIDEBAR_ROW_VERTICAL_PADDING = 4;
export const MIN_SIDEBAR_ROW_VERTICAL_PADDING = 0;
export const MAX_SIDEBAR_ROW_VERTICAL_PADDING = 16;
export const DEFAULT_SIDEBAR_HORIZONTAL_PADDING = 8;
export const MIN_SIDEBAR_HORIZONTAL_PADDING = 0;
export const MAX_SIDEBAR_HORIZONTAL_PADDING = 32;

export interface AppSettings {
  theme: ThemePreference;
  /** `theme` 为插件主题时，记录 `<插件标识>/theme/<主题标识>`。 */
  pluginThemeId: string | null;
  language: AppLanguage;
  sendBehavior: SendBehavior;
  serviceUrlBehavior: ServiceUrlBehavior;
  terminalScrollbackLines: number;
  uiFontFamily: string; // "" = platform default UI stack
  monoFontFamily: string; // "" = platform default mono stack
  uiFontSize: number; // clamped px, default 16
  codeFontSize: number; // clamped px, default 12
  syntaxTheme: SyntaxThemeId; // default "one"
  workspaceTitleSource: WorkspaceTitleSource;
  autoExpandReasoning: boolean;
  toolCallDetailLevel: ToolCallDetailLevel;
  vimKeybindings: boolean;
  messageParagraphSpacing: number; // 每个消息段落下方的像素间距，默认 8
  conversationMessageSpacing: number;
  conversationDividerSpacing: number;
  conversationVerticalPadding: number;
  conversationHorizontalPadding: number;
  sidebarWorkspaceVisibleCount: number;
  sidebarProjectSpacing: number;
  sidebarSessionSpacing: number;
  sidebarRowVerticalPadding: number;
  sidebarHorizontalPadding: number;
  conversationHistoryLoadCount: number;
  totalConversationHistoryLimit: number;
}

export interface Settings extends AppSettings {
  manageBuiltInDaemon: boolean;
  releaseChannel: ReleaseChannel;
}

const StoredAppSettingsSchema = z.looseObject({
  theme: z.unknown().optional(),
  pluginThemeId: z.unknown().optional(),
  language: z.unknown().optional(),
  sendBehavior: z.unknown().optional(),
  serviceUrlBehavior: z.unknown().optional(),
  terminalScrollbackLines: z.unknown().optional(),
  uiFontFamily: z.unknown().optional(),
  monoFontFamily: z.unknown().optional(),
  uiFontSize: z.unknown().optional(),
  codeFontSize: z.unknown().optional(),
  syntaxTheme: z.unknown().optional(),
  workspaceTitleSource: z.unknown().optional(),
  autoExpandReasoning: z.unknown().optional(),
  toolCallDetailLevel: z.unknown().optional(),
  compactToolCalls: z.unknown().optional(),
  vimKeybindings: z.unknown().optional(),
  messageParagraphSpacing: z.unknown().optional(),
  conversationMessageSpacing: z.unknown().optional(),
  conversationDividerSpacing: z.unknown().optional(),
  conversationVerticalPadding: z.unknown().optional(),
  conversationHorizontalPadding: z.unknown().optional(),
  sidebarWorkspaceVisibleCount: z.unknown().optional(),
  sidebarProjectSpacing: z.unknown().optional(),
  sidebarSessionSpacing: z.unknown().optional(),
  sidebarRowVerticalPadding: z.unknown().optional(),
  sidebarHorizontalPadding: z.unknown().optional(),
  conversationHistoryLoadCount: z.unknown().optional(),
  totalConversationHistoryLimit: z.unknown().optional(),
  // COMPAT(rendererDesktopSettings): these fields used to share this renderer-owned key.
  manageBuiltInDaemon: z.unknown().optional(),
  releaseChannel: z.unknown().optional(),
});

const LegacyRendererSettingsSchema = StoredAppSettingsSchema;

type StoredAppSettings = z.infer<typeof StoredAppSettingsSchema>;
export type PersistedAppSettings = StoredAppSettings;

export const DEFAULT_CLIENT_SETTINGS: AppSettings = {
  theme: DEFAULT_THEME_PREFERENCE,
  pluginThemeId: null,
  language: "system",
  sendBehavior: "steer",
  serviceUrlBehavior: "ask",
  terminalScrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
  uiFontFamily: "",
  monoFontFamily: "",
  uiFontSize: DEFAULT_UI_FONT_SIZE,
  codeFontSize: DEFAULT_CODE_FONT_SIZE,
  syntaxTheme: "one",
  workspaceTitleSource: "title",
  autoExpandReasoning: false,
  toolCallDetailLevel: "detailed",
  vimKeybindings: false,
  messageParagraphSpacing: DEFAULT_MESSAGE_PARAGRAPH_SPACING,
  conversationMessageSpacing: DEFAULT_CONVERSATION_MESSAGE_SPACING,
  conversationDividerSpacing: DEFAULT_CONVERSATION_DIVIDER_SPACING,
  conversationVerticalPadding: DEFAULT_CONVERSATION_VERTICAL_PADDING,
  conversationHorizontalPadding: DEFAULT_CONVERSATION_HORIZONTAL_PADDING,
  sidebarWorkspaceVisibleCount: DEFAULT_SIDEBAR_WORKSPACE_VISIBLE_COUNT,
  sidebarProjectSpacing: DEFAULT_SIDEBAR_PROJECT_SPACING,
  sidebarSessionSpacing: DEFAULT_SIDEBAR_SESSION_SPACING,
  sidebarRowVerticalPadding: DEFAULT_SIDEBAR_ROW_VERTICAL_PADDING,
  sidebarHorizontalPadding: DEFAULT_SIDEBAR_HORIZONTAL_PADDING,
  conversationHistoryLoadCount: DEFAULT_CONVERSATION_HISTORY_LOAD_COUNT,
  totalConversationHistoryLimit: DEFAULT_TOTAL_CONVERSATION_HISTORY_LIMIT,
};

export const DEFAULT_APP_SETTINGS: Settings = {
  ...DEFAULT_CLIENT_SETTINGS,
  manageBuiltInDaemon: true,
  releaseChannel: "stable",
};

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface DesktopSettingsBridge {
  isElectron(): boolean;
  loadDesktopSettings(): Promise<DesktopSettings>;
  migrateLegacyDesktopSettings(input: {
    manageBuiltInDaemon?: boolean;
    releaseChannel?: ReleaseChannel;
  }): Promise<void>;
}

export interface SettingsDeps {
  storage: KeyValueStorage;
  desktop: DesktopSettingsBridge;
}

export async function saveAppSettings(input: {
  queryClient: QueryClient;
  updates: Partial<AppSettings>;
  deps: SettingsDeps;
}): Promise<void> {
  const storedCurrent =
    input.queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ??
    (await loadAppSettingsFromStorage(input.deps));
  const current = normalizeAppSettings(storedCurrent);
  const next = { ...current, ...input.updates };
  input.queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, next);
  const stored =
    (await readValidatedJson(input.deps.storage, APP_SETTINGS_KEY, StoredAppSettingsSchema)) ?? {};
  await writeAppSettings(input.deps.storage, stored, next);
}

export async function loadAppSettingsFromStorage(deps: SettingsDeps): Promise<AppSettings> {
  try {
    const read = await readAppSettings(deps);
    if (read.needsWrite) {
      await writeAppSettings(deps.storage, read.stored, read.settings);
    }
    return await migrateAppSettings(read.settings, deps.storage, read.stored);
  } catch (error) {
    console.error("[AppSettings] Failed to load settings:", error);
    throw error;
  }
}

/**
 * Reads whichever of the settings blobs exists, without migrating. `needsWrite` covers the reads
 * that produce settings the stored blob does not already spell out.
 */
async function readAppSettings(
  deps: SettingsDeps,
): Promise<{ settings: AppSettings; needsWrite: boolean; stored: StoredAppSettings }> {
  const stored = await readValidatedJson(deps.storage, APP_SETTINGS_KEY, StoredAppSettingsSchema);
  if (stored) {
    return {
      settings: normalizeAppSettings(stored),
      needsWrite: false,
      stored,
    };
  }

  const legacyStored = await readValidatedJson(
    deps.storage,
    LEGACY_SETTINGS_KEY,
    LegacyRendererSettingsSchema,
  );
  if (legacyStored) {
    return {
      settings: {
        ...DEFAULT_CLIENT_SETTINGS,
        ...pickAppSettingsFromLegacy(legacyStored),
      } satisfies AppSettings,
      needsWrite: true,
      stored: legacyStored,
    };
  }

  return { settings: DEFAULT_CLIENT_SETTINGS, needsWrite: true, stored: {} };
}

export async function loadSettingsFromStorage(deps: SettingsDeps): Promise<Settings> {
  const legacyDesktopSettings = deps.desktop.isElectron()
    ? await loadLegacyDesktopSettingsFromStorage(deps.storage)
    : null;
  const appSettings = await loadAppSettingsFromStorage(deps);

  if (!deps.desktop.isElectron()) {
    return {
      ...DEFAULT_APP_SETTINGS,
      ...appSettings,
    };
  }

  if (legacyDesktopSettings) {
    await deps.desktop.migrateLegacyDesktopSettings(legacyDesktopSettings);
  }

  const desktopSettings = await deps.desktop.loadDesktopSettings();
  return {
    ...DEFAULT_APP_SETTINGS,
    ...appSettings,
    manageBuiltInDaemon: desktopSettings.daemon.manageBuiltInDaemon,
    releaseChannel: desktopSettings.releaseChannel,
  };
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const result = StoredAppSettingsSchema.safeParse(value);
  return {
    ...DEFAULT_CLIENT_SETTINGS,
    ...pickAppSettings(result.success ? result.data : {}),
  };
}

function parseToolCallDetailLevel(stored: StoredAppSettings): ToolCallDetailLevel | null {
  if (stored.toolCallDetailLevel !== undefined) {
    if (stored.toolCallDetailLevel === "overview" || stored.toolCallDetailLevel === "detailed") {
      return stored.toolCallDetailLevel;
    }
    // COMPAT(toolCallDetailLevelConcise): v0.1.107 移除了 concise，2027-01-14 后删除。
    return stored.toolCallDetailLevel === "concise" ? "overview" : null;
  }
  if (typeof stored.compactToolCalls === "boolean") {
    // COMPAT(compactToolCalls): migrated in v0.1.105, remove after 2027-01-12.
    return stored.compactToolCalls ? "overview" : "detailed";
  }
  return null;
}

type NumericAppSetting =
  | "uiFontSize"
  | "codeFontSize"
  | "messageParagraphSpacing"
  | "conversationMessageSpacing"
  | "conversationDividerSpacing"
  | "conversationVerticalPadding"
  | "conversationHorizontalPadding"
  | "sidebarWorkspaceVisibleCount"
  | "sidebarProjectSpacing"
  | "sidebarSessionSpacing"
  | "sidebarRowVerticalPadding"
  | "sidebarHorizontalPadding"
  | "conversationHistoryLoadCount"
  | "totalConversationHistoryLimit";

function copyClampedNumericSetting(
  result: Partial<AppSettings>,
  key: NumericAppSetting,
  value: unknown,
  bounds: { min: number; max: number },
): void {
  const parsed = parseClampedFontSize(value, bounds);
  if (parsed !== null) {
    result[key] = parsed;
  }
}

function pickAppSettings(stored: StoredAppSettings): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  const theme = ThemePreferenceSchema.safeParse(stored.theme);
  if (theme.success) {
    result.theme = theme.data;
  }
  if (typeof stored.pluginThemeId === "string") {
    result.pluginThemeId = stored.pluginThemeId;
  }
  const language = parseAppLanguage(stored.language);
  if (language !== null) {
    result.language = language;
  }
  if (
    stored.sendBehavior === "interrupt" ||
    stored.sendBehavior === "steer" ||
    stored.sendBehavior === "queue"
  ) {
    result.sendBehavior = stored.sendBehavior;
  }
  if (
    stored.serviceUrlBehavior === "ask" ||
    stored.serviceUrlBehavior === "in-app" ||
    stored.serviceUrlBehavior === "external"
  ) {
    result.serviceUrlBehavior = stored.serviceUrlBehavior;
  }
  const terminalScrollbackLines = parseTerminalScrollbackLines(stored.terminalScrollbackLines);
  if (terminalScrollbackLines !== null) {
    result.terminalScrollbackLines = terminalScrollbackLines;
  }
  const uiFontFamily = sanitizeFontFamily(stored.uiFontFamily);
  if (uiFontFamily !== null) {
    result.uiFontFamily = uiFontFamily;
  }
  const monoFontFamily = sanitizeFontFamily(stored.monoFontFamily);
  if (monoFontFamily !== null) {
    result.monoFontFamily = monoFontFamily;
  }
  copyClampedNumericSetting(result, "uiFontSize", stored.uiFontSize, {
    min: MIN_UI_FONT_SIZE,
    max: MAX_UI_FONT_SIZE,
  });
  copyClampedNumericSetting(result, "codeFontSize", stored.codeFontSize, {
    min: MIN_CODE_FONT_SIZE,
    max: MAX_CODE_FONT_SIZE,
  });
  copyClampedNumericSetting(result, "messageParagraphSpacing", stored.messageParagraphSpacing, {
    min: MIN_MESSAGE_PARAGRAPH_SPACING,
    max: MAX_MESSAGE_PARAGRAPH_SPACING,
  });
  copyClampedNumericSetting(
    result,
    "conversationMessageSpacing",
    stored.conversationMessageSpacing,
    {
      min: MIN_CONVERSATION_MESSAGE_SPACING,
      max: MAX_CONVERSATION_MESSAGE_SPACING,
    },
  );
  copyClampedNumericSetting(
    result,
    "conversationDividerSpacing",
    stored.conversationDividerSpacing,
    {
      min: MIN_CONVERSATION_DIVIDER_SPACING,
      max: MAX_CONVERSATION_DIVIDER_SPACING,
    },
  );
  copyClampedNumericSetting(
    result,
    "conversationVerticalPadding",
    stored.conversationVerticalPadding,
    {
      min: MIN_CONVERSATION_VERTICAL_PADDING,
      max: MAX_CONVERSATION_VERTICAL_PADDING,
    },
  );
  copyClampedNumericSetting(
    result,
    "conversationHorizontalPadding",
    stored.conversationHorizontalPadding,
    {
      min: MIN_CONVERSATION_HORIZONTAL_PADDING,
      max: MAX_CONVERSATION_HORIZONTAL_PADDING,
    },
  );
  copyClampedNumericSetting(
    result,
    "sidebarWorkspaceVisibleCount",
    stored.sidebarWorkspaceVisibleCount,
    {
      min: MIN_SIDEBAR_WORKSPACE_VISIBLE_COUNT,
      max: MAX_SIDEBAR_WORKSPACE_VISIBLE_COUNT,
    },
  );
  copyClampedNumericSetting(result, "sidebarProjectSpacing", stored.sidebarProjectSpacing, {
    min: MIN_SIDEBAR_PROJECT_SPACING,
    max: MAX_SIDEBAR_PROJECT_SPACING,
  });
  copyClampedNumericSetting(result, "sidebarSessionSpacing", stored.sidebarSessionSpacing, {
    min: MIN_SIDEBAR_SESSION_SPACING,
    max: MAX_SIDEBAR_SESSION_SPACING,
  });
  copyClampedNumericSetting(result, "sidebarRowVerticalPadding", stored.sidebarRowVerticalPadding, {
    min: MIN_SIDEBAR_ROW_VERTICAL_PADDING,
    max: MAX_SIDEBAR_ROW_VERTICAL_PADDING,
  });
  copyClampedNumericSetting(result, "sidebarHorizontalPadding", stored.sidebarHorizontalPadding, {
    min: MIN_SIDEBAR_HORIZONTAL_PADDING,
    max: MAX_SIDEBAR_HORIZONTAL_PADDING,
  });
  copyClampedNumericSetting(
    result,
    "conversationHistoryLoadCount",
    stored.conversationHistoryLoadCount,
    {
      min: MIN_CONVERSATION_HISTORY_LOAD_COUNT,
      max: MAX_CONVERSATION_HISTORY_LOAD_COUNT,
    },
  );
  copyClampedNumericSetting(
    result,
    "totalConversationHistoryLimit",
    stored.totalConversationHistoryLimit,
    {
      min: MIN_TOTAL_CONVERSATION_HISTORY_LIMIT,
      max: MAX_TOTAL_CONVERSATION_HISTORY_LIMIT,
    },
  );
  if (typeof stored.syntaxTheme === "string" && isSyntaxThemeId(stored.syntaxTheme)) {
    result.syntaxTheme = stored.syntaxTheme;
  }
  if (typeof stored.vimKeybindings === "boolean") {
    result.vimKeybindings = stored.vimKeybindings;
  }
  if (stored.workspaceTitleSource === "title" || stored.workspaceTitleSource === "branch") {
    result.workspaceTitleSource = stored.workspaceTitleSource;
  }
  if (typeof stored.autoExpandReasoning === "boolean") {
    result.autoExpandReasoning = stored.autoExpandReasoning;
  }
  const toolCallDetailLevel = parseToolCallDetailLevel(stored);
  if (toolCallDetailLevel !== null) {
    result.toolCallDetailLevel = toolCallDetailLevel;
  }
  return result;
}

function pickAppSettingsFromLegacy(
  legacy: z.infer<typeof LegacyRendererSettingsSchema>,
): Partial<AppSettings> {
  const result: Partial<AppSettings> = {};
  if (legacy.theme === "dark" || legacy.theme === "light" || legacy.theme === "auto") {
    result.theme = legacy.theme;
  }
  return result;
}

export function parseTerminalScrollbackLines(value: unknown): number | null {
  let numericValue = NaN;
  if (typeof value === "number") {
    numericValue = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    numericValue = Number(value);
  }
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return Math.min(
    MAX_TERMINAL_SCROLLBACK_LINES,
    Math.max(MIN_TERMINAL_SCROLLBACK_LINES, Math.floor(numericValue)),
  );
}

export function parseClampedFontSize(
  value: unknown,
  bounds: { min: number; max: number },
): number | null {
  return parseBoundedInteger(value, bounds);
}

export function parseBoundedInteger(
  value: unknown,
  bounds: { min: number; max: number },
): number | null {
  let numericValue = NaN;
  if (typeof value === "number") {
    numericValue = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    numericValue = Number(value);
  }
  if (!Number.isFinite(numericValue)) {
    return null;
  }
  return Math.min(bounds.max, Math.max(bounds.min, Math.floor(numericValue)));
}

export function sanitizeFontFamily(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return ""; // explicit empty = default
  }
  if (trimmed.length > MAX_FONT_FAMILY_LENGTH) {
    return null;
  }
  if (/[;{}<>]/.test(trimmed)) {
    return null; // would break the web CSS font-family declaration
  }
  if ([...trimmed].some((char) => char.charCodeAt(0) <= 0x1f)) {
    return null; // control chars would corrupt the font-family string
  }
  return trimmed; // quotes/commas are legit in stacks
}

async function loadLegacyDesktopSettingsFromStorage(storage: KeyValueStorage): Promise<{
  manageBuiltInDaemon?: boolean;
  releaseChannel?: ReleaseChannel;
} | null> {
  const stored = await loadRendererSettingsPayload(storage);
  if (!stored) {
    return null;
  }

  const result: {
    manageBuiltInDaemon?: boolean;
    releaseChannel?: ReleaseChannel;
  } = {};

  if (typeof stored.manageBuiltInDaemon === "boolean") {
    result.manageBuiltInDaemon = stored.manageBuiltInDaemon;
  }
  if (stored.releaseChannel === "stable" || stored.releaseChannel === "beta") {
    result.releaseChannel = stored.releaseChannel;
  }

  return Object.keys(result).length > 0 ? result : null;
}

async function loadRendererSettingsPayload(
  storage: KeyValueStorage,
): Promise<z.infer<typeof LegacyRendererSettingsSchema> | null> {
  const current = await readValidatedJson(storage, APP_SETTINGS_KEY, LegacyRendererSettingsSchema);
  if (current) {
    return current;
  }

  return readValidatedJson(storage, LEGACY_SETTINGS_KEY, LegacyRendererSettingsSchema);
}

async function writeAppSettings(
  storage: KeyValueStorage,
  stored: StoredAppSettings,
  settings: AppSettings,
): Promise<void> {
  const {
    compactToolCalls: _compactToolCalls,
    manageBuiltInDaemon: _manageBuiltInDaemon,
    releaseChannel: _releaseChannel,
    ...preserved
  } = stored;
  await storage.setItem(APP_SETTINGS_KEY, JSON.stringify({ ...preserved, ...settings }));
}
