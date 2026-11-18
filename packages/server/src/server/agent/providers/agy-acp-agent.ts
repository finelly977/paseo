import fs from "node:fs/promises";
import path from "node:path";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { Logger } from "pino";
import { AGY_MODES } from "@getpaseo/protocol/provider-manifest";

import {
  probeExecutable,
  findExecutable,
} from "../../../executable-resolution/executable-resolution.js";
import { createRealpathAwarePathMatcher } from "../../../utils/path.js";
import type {
  AgentCapabilityFlags,
  AgentPersistenceHandle,
  AgentSessionConfig,
  ImportableProviderSession,
  ListImportableSessionsOptions,
} from "../agent-sdk-types.js";
import {
  checkProviderLaunchAvailable,
  resolveProviderLaunch,
  type ProviderRuntimeSettings,
} from "../provider-launch-config.js";
import { composeSystemPromptParts } from "../system-prompt.js";
import {
  ACPAgentClient,
  ACPAgentSession,
  type ACPAgentSessionOptions,
  type ACPProviderModeWriterContext,
  type ACPProviderModeWriteResult,
  type ACPToolSnapshot,
  type SessionStateResponse,
  findSelectConfigOption,
  resolvePerModelThinkingCatalog,
  selectPermissionOption,
} from "./acp-agent.js";
import {
  buildBinaryDiagnosticRows,
  buildCommandResolutionDiagnosticRows,
  formatProviderDiagnostic,
  formatProviderDiagnosticError,
  toDiagnosticErrorMessage,
} from "./diagnostic-utils.js";

const AGY_COMMAND: [string, ...string[]] = ["agy", "acp"];
const AGY_INITIAL_COMMANDS_WAIT_TIMEOUT_MS = 10_000;
const AGY_DEFAULT_MODE_ID = "default";
export const AGY_ALLOW_ALL_MODE_ID = "allow-all";

const AGY_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsSessionListing: true,
  supportsDynamicModes: true,
  supportsMcpServers: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
  supportsRewindConversation: false,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
};

const ALLOW_ALL_MODE_ENTRY = {
  id: AGY_ALLOW_ALL_MODE_ID,
  name: "Allow All",
  description: "Automatically approves all Antigravity tool and command permission requests.",
} as const;

type SelectConfigOption = Extract<SessionConfigOption, { type: "select" }>;

interface AgyModeState {
  allowAllActive: boolean;
}

type AgyModeWriteContext = Omit<ACPProviderModeWriterContext, "connection" | "logger"> & {
  connection: Pick<
    ACPProviderModeWriterContext["connection"],
    "setSessionMode" | "setSessionConfigOption"
  >;
};

interface AgyACPAgentClientOptions {
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readNonEmptyString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function flattenSelectChoices(
  options: SelectConfigOption["options"],
): Array<{ value: string; name: string; description?: string | null }> {
  const choices: Array<{ value: string; name: string; description?: string | null }> = [];
  for (const option of options) {
    if ("value" in option) {
      choices.push(option);
      continue;
    }
    choices.push(...option.options);
  }
  return choices;
}

/**
 * Normalizes Windows drive-letter URI paths produced by Antigravity CLI/IDE
 * (such as `/C:/repo` or `/e%3A/repo`) back into canonical Windows paths while
 * leaving POSIX paths (such as `/Users/alice/repo`) untouched.
 */
export function normalizeAgyPath(rawPath: string): string {
  const strippedFileScheme = rawPath.startsWith("file:///")
    ? rawPath.slice("file://".length)
    : rawPath;
  const match = /^\/([A-Za-z])(?::|%3[Aa])(\/.*)?$/u.exec(strippedFileScheme);
  if (!match) {
    return rawPath;
  }

  const driveLetter = match[1];
  let rest = match[2] ?? "/";
  try {
    rest = decodeURIComponent(rest);
  } catch {
    // Keep original percent sequence when a path literally contains malformed `%` characters.
  }
  return path.win32.normalize(`${driveLetter}:${rest}`);
}

export function transformAgySessionResponse(
  response: SessionStateResponse,
  modeState?: AgyModeState,
): SessionStateResponse {
  const hasModelConfigOption = Boolean(
    findSelectConfigOption({ configOptions: response.configOptions, category: "model" }),
  );
  const transformedModes = response.modes
    ? {
        ...response.modes,
        availableModes: response.modes.availableModes
          ?.filter((mode) => mode.id !== AGY_ALLOW_ALL_MODE_ID)
          .concat({
            id: ALLOW_ALL_MODE_ENTRY.id,
            name: ALLOW_ALL_MODE_ENTRY.name,
            description: ALLOW_ALL_MODE_ENTRY.description,
          }),
        currentModeId: transformAgyModeId(response.modes.currentModeId, modeState),
      }
    : response.modes;

  return {
    ...response,
    // Prefer modern `configOptions` (base model + per-model `thought_level`) over legacy
    // flattened `<model>-<effort>` entries in `models.availableModels`.
    ...(hasModelConfigOption ? { models: undefined } : {}),
    modes: transformedModes,
  };
}

function transformAgyModeId(modeId: string, modeState?: AgyModeState): string {
  if (!modeState) {
    return modeId;
  }
  if (modeId !== AGY_DEFAULT_MODE_ID && modeId !== AGY_ALLOW_ALL_MODE_ID) {
    modeState.allowAllActive = false;
  }
  return modeState.allowAllActive && modeId === AGY_DEFAULT_MODE_ID
    ? AGY_ALLOW_ALL_MODE_ID
    : modeId;
}

export function transformAgyConfigOptions(
  configOptions: SessionConfigOption[],
  modeState?: AgyModeState,
): SessionConfigOption[] {
  return configOptions.map((option) => {
    if (option.type !== "select" || option.category !== "mode") {
      return option;
    }

    const choices = flattenSelectChoices(option.options)
      .filter((choice) => choice.value !== AGY_ALLOW_ALL_MODE_ID)
      .concat({
        value: ALLOW_ALL_MODE_ENTRY.id,
        name: ALLOW_ALL_MODE_ENTRY.name,
        description: ALLOW_ALL_MODE_ENTRY.description,
      });

    return {
      ...option,
      currentValue: transformAgyModeId(option.currentValue, modeState),
      options: choices,
    };
  });
}

export async function writeAgyMode(
  context: AgyModeWriteContext,
  modeState: AgyModeState,
): Promise<ACPProviderModeWriteResult> {
  const allowAll = context.requestedModeId === AGY_ALLOW_ALL_MODE_ID;
  if (!allowAll && !modeState.allowAllActive) {
    return { handled: false };
  }

  // Allow All 由当前会话批准 ACP 权限请求；原生 Auto 依赖沙箱，不用于此模式。
  const nativeModeId = allowAll ? AGY_DEFAULT_MODE_ID : context.requestedModeId;
  let configOptions: SessionConfigOption[];
  if (context.selection.hasAvailableModes) {
    if (!allowAll && !context.selection.availableMode) {
      throw new Error(`Antigravity does not expose mode: ${nativeModeId}`);
    }
    await context.connection.setSessionMode({
      sessionId: context.sessionId,
      modeId: nativeModeId,
    });
    configOptions = context.configOptions.map((option) =>
      option.type === "select" && option.category === "mode"
        ? { ...option, currentValue: nativeModeId }
        : option,
    );
  } else {
    const modeOption = context.selection.configOption;
    if (!modeOption) {
      throw new Error("Antigravity does not expose ACP mode switching");
    }
    const response = await context.connection.setSessionConfigOption({
      sessionId: context.sessionId,
      configId: modeOption.id,
      value: nativeModeId,
    });
    const selected = findSelectConfigOption({
      configOptions: response.configOptions,
      id: modeOption.id,
      category: "mode",
    });
    if (!selected || selected.currentValue !== nativeModeId) {
      throw new Error(`Antigravity did not apply mode: ${nativeModeId}`);
    }
    configOptions = response.configOptions;
  }

  // 仅在原生切换成功后提交审批策略；失败时保留原模式，异常交给调用者展示。
  modeState.allowAllActive = allowAll;
  return {
    handled: true,
    currentModeId: context.requestedModeId,
    configOptions: transformAgyConfigOptions(configOptions, modeState),
  };
}

export function transformAgyToolSnapshot(snapshot: ACPToolSnapshot): ACPToolSnapshot {
  const locations = snapshot.locations?.map((location) => ({
    ...location,
    path: normalizeAgyPath(location.path),
  }));
  const title = snapshot.title.startsWith("File ")
    ? `File ${normalizeAgyPath(snapshot.title.slice("File ".length))}`
    : snapshot.title;

  let rawInput = snapshot.rawInput;
  if (isRecord(rawInput)) {
    const nextRawInput: Record<string, unknown> = { ...rawInput };
    if (typeof nextRawInput.path !== "string") {
      const pascalPath = readNonEmptyString(rawInput, [
        "Path",
        "TargetFile",
        "FilePath",
        "DirectoryPath",
        "SearchPath",
      ]);
      if (pascalPath) {
        nextRawInput.path = normalizeAgyPath(pascalPath);
      }
    }
    if (typeof nextRawInput.command !== "string") {
      const commandLine = readNonEmptyString(rawInput, ["CommandLine"]);
      if (commandLine) {
        nextRawInput.command = commandLine;
      }
    }
    if (typeof nextRawInput.cwd !== "string") {
      const cwd = readNonEmptyString(rawInput, ["Cwd"]);
      if (cwd) {
        nextRawInput.cwd = normalizeAgyPath(cwd);
      }
    }
    if (typeof nextRawInput.query !== "string") {
      const query = readNonEmptyString(rawInput, ["Query"]);
      if (query) {
        nextRawInput.query = query;
      }
    }
    if (typeof nextRawInput.url !== "string") {
      const url = readNonEmptyString(rawInput, ["Url"]);
      if (url) {
        nextRawInput.url = url;
      }
    }
    rawInput = nextRawInput;
  }

  let rawOutput = snapshot.rawOutput;
  if (
    isRecord(rawOutput) &&
    typeof rawOutput.exitCode !== "number" &&
    typeof rawOutput.exit_code === "number"
  ) {
    rawOutput = {
      ...rawOutput,
      exitCode: rawOutput.exit_code,
    };
  }

  return {
    ...snapshot,
    title,
    locations,
    rawInput,
    rawOutput,
  };
}

export function buildAgyNewSessionMeta(
  config: AgentSessionConfig,
): Record<string, unknown> | undefined {
  const systemPrompt = composeSystemPromptParts(
    config.systemPrompt,
    config.daemonAppendSystemPrompt,
  );
  if (!systemPrompt) {
    return undefined;
  }
  return {
    antigravity: {
      systemPrompt: {
        append: systemPrompt,
      },
    },
  };
}

async function findAgyLocalAppDataBinary(): Promise<string | null> {
  if (process.platform !== "win32") {
    return null;
  }
  const localAppData = process.env["LOCALAPPDATA"];
  if (!localAppData) {
    return null;
  }
  const candidate = path.win32.join(localAppData, "agy", "bin", "agy.exe");
  try {
    await fs.access(candidate);
  } catch {
    return null;
  }
  return (await probeExecutable(candidate)) ? candidate : null;
}

export async function findDefaultAgyBinary(): Promise<string | null> {
  return (await findExecutable("agy")) ?? (await findAgyLocalAppDataBinary());
}

export class AgyACPAgentSession extends ACPAgentSession {
  private readonly modeState: AgyModeState;

  constructor(config: AgentSessionConfig, options: ACPAgentSessionOptions) {
    const modeState: AgyModeState = { allowAllActive: false };
    super(config, {
      ...options,
      sessionResponseTransformer: (response) => transformAgySessionResponse(response, modeState),
      configOptionsTransformer: (configOptions) =>
        transformAgyConfigOptions(configOptions, modeState),
      modeIdTransformer: (modeId) => transformAgyModeId(modeId, modeState),
      providerModeWriter: (context) => writeAgyMode(context, modeState),
    });
    this.modeState = modeState;
  }

  override async requestPermission(
    params: Parameters<ACPAgentSession["requestPermission"]>[0],
  ): Promise<Awaited<ReturnType<ACPAgentSession["requestPermission"]>>> {
    if (this.modeState.allowAllActive) {
      const selected = selectPermissionOption(params.options, { behavior: "allow" });
      if (selected) {
        return {
          outcome: {
            outcome: "selected",
            optionId: selected.optionId,
          },
        };
      }
    }
    return super.requestPermission(params);
  }
}

export class AgyACPAgentClient extends ACPAgentClient {
  constructor(options: AgyACPAgentClientOptions) {
    super({
      provider: "agy",
      logger: options.logger,
      runtimeSettings: options.runtimeSettings,
      defaultCommand: AGY_COMMAND,
      defaultBinary: {
        command: "agy",
        resolvePath: findDefaultAgyBinary,
      },
      defaultModes: AGY_MODES.map(({ id, label, description, icon, colorTier, isUnattended }) => ({
        id,
        label,
        description,
        icon,
        colorTier,
        isUnattended,
      })),
      sessionResponseTransformer: (response) => transformAgySessionResponse(response),
      configOptionsTransformer: (configOptions) => transformAgyConfigOptions(configOptions),
      catalogModelResolver: (context) =>
        resolvePerModelThinkingCatalog(context, {
          probeWhenInitialThoughtLevelMissing: true,
        }),
      toolSnapshotTransformer: transformAgyToolSnapshot,
      buildNewSessionMeta: buildAgyNewSessionMeta,
      waitForInitialCommands: true,
      initialCommandsWaitTimeoutMs: AGY_INITIAL_COMMANDS_WAIT_TIMEOUT_MS,
      capabilities: AGY_CAPABILITIES,
    });
  }

  protected override createSessionInstance(
    config: AgentSessionConfig,
    options: ACPAgentSessionOptions,
  ): ACPAgentSession {
    return new AgyACPAgentSession(config, options);
  }

  override async listImportableSessions(
    options?: ListImportableSessionsOptions,
  ): Promise<ImportableProviderSession[]> {
    // Antigravity's `session/list` returns sessions across all workspaces and may emit
    // URI-style Windows paths (`/C:/...` or `/e%3A/...`). Fetch without early limit
    // truncation when filtering by `cwd`, normalize every path, then apply `cwd` + `limit`.
    const sessions = await super.listImportableSessions(
      options?.cwd ? { cwd: options.cwd } : options,
    );
    const normalized = sessions.map((session) =>
      Object.assign({}, session, { cwd: normalizeAgyPath(session.cwd) }),
    );
    const matchesCwd = options?.cwd ? createRealpathAwarePathMatcher(options.cwd) : null;
    const filtered = matchesCwd
      ? normalized.filter((session) => matchesCwd(session.cwd))
      : normalized;
    return typeof options?.limit === "number" ? filtered.slice(0, options.limit) : filtered;
  }

  override async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: Parameters<ACPAgentClient["resumeSession"]>[2],
  ) {
    const normalizedHandleMetadata =
      handle.metadata && typeof handle.metadata.cwd === "string"
        ? {
            ...handle.metadata,
            cwd: normalizeAgyPath(handle.metadata.cwd),
          }
        : handle.metadata;
    const normalizedOverrides = overrides?.cwd
      ? { ...overrides, cwd: normalizeAgyPath(overrides.cwd) }
      : overrides;
    return super.resumeSession(
      { ...handle, metadata: normalizedHandleMetadata },
      normalizedOverrides,
      launchContext,
    );
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    try {
      const defaultBinary = {
        command: "agy",
        resolvePath: findDefaultAgyBinary,
      };
      const launch = await resolveProviderLaunch({
        commandConfig: this.runtimeSettings?.command,
        defaultBinary,
      });
      const availability = await checkProviderLaunchAvailable(launch, defaultBinary);
      const rows = [
        ...(await buildCommandResolutionDiagnosticRows(launch, {
          knownBinaryNames: ["agy"],
        })),
        ...(await buildBinaryDiagnosticRows(launch, availability)),
      ];
      if (availability.available) {
        try {
          rows.push(...(await this.buildACPProbeDiagnosticRows()));
        } catch (error) {
          rows.push({
            label: "ACP probe",
            value: `error: ${toDiagnosticErrorMessage(error)}`,
          });
        }
      }

      return {
        diagnostic: formatProviderDiagnostic("Antigravity (ACP)", rows),
      };
    } catch (error) {
      return {
        diagnostic: formatProviderDiagnosticError("Antigravity (ACP)", error),
      };
    }
  }
}
