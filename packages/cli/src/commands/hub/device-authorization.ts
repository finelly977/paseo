import { spawn } from "node:child_process";
import { platform } from "node:os";
import { z } from "zod";

const authorizationSchema = z.object({
  deviceCode: z.string().min(32),
  userCode: z.string().min(1),
  verificationUri: z.string().url(),
  verificationUriComplete: z.string().url(),
  expiresAt: z.string().datetime(),
  interval: z.number().int().min(5),
});

const pollSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending"), interval: z.number().int().min(5) }),
  z.object({ status: z.literal("slow_down"), interval: z.number().int().min(5) }),
  z.object({
    status: z.literal("approved"),
    interval: z.number().int().min(5),
    enrollmentToken: z.string().min(32),
  }),
  z.object({ status: z.literal("denied"), interval: z.number().int().min(5) }),
  z.object({ status: z.literal("expired"), interval: z.number().int().min(5) }),
  z.object({ status: z.literal("enrolled"), interval: z.number().int().min(5) }),
  z.object({ status: z.literal("retry_later") }),
]);

export type DeviceAuthorization = z.infer<typeof authorizationSchema>;
export type DeviceAuthorizationPoll = z.infer<typeof pollSchema>;

export interface CloudDeviceAuthorization {
  start(hubUrl: string, displayName: string): Promise<DeviceAuthorization>;
  poll(hubUrl: string, deviceCode: string): Promise<DeviceAuthorizationPoll>;
}

export interface AuthorizationWaiter {
  wait(milliseconds: number): Promise<void>;
  now(): number;
}

export interface BrowserOpener {
  open(url: string): Promise<void>;
}

export interface AuthorizationReporter {
  instructions(verificationUri: string, userCode: string): void;
}

interface DeviceAuthorizationWorkflowOptions {
  cloud: CloudDeviceAuthorization;
  waiter: AuthorizationWaiter;
  browser: BrowserOpener;
  reporter: AuthorizationReporter;
  openBrowser?: boolean;
}

export class DeviceAuthorizationWorkflow {
  constructor(private readonly options: DeviceAuthorizationWorkflowOptions) {}

  async authorize(hubUrl: string, displayName: string): Promise<string> {
    const authorization = await this.options.cloud.start(hubUrl, displayName);
    this.options.reporter.instructions(authorization.verificationUri, authorization.userCode);
    if (this.options.openBrowser !== false) {
      await this.options.browser.open(authorization.verificationUriComplete).catch(() => undefined);
    }

    let interval = authorization.interval;
    const expiresAt = Date.parse(authorization.expiresAt);
    while (true) {
      const remaining = expiresAt - this.options.waiter.now();
      if (remaining <= 0) throw new Error("Daemon registration expired");
      await this.options.waiter.wait(Math.min(interval * 1_000, remaining));
      if (this.options.waiter.now() >= expiresAt) throw new Error("Daemon registration expired");
      const outcome = await this.options.cloud.poll(hubUrl, authorization.deviceCode);
      if (outcome.status === "retry_later") continue;
      interval = outcome.interval;
      if (outcome.status === "approved") return outcome.enrollmentToken;
      if (outcome.status === "denied") throw new Error("Daemon registration was denied");
      if (outcome.status === "expired") throw new Error("Daemon registration expired");
      if (outcome.status === "enrolled") {
        throw new Error("Daemon registration was already used");
      }
    }
  }
}

export function createDeviceAuthorizationWorkflow(): DeviceAuthorizationWorkflow {
  return new DeviceAuthorizationWorkflow({
    cloud: new FetchCloudDeviceAuthorization(),
    waiter: {
      wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      now: Date.now,
    },
    browser: { open: openBrowser },
    reporter: {
      instructions(verificationUri, userCode) {
        process.stderr.write(`Open ${verificationUri} and enter code ${userCode}\n`);
      },
    },
    openBrowser: process.stderr.isTTY === true,
  });
}

class FetchCloudDeviceAuthorization implements CloudDeviceAuthorization {
  async start(hubUrl: string, displayName: string): Promise<DeviceAuthorization> {
    const response = await fetch(endpoint(hubUrl, "/api/device-authorizations/"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName }),
    });
    if (!response.ok) throw new Error(`Cloud registration failed (${response.status})`);
    return authorizationSchema.parse(await response.json());
  }

  async poll(hubUrl: string, deviceCode: string): Promise<DeviceAuthorizationPoll> {
    let response: Response;
    try {
      response = await fetch(endpoint(hubUrl, "/api/device-authorizations/poll"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceCode }),
      });
    } catch {
      return { status: "retry_later" };
    }
    if ([408, 425, 429].includes(response.status) || response.status >= 500) {
      return { status: "retry_later" };
    }
    if (!response.ok) throw new Error(`Cloud registration poll failed (${response.status})`);
    return pollSchema.parse(await response.json());
  }
}

function endpoint(hubUrl: string, pathname: string): string {
  const url = new URL(hubUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Hub URL must be an HTTP or HTTPS origin without credentials or a query");
  }
  url.pathname = `${url.pathname.replace(/\/$/u, "")}${pathname}`;
  return url.toString();
}

async function openBrowser(url: string): Promise<void> {
  const hostPlatform = platform();
  const command = browserCommand(hostPlatform);
  const args = hostPlatform === "win32" ? ["/c", "start", "", url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
    child.once("error", reject);
  });
}

function browserCommand(hostPlatform: NodeJS.Platform): string {
  if (hostPlatform === "darwin") return "open";
  if (hostPlatform === "win32") return "cmd";
  return "xdg-open";
}
