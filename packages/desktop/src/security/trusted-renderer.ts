import { app } from "electron";

export const TRUSTED_APP_SCHEME = "paseo";
export const TRUSTED_APP_BASE_URL = `${TRUSTED_APP_SCHEME}://app`;

export type TrustedRendererPolicy =
  | {
      kind: "packaged";
      appProtocol: string;
      appHost: string;
      appOrigin: string;
    }
  | {
      kind: "development";
      origin: string;
    };

interface RendererFrameIdentity {
  readonly url: string;
  readonly origin: string;
}

export interface TrustedIpcEvent {
  readonly sender: {
    readonly mainFrame: unknown;
  };
  readonly senderFrame: (RendererFrameIdentity & object) | null;
}

const PACKAGED_POLICY: TrustedRendererPolicy = {
  kind: "packaged",
  appProtocol: `${TRUSTED_APP_SCHEME}:`,
  appHost: "app",
  appOrigin: TRUSTED_APP_BASE_URL,
};

export function getTrustedRendererPolicy(): TrustedRendererPolicy {
  if (app.isPackaged) {
    return PACKAGED_POLICY;
  }
  const developmentUrl = new URL(process.env.EXPO_DEV_URL ?? "http://localhost:8081");
  if (developmentUrl.protocol !== "http:" && developmentUrl.protocol !== "https:") {
    throw new Error(`桌面开发服务器地址必须使用 HTTP(S)：${developmentUrl.toString()}`);
  }
  return { kind: "development", origin: developmentUrl.origin };
}

export function isTrustedRendererUrl(value: string, policy: TrustedRendererPolicy): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (policy.kind === "development") {
    return url.origin === policy.origin && url.username === "" && url.password === "";
  }
  return (
    url.protocol === policy.appProtocol &&
    url.hostname === policy.appHost &&
    url.port === "" &&
    url.username === "" &&
    url.password === ""
  );
}

function expectedRendererOrigin(policy: TrustedRendererPolicy): string {
  return policy.kind === "packaged" ? policy.appOrigin : policy.origin;
}

export function assertTrustedIpcSender(
  event: TrustedIpcEvent,
  policy: TrustedRendererPolicy = getTrustedRendererPolicy(),
): void {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) {
    throw new Error("拒绝来自非主框架的桌面 IPC");
  }
  if (frame.origin !== expectedRendererOrigin(policy) || !isTrustedRendererUrl(frame.url, policy)) {
    throw new Error("拒绝来自非受信任页面的桌面 IPC");
  }
}

export function classifyMainWindowNavigation(
  value: string,
  policy: TrustedRendererPolicy,
): "allow" | "open-external" | "deny" {
  if (isTrustedRendererUrl(value, policy)) {
    return "allow";
  }
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:" ? "open-external" : "deny";
  } catch {
    return "deny";
  }
}
