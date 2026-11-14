import { readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { execCommand } from "../../../utils/spawn.js";
import { createProviderEnvSpec } from "../provider-launch-config.js";

const GROK_DELETE_TIMEOUT_MS = 15_000;
const GROK_DELETE_MAX_BUFFER_BYTES = 1_048_576;

export interface GrokCommandOptions {
  envOverlay?: Record<string, string | undefined>;
  timeout?: number;
  maxBuffer?: number;
}

export type GrokCommandExecutor = (
  command: string,
  args: string[],
  options: GrokCommandOptions,
) => Promise<{ stdout: string; stderr: string }>;

interface DeleteGrokNativeSessionOptions {
  command: [string, ...string[]];
  env?: Record<string, string>;
  sessionId: string;
  execute?: GrokCommandExecutor;
}

export class GrokNativeSessionDeleteError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GrokNativeSessionDeleteError";
    this.sessionId = sessionId;
  }
}

export async function deleteGrokNativeSession(
  options: DeleteGrokNativeSessionOptions,
): Promise<void> {
  const invocation = buildGrokDeleteInvocation(options.command, options.sessionId);
  const envSpec = createProviderEnvSpec({ overlays: [options.env] });
  try {
    await (options.execute ?? execCommand)(invocation.command, invocation.args, {
      envOverlay: envSpec.envOverlay,
      timeout: GROK_DELETE_TIMEOUT_MS,
      maxBuffer: GROK_DELETE_MAX_BUFFER_BYTES,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GrokNativeSessionDeleteError(options.sessionId, `Grok 原生会话删除失败：${message}`, {
      cause: error,
    });
  }
}

function buildGrokDeleteInvocation(
  command: [string, ...string[]],
  sessionId: string,
): { command: string; args: string[] } {
  const agentCommandIndex = command.findIndex(
    (argument, index) => argument === "agent" && command[index + 1] === "stdio",
  );
  if (agentCommandIndex === -1) {
    throw new GrokNativeSessionDeleteError(
      sessionId,
      `无法从 Grok ACP 启动命令生成原生删除命令：${command.join(" ")}`,
    );
  }
  return {
    command: command[0],
    args: [...command.slice(1, agentCommandIndex), "sessions", "delete", sessionId],
  };
}

function resolveGrokSessionsDir(env?: Record<string, string>): string {
  const customHome = env?.GROK_HOME?.trim() || process.env.GROK_HOME?.trim();
  if (customHome) {
    return path.join(customHome, "sessions");
  }
  return path.join(homedir(), ".grok", "sessions");
}

function isSafeSessionDirName(sessionId: string): boolean {
  return (
    sessionId.length > 0 &&
    sessionId !== "." &&
    sessionId !== ".." &&
    !sessionId.includes("/") &&
    !sessionId.includes("\\")
  );
}

function isSystemReminderOnlyUserMessage(entry: Record<string, unknown>): boolean {
  if (entry.type !== "user" || !Array.isArray(entry.content)) {
    return false;
  }
  const texts = entry.content
    .map((part) =>
      typeof part === "object" &&
      part !== null &&
      typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text.trim()
        : "",
    )
    .filter((text) => text.length > 0);
  return texts.length > 0 && texts.every((text) => text.startsWith("<system-reminder>"));
}

async function isEmptyProbeSessionDirectory(sessionDir: string): Promise<boolean> {
  try {
    const summaryRaw = await readFile(path.join(sessionDir, "summary.json"), "utf8");
    const summary = JSON.parse(summaryRaw) as {
      session_summary?: unknown;
      num_chat_messages?: unknown;
    };
    if (typeof summary.session_summary === "string" && summary.session_summary.trim().length > 0) {
      return false;
    }
    if (typeof summary.num_chat_messages === "number" && summary.num_chat_messages > 2) {
      return false;
    }
    const historyRaw = await readFile(path.join(sessionDir, "chat_history.jsonl"), "utf8");
    const lines = historyRaw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (const line of lines) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (entry.type === "system") {
        continue;
      }
      if (isSystemReminderOnlyUserMessage(entry)) {
        continue;
      }
      return false;
    }
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function findLocalGrokSessionDirs(
  sessionId: string,
  env?: Record<string, string>,
): Promise<string[]> {
  if (!isSafeSessionDirName(sessionId)) {
    return [];
  }
  const sessionsRoot = resolveGrokSessionsDir(env);
  let workspaceDirs;
  try {
    workspaceDirs = await readdir(sessionsRoot, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const matches: string[] = [];
  for (const entry of workspaceDirs) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(sessionsRoot, entry.name, sessionId);
    if (await isEmptyProbeSessionDirectory(candidate)) {
      matches.push(candidate);
    }
  }
  return matches;
}

export async function isEmptyGrokProbeSession(options: {
  sessionId: string;
  env?: Record<string, string>;
}): Promise<boolean> {
  const dirs = await findLocalGrokSessionDirs(options.sessionId, options.env);
  return dirs.length > 0;
}

export async function removeLocalEmptyGrokProbeSession(options: {
  sessionId: string;
  env?: Record<string, string>;
}): Promise<boolean> {
  const dirs = await findLocalGrokSessionDirs(options.sessionId, options.env);
  if (dirs.length === 0) {
    return false;
  }
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  return true;
}
