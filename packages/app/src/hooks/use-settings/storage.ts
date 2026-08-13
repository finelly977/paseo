import { isSyntaxThemeId, type SyntaxThemeId } from "@getpaseo/highlight";
import type { QueryClient } from "@tanstack/react-query";
import type { DesktopSettings } from "@/desktop/settings/desktop-settings";
import { parseAppLanguage, type AppLanguage } from "@/i18n/locales";
import { THEME_TO_UNISTYLES, type ThemeName } from "@/styles/theme";
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

export const APP_SETTINGS_KEY = "@paseo:app-settings";
export const APP_SETTINGS_QUERY_KEY = ["app-settings"];
const LEGACY_SETTINGS_KEY = "@paseo:settings";

export type SendBehavior = "interrupt" | "queue";
export type ReleaseChannel = "stable" | "beta";
export type ServiceUrlBehavior = "ask" | "in-app" | "external";
export type WorkspaceTitleSource = "title" | "branch";
export type ToolCallDetailLevel = "overview" | "detailed";

const VALID_THEMES = new Set<string>([...Object.keys(THEME_TO_UNISTYLES), "auto"]);
const ThemePreferenceSchema = z.enum([
  "light",
  "dark",
  "zinc",
  "midnight",
  "claude",
  "ghostty",
  "auto",
]);
const VALID_SERVICE_URL_BEHAVIORS = new Set<ServiceUrlBehavior>(["ask", "in-app", "external"]);
const VALID_WORKSPACE_TITLE_SOURCES = new Set<WorkspaceTitleSource>(["title", "branch"]);
const VALID_TOOL_CALL_DETAIL_LEVELS = new Set<ToolCallDetailLevel>(["overview", "detailed"]);
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
  theme: ThemeName | "auto";
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

const StoredAppSettingsSchema = z.strictObject({
  theme: ThemePreferenceSchema.optional(),
  language: z
    .enum(["system", "ar", "en", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-CN"])
    .optional(),
  sendBehavior: z.enum(["interrupt", "queue"]).optional(),
  serviceUrlBehavior: z.enum(["ask", "in-app", "external"]).optional(),
  terminalScrollbackLines: z.union([z.number(), z.string()]).optional(),
  uiFontFamily: z.string().optional(),
  monoFontFamily: z.string().optional(),
  uiFontSize: z.union([z.number(), z.string()]).optional(),
  codeFontSize: z.union([z.number(), z.string()]).optional(),
  syntaxTheme: z.string().refine(isSyntaxThemeId).optional(),
  workspaceTitleSource: z.enum(["title", "branch"]).optional(),
  autoExpandReasoning: z.boolean().optional(),
  toolCallDetailLevel: z.enum(["overview", "detailed"]).optional(),
  compactToolCalls: z.boolean().optional(),
  vimKeybindings: z.boolean().optional(),
  messageParagraphSpacing: z.union([z.number(), z.string()]).optional(),
  conversationMessageSpacing: z.union([z.number(), z.string()]).optional(),
  conversationDividerSpacing: z.union([z.number(), z.string()]).optional(),
  conversationVerticalPadding: z.union([z.number(), z.string()]).optional(),
  conversationHorizontalPadding: z.union([z.number(), z.string()]).optional(),
  sidebarWorkspaceVisibleCount: z.union([z.number(), z.string()]).optional(),
  sidebarProjectSpacing: z.union([z.number(), z.string()]).optional(),
  sidebarSessionSpacing: z.union([z.number(), z.string()]).optional(),
  sidebarRowVerticalPadding: z.union([z.number(), z.string()]).optional(),
  sidebarHorizontalPadding: z.union([z.number(), z.string()]).optional(),
  conversationHistoryLoadCount: z.union([z.number(), z.string()]).optional(),
  totalConversationHistoryLimit: z.union([z.number(), z.string()]).optional(),
  // COMPAT(rendererDesktopSettings): these fields used to share this renderer-owned key.
  manageBuiltInDaemon: z.boolean().optional(),
  releaseChannel: z.enum(["stable", "beta"]).optional(),
});

const LegacyRendererSettingsSchema = StoredAppSettingsSchema;

type StoredAppSettings = z.infer<typeof StoredAppSettingsSchema>;

export const DEFAULT_CLIENT_SETTINGS: AppSettings = {
  theme: "auto",
  language: "system",
  sendBehavior: "interrupt",
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
  await input.deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
}

export async function loadAppSettingsFromStorage(deps: SettingsDeps): Promise<AppSettings> {
  try {
    const stored = await readValidatedJson(deps.storage, APP_SETTINGS_KEY, StoredAppSettingsSchema);
    if (stored) {
      return normalizeAppSettings(stored);
    }

    const legacyStored = await readValidatedJson(
      deps.storage,
      LEGACY_SETTINGS_KEY,
      LegacyRendererSettingsSchema,
    );
    if (legacyStored) {
      const next = {
        ...DEFAULT_CLIENT_SETTINGS,
        ...pickAppSettingsFromLegacy(legacyStored),
      } satisfies AppSettings;
      await deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
      return next;
    }

    await deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify(DEFAULT_CLIENT_SETTINGS));
    return DEFAULT_CLIENT_SETTINGS;
  } catch (error) {
    console.error("[AppSettings] Failed to load settings:", error);
    throw error;
  }
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
    if (
      typeof stored.toolCallDetailLevel === "string" &&
      VALID_TOOL_CALL_DETAIL_LEVELS.has(stored.toolCallDetailLevel)
    ) {
      return stored.toolCallDetailLevel;
    }
    // COMPAT(toolCallDetailLevelConcise): removed in v0.1.107; legacy "concise" values
    // deliberately follow the unknown-value fallback. Remove after 2027-01-14.
    return "overview";
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
  if (typeof stored.theme === "string" && VALID_THEMES.has(stored.theme)) {
    result.theme = stored.theme;
  }
  const language = parseAppLanguage(stored.language);
  if (language !== null) {
    result.language = language;
  }
  if (stored.sendBehavior === "interrupt" || stored.sendBehavior === "queue") {
    result.sendBehavior = stored.sendBehavior;
  }
  if (
    typeof stored.serviceUrlBehavior === "string" &&
    VALID_SERVICE_URL_BEHAVIORS.has(stored.serviceUrlBehavior)
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
  if (
    typeof stored.workspaceTitleSource === "string" &&
    VALID_WORKSPACE_TITLE_SOURCES.has(stored.workspaceTitleSource)
  ) {
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
