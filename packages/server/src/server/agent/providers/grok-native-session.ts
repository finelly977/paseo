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
