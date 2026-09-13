import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Logger } from "pino";

import { CodexAppServerClient, CodexAppServerRpcError } from "./app-server-transport.js";
import {
  DesktopHelperTransportError,
  type DesktopHelper,
  type DesktopHelperRequestOptions,
} from "./desktop-tools-bridge.js";

interface HelperOptions {
  nodePath: string;
  modulePath: string;
  helperPath: string;
  codexHome: string;
  cliPath: string;
  logger: Logger;
}

export async function createCodexDesktopHelper(options: HelperOptions): Promise<DesktopHelper> {
  let hostUrl = new URL("./desktop-tools-host.js", import.meta.url);
  if (import.meta.url.endsWith(".ts"))
    hostUrl = new URL("./desktop-tools-host.ts", import.meta.url);
  const hostPath = fileURLToPath(hostUrl);
  // 官方 SDK 必须在其配套 Node 中加载，不能继承 Paseo 的 tsx/Electron 加载器。
  const child = spawn(options.nodePath, [hostPath, options.modulePath, options.helperPath], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_OPTIONS: undefined,
      NODE_PATH: undefined,
      ELECTRON_RUN_AS_NODE: undefined,
      CODEX_HOME: options.codexHome,
      CODEX_CLI_PATH: options.cliPath,
    },
  });
  const client = new CodexAppServerClient(child, options.logger);
  let createElicitation: DesktopHelperRequestOptions["createElicitation"] | null = null;
  let closing: Promise<void> | null = null;
  client.setRequestHandler("requestComputerUseApproval", (request) => {
    if (createElicitation === null) throw new Error("Desktop approval has no active request");
    return createElicitation(request);
  });
  try {
    await client.request("ping", {}, 10000);
  } catch (error) {
    await client.dispose();
    throw error;
  }
  options.logger.debug({ pid: child.pid }, "Codex desktop SDK host started");
  return {
    async request(method, params, requestOptions) {
      createElicitation = requestOptions.createElicitation;
      try {
        return await client.request(
          "request",
          {
            method,
            params,
            codexTurnMetadata: requestOptions.codexTurnMetadata,
          },
          6 * 60 * 1000,
        );
      } catch (error) {
        if (error instanceof CodexAppServerRpcError) throw error;
        throw new DesktopHelperTransportError(error);
      } finally {
        createElicitation = null;
      }
    },
    close() {
      closing ??= (async () => {
        try {
          if (child.exitCode === null && child.signalCode === null) {
            await client.request("close", {}, 15000);
          }
        } finally {
          await client.dispose();
        }
      })();
      return closing;
    },
  };
}
