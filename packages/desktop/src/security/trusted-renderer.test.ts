import { describe, expect, it } from "vitest";

import {
  assertTrustedIpcSender,
  classifyMainWindowNavigation,
  isTrustedRendererUrl,
  type TrustedRendererPolicy,
} from "./trusted-renderer";

const PACKAGED_POLICY: TrustedRendererPolicy = {
  kind: "packaged",
  appProtocol: "paseo:",
  appHost: "app",
  appOrigin: "paseo://app",
};

const DEVELOPMENT_POLICY: TrustedRendererPolicy = {
  kind: "development",
  origin: "http://localhost:8082",
};

function eventFor(input: { url: string; origin: string; mainFrame?: boolean }) {
  const mainFrame = {};
  const senderFrame = input.mainFrame === false ? {} : mainFrame;
  return {
    sender: { mainFrame },
    senderFrame: Object.assign(senderFrame, { url: input.url, origin: input.origin }),
  };
}

describe("桌面受信任渲染器边界", () => {
  it("生产环境只允许 paseo://app 主机", () => {
    expect(isTrustedRendererUrl("paseo://app/settings", PACKAGED_POLICY)).toBe(true);
    expect(isTrustedRendererUrl("paseo://evil/settings", PACKAGED_POLICY)).toBe(false);
    expect(isTrustedRendererUrl("paseo://app.evil/settings", PACKAGED_POLICY)).toBe(false);
    expect(isTrustedRendererUrl("paseo://user@app/settings", PACKAGED_POLICY)).toBe(false);
    expect(isTrustedRendererUrl("paseo://app:443/settings", PACKAGED_POLICY)).toBe(false);
    expect(isTrustedRendererUrl("https://example.com", PACKAGED_POLICY)).toBe(false);
    expect(isTrustedRendererUrl("file:///tmp/app.html", PACKAGED_POLICY)).toBe(false);
  });

  it("开发环境只允许配置的精确来源", () => {
    expect(isTrustedRendererUrl("http://localhost:8082/settings", DEVELOPMENT_POLICY)).toBe(true);
    expect(isTrustedRendererUrl("http://user@localhost:8082/settings", DEVELOPMENT_POLICY)).toBe(
      false,
    );
    expect(isTrustedRendererUrl("http://localhost:8081/settings", DEVELOPMENT_POLICY)).toBe(false);
    expect(isTrustedRendererUrl("http://127.0.0.1:8082/settings", DEVELOPMENT_POLICY)).toBe(false);
    expect(isTrustedRendererUrl("https://example.com", DEVELOPMENT_POLICY)).toBe(false);
  });

  it("只接受受信任页面的主框架 IPC", () => {
    expect(() =>
      assertTrustedIpcSender(
        eventFor({ url: "paseo://app/settings", origin: "paseo://app" }),
        PACKAGED_POLICY,
      ),
    ).not.toThrow();

    expect(() =>
      assertTrustedIpcSender(
        eventFor({ url: "https://example.com", origin: "https://example.com" }),
        PACKAGED_POLICY,
      ),
    ).toThrow("拒绝来自非受信任页面的桌面 IPC");

    expect(() =>
      assertTrustedIpcSender(
        eventFor({ url: "paseo://app/settings", origin: "https://example.com" }),
        PACKAGED_POLICY,
      ),
    ).toThrow("拒绝来自非受信任页面的桌面 IPC");

    expect(() =>
      assertTrustedIpcSender(
        eventFor({
          url: "paseo://app/embedded",
          origin: "paseo://app",
          mainFrame: false,
        }),
        PACKAGED_POLICY,
      ),
    ).toThrow("拒绝来自非主框架的桌面 IPC");
  });

  it("主窗口把 HTTP(S) 导航交给系统浏览器并拒绝其他协议", () => {
    expect(classifyMainWindowNavigation("paseo://app/workspace", PACKAGED_POLICY)).toBe("allow");
    expect(classifyMainWindowNavigation("https://example.com", PACKAGED_POLICY)).toBe(
      "open-external",
    );
    expect(classifyMainWindowNavigation("javascript:alert(1)", PACKAGED_POLICY)).toBe("deny");
    expect(classifyMainWindowNavigation("file:///tmp/secret", PACKAGED_POLICY)).toBe("deny");
  });
});
