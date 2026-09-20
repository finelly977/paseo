import { ipcMain, shell } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isAllowedExternalUrl, registerOpenerHandlers } from "./opener";

vi.mock("electron", () => ({
  app: { isPackaged: true },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

function trustedRendererEvent() {
  const mainFrame = { url: "paseo://app/", origin: "paseo://app" };
  return { sender: { mainFrame }, senderFrame: mainFrame };
}

function getRegisteredOpenUrlHandler(): (_event: unknown, url: unknown) => Promise<void> {
  registerOpenerHandlers();
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => {
    return channel === "paseo:opener:openUrl";
  })?.[1];
  if (typeof handler !== "function") {
    throw new Error("open URL handler was not registered");
  }
  return handler as (_event: unknown, url: unknown) => Promise<void>;
}

describe("desktop opener", () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockReset();
    vi.mocked(shell.openExternal).mockReset();
  });

  it("allows only http and https external URLs", () => {
    expect(isAllowedExternalUrl("https://example.com/path")).toBe(true);
    expect(isAllowedExternalUrl("http://localhost:8081")).toBe(true);
    expect(isAllowedExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("paseo://settings")).toBe(false);
    expect(isAllowedExternalUrl("/relative/path")).toBe(false);
    expect(isAllowedExternalUrl(null)).toBe(false);
  });

  it("opens allowed URLs through Electron shell", async () => {
    const handler = getRegisteredOpenUrlHandler();

    await handler(trustedRendererEvent(), "https://example.com");

    expect(shell.openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("rejects blocked URLs before invoking Electron shell", async () => {
    const handler = getRegisteredOpenUrlHandler();

    await expect(handler(trustedRendererEvent(), "file:///etc/passwd")).rejects.toThrow(
      "Unsupported external URL",
    );

    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("拒绝远程页面调用系统浏览器", async () => {
    const handler = getRegisteredOpenUrlHandler();
    const mainFrame = { url: "https://evil.example", origin: "https://evil.example" };

    await expect(
      handler({ sender: { mainFrame }, senderFrame: mainFrame }, "https://example.com"),
    ).rejects.toThrow("拒绝来自非受信任页面的桌面 IPC");

    expect(shell.openExternal).not.toHaveBeenCalled();
  });
});
