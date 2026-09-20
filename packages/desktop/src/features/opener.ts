import { shell, ipcMain } from "electron";
import { assertTrustedIpcSender } from "../security/trusted-renderer.js";

const ALLOWED_EXTERNAL_URL_PROTOCOLS = new Set(["http:", "https:"]);

export function isAllowedExternalUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    return ALLOWED_EXTERNAL_URL_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

export function registerOpenerHandlers(): void {
  ipcMain.handle("paseo:opener:openUrl", async (event, url: unknown) => {
    assertTrustedIpcSender(event);
    if (!isAllowedExternalUrl(url)) {
      throw new Error("Unsupported external URL");
    }
    await shell.openExternal(url);
  });
}
