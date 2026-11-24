import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PromptResponse, SessionConfigOption } from "@agentclientprotocol/sdk";
import type { Logger } from "pino";
import { AGY_MODES } from "@getpaseo/protocol/provider-manifest";

import {
  probeExecutable,
  findExecutable,
} from "../../../executable-resolution/executable-resolution.js";
import { createRealpathAwarePathMatcher } from "../../../utils/path.js";
import type {
  AgentCapabilityFlags,
  AgentPermissionResponse,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentRunOptions,
  AgentSessionConfig,
  AgentStreamEvent,
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
  contentBlockToText,
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
const AGY_RETRY_GRACE_TIMEOUT_MS = 15_000;
const AGY_CONTINUATION_IDLE_TIMEOUT_MS = 3_000;

export type AgyWarningKind = "retrying" | "terminal_error";

export interface AgyWarningClassification {
  kind: AgyWarningKind;
  message: string;
}

const AGY_RETRYING_WARNING_PATTERNS = [
  /^API error\s*\(attempt\s+\d+\)/i,
  /^The stream was interrupted\./i,
  /\bretrying\s+in\b/i,
];

const AGY_TERMINAL_WARNING_PATTERNS = [
  /^There was a network issue connecting to the server/i,
  /^Our servers are experiencing high traffic right now/i,
  /^Agent execution terminated due to error/i,
  /^Your AI credits balance is too low to continue/i,
  /^API error\b/i,
  /^Error\b/i,
];

/**
 * 识别 Antigravity CLI 通过 ACP `agent_message_chunk` 发出的网络波动重试或终止告警。
 * 仅当整段非空行均以 `⚠` 开头且命中已知 CLI 系统提示时才归类，不误判正常助手回复。
 */
export function classifyAgyWarningText(text: string): AgyWarningClassification | null {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0 || !lines.every((line) => line.startsWith("⚠"))) {
    return null;
  }

  let classification: AgyWarningClassification | null = null;
  for (const line of lines) {
    const body = line.replace(/^⚠\s*/u, "").trim();
    if (!body) {
      continue;
    }
    if (AGY_RETRYING_WARNING_PATTERNS.some((pattern) => pattern.test(body))) {
      classification = { kind: "retrying", message: body };
      continue;
    }
    if (AGY_TERMINAL_WARNING_PATTERNS.some((pattern) => pattern.test(body))) {
      classification = { kind: "terminal_error", message: body };
      continue;
    }
    return null;
  }
  return classification;
}

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
  retryGraceTimeoutMs?: number;
  continuationIdleTimeoutMs?: number;
}

export interface AgyACPAgentSessionOptions extends ACPAgentSessionOptions {
  retryGraceTimeoutMs?: number;
  continuationIdleTimeoutMs?: number;
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
  private readonly retryGraceTimeoutMs: number;
  private readonly continuationIdleTimeoutMs: number;
  private turnWarning: AgyWarningClassification | null = null;
  private deferredPromptTurn: {
    turnId: string;
    initialWarning: AgyWarningClassification | null;
    sawContinuation: boolean;
  } | null = null;
  private autonomousTurnId: string | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: AgentSessionConfig, options: AgyACPAgentSessionOptions) {
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
    this.retryGraceTimeoutMs = options.retryGraceTimeoutMs ?? AGY_RETRY_GRACE_TIMEOUT_MS;
    this.continuationIdleTimeoutMs =
      options.continuationIdleTimeoutMs ?? AGY_CONTINUATION_IDLE_TIMEOUT_MS;
  }

  override async startTurn(
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    if (this.deferredPromptTurn) {
      this.settleDeferredPromptTurn();
    }
    this.settleAutonomousTurnBeforeNewPrompt();
    this.clearTurnTracking();
    return super.startTurn(prompt, options);
  }

  override async sessionUpdate(
    params: Parameters<ACPAgentSession["sessionUpdate"]>[0],
  ): Promise<void> {
    if (this.isHistoryReplaying || params.sessionId !== this.id) {
      await super.sessionUpdate(params);
      return;
    }

    const update = params.update;
    let warning: AgyWarningClassification | null = null;
    let isSubstantiveActivity = false;

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const text = contentBlockToText(update.content);
        if (text.trim().length > 0) {
          warning = classifyAgyWarningText(text);
          isSubstantiveActivity = warning === null;
        }
        break;
      }
      case "agent_thought_chunk":
      case "tool_call":
      case "tool_call_update":
      case "plan":
        isSubstantiveActivity = true;
        break;
      default:
        break;
    }

    // 若 agy acp 之前因网络波动静默重试提前结束了 session/prompt，收到后台续流活动时先拉起自治回合，
    // 让 AgentManager 立刻恢复 running，避免界面停留在“已完成”的同时继续吐内容。
    if (!this.activeTurnId && !this.autonomousTurnId && isSubstantiveActivity) {
      const turnId = randomUUID();
      this.autonomousTurnId = turnId;
      this.turnWarning = null;
      this.pushEvent({ type: "turn_started", provider: this.provider, turnId });
    }

    await super.sessionUpdate(params);

    if (warning) {
      this.turnWarning = warning;
      if (this.deferredPromptTurn) {
        if (warning.kind === "terminal_error") {
          this.settleDeferredPromptTurn({
            forceFailure: warning.message,
            code: "AGY_NETWORK_ERROR",
          });
        } else {
          this.scheduleSettleTimer(this.retryGraceTimeoutMs);
        }
        return;
      }
      if (this.autonomousTurnId) {
        if (warning.kind === "terminal_error") {
          this.settleAutonomousTurn({ forceFailure: warning.message, code: "AGY_NETWORK_ERROR" });
        } else {
          this.scheduleSettleTimer(this.retryGraceTimeoutMs);
        }
      }
      return;
    }

    if (isSubstantiveActivity) {
      this.turnWarning = null;
      if (this.deferredPromptTurn) {
        this.deferredPromptTurn.sawContinuation = true;
        this.scheduleDeferredOrAutonomousIdleSettle();
      } else if (this.autonomousTurnId) {
        this.scheduleDeferredOrAutonomousIdleSettle();
      }
    }
  }

  protected override handlePromptResponse(response: PromptResponse, turnId: string): void {
    if (response.stopReason === "cancelled") {
      this.clearTurnTracking();
      super.handlePromptResponse(response, turnId);
      return;
    }

    this.mergePromptResponseUsage(response.usage);

    // Antigravity 在网络波动重试耗尽后仍以 stopReason="end_turn" 结束 session/prompt，
    // 仅发过 ⚠ 网络/执行失败提示且无后续正常内容时，不能当作任务成功完成。
    if (this.turnWarning?.kind === "terminal_error") {
      const error = this.turnWarning.message;
      this.clearTurnTracking();
      this.finishTurn({
        type: "turn_failed",
        provider: this.provider,
        error,
        code: "AGY_NETWORK_ERROR",
        turnId,
      });
      return;
    }

    // 若刚收到重试/流中断告警，或仍有运行中的工具/待审批权限就提前收到 end_turn，
    // 暂缓结束当前回合以等待 CLI 重试续流，避免重试期间误报完成。
    if (
      this.turnWarning?.kind === "retrying" ||
      this.hasRunningToolCalls() ||
      this.hasPendingPermissions()
    ) {
      this.deferredPromptTurn = {
        turnId,
        initialWarning: this.turnWarning,
        sawContinuation: false,
      };
      this.scheduleDeferredOrAutonomousIdleSettle(this.retryGraceTimeoutMs);
      return;
    }

    this.clearTurnTracking();
    super.handlePromptResponse(response, turnId);
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
    // 存在待审批权限时暂停暂缓/续跑超时，避免审批期间误结算。
    this.clearSettleTimer();
    return super.requestPermission(params);
  }

  override async respondToPermission(
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<void> {
    await super.respondToPermission(requestId, response);
    if (this.deferredPromptTurn || this.autonomousTurnId) {
      this.scheduleDeferredOrAutonomousIdleSettle();
    }
  }

  override async interrupt(): Promise<void> {
    const deferred = this.deferredPromptTurn;
    const autonomousId = this.autonomousTurnId;
    await super.interrupt();
    if (deferred) {
      this.clearTurnTracking();
      this.synthesizeCanceledToolCalls();
      this.finishTurn({
        type: "turn_canceled",
        provider: this.provider,
        reason: "Interrupted",
        turnId: deferred.turnId,
      });
      return;
    }
    if (autonomousId) {
      this.clearTurnTracking();
      this.synthesizeCanceledToolCalls();
      this.pushEvent({
        type: "turn_canceled",
        provider: this.provider,
        reason: "Interrupted",
        turnId: autonomousId,
      });
    }
  }

  override async close(): Promise<void> {
    this.clearTurnTracking();
    await super.close();
  }

  protected override finishTurn(
    event: Extract<AgentStreamEvent, { type: "turn_completed" | "turn_failed" | "turn_canceled" }>,
  ): void {
    this.clearTurnTracking();
    super.finishTurn(event);
  }

  private clearSettleTimer(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
  }

  private clearTurnTracking(): void {
    this.clearSettleTimer();
    this.turnWarning = null;
    this.deferredPromptTurn = null;
    this.autonomousTurnId = null;
  }

  private scheduleSettleTimer(delayMs: number): void {
    this.clearSettleTimer();
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (this.deferredPromptTurn) {
        this.settleDeferredPromptTurn();
      } else if (this.autonomousTurnId) {
        this.settleAutonomousTurn();
      }
    }, delayMs);
  }

  private scheduleDeferredOrAutonomousIdleSettle(overrideDelayMs?: number): void {
    if (this.hasRunningToolCalls() || this.hasPendingPermissions()) {
      this.clearSettleTimer();
      return;
    }
    const delayMs =
      overrideDelayMs ??
      (this.deferredPromptTurn && !this.deferredPromptTurn.sawContinuation
        ? this.retryGraceTimeoutMs
        : this.continuationIdleTimeoutMs);
    this.scheduleSettleTimer(delayMs);
  }

  private settleDeferredPromptTurn(options?: { forceFailure?: string; code?: string }): void {
    const deferred = this.deferredPromptTurn;
    if (!deferred) {
      return;
    }
    const warning = this.turnWarning ?? (deferred.sawContinuation ? null : deferred.initialWarning);
    const failureMessage = options?.forceFailure ?? warning?.message ?? null;
    const failureCode =
      options?.code ??
      (warning?.kind === "terminal_error" ? "AGY_NETWORK_ERROR" : "AGY_STREAM_INTERRUPTED");
    const usage = this.currentTurnUsageSnapshot;
    this.clearTurnTracking();

    if (failureMessage) {
      this.synthesizeCanceledToolCalls();
      this.finishTurn({
        type: "turn_failed",
        provider: this.provider,
        error: failureMessage,
        code: failureCode,
        turnId: deferred.turnId,
      });
      return;
    }

    this.finishTurn({
      type: "turn_completed",
      provider: this.provider,
      usage,
      turnId: deferred.turnId,
    });
  }

  private settleAutonomousTurn(options?: { forceFailure?: string; code?: string }): void {
    const turnId = this.autonomousTurnId;
    if (!turnId) {
      return;
    }
    const failureMessage = options?.forceFailure ?? this.turnWarning?.message ?? null;
    const failureCode =
      options?.code ??
      (this.turnWarning?.kind === "terminal_error"
        ? "AGY_NETWORK_ERROR"
        : "AGY_STREAM_INTERRUPTED");
    const usage = this.currentTurnUsageSnapshot;
    this.clearTurnTracking();

    if (failureMessage) {
      this.synthesizeCanceledToolCalls();
      this.pushEvent({
        type: "turn_failed",
        provider: this.provider,
        error: failureMessage,
        code: failureCode,
        turnId,
      });
      return;
    }

    this.pushEvent({
      type: "turn_completed",
      provider: this.provider,
      usage,
      turnId,
    });
  }

  private settleAutonomousTurnBeforeNewPrompt(): void {
    if (!this.autonomousTurnId) {
      return;
    }
    this.settleAutonomousTurn();
  }
}

export class AgyACPAgentClient extends ACPAgentClient {
  private readonly retryGraceTimeoutMs?: number;
  private readonly continuationIdleTimeoutMs?: number;

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
    this.retryGraceTimeoutMs = options.retryGraceTimeoutMs;
    this.continuationIdleTimeoutMs = options.continuationIdleTimeoutMs;
  }

  protected override createSessionInstance(
    config: AgentSessionConfig,
    options: ACPAgentSessionOptions,
  ): ACPAgentSession {
    return new AgyACPAgentSession(config, {
      ...options,
      retryGraceTimeoutMs: this.retryGraceTimeoutMs,
      continuationIdleTimeoutMs: this.continuationIdleTimeoutMs,
    });
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
