import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "vitest";
import { CloudDeviceAuthorizationClient } from "./cloud-device-authorization.js";

describe("Cloud device authorization", () => {
  it("retries when poll headers arrive but the response body stalls", async () => {
    const cloud = await RegistrationCloud.start("stalled-body");
    try {
      const outcome = await new CloudDeviceAuthorizationClient().poll(
        cloud.origin,
        "device-code-with-more-than-thirty-two-characters",
        100,
      );

      assert.deepEqual(outcome, { status: "retry_later" });
      assert.deepEqual(cloud.receivedPaths, ["/api/device-authorizations/poll"]);
    } finally {
      await cloud.stop();
    }
  });

  it("rejects a completed malformed poll response", async () => {
    const cloud = await RegistrationCloud.start("malformed-body");
    try {
      await assert.rejects(
        new CloudDeviceAuthorizationClient().poll(
          cloud.origin,
          "device-code-with-more-than-thirty-two-characters",
          1_000,
        ),
      );
    } finally {
      await cloud.stop();
    }
  });
});

type RegistrationCloudResponse = "stalled-body" | "malformed-body";

class RegistrationCloud {
  readonly receivedPaths: string[] = [];

  private constructor(
    readonly origin: string,
    private readonly server: Server,
  ) {}

  static async start(responseBody: RegistrationCloudResponse): Promise<RegistrationCloud> {
    let cloud: RegistrationCloud;
    const server = createServer((request, response) => {
      if (request.url !== undefined) cloud.receivedPaths.push(request.url);
      response.writeHead(200, { "content-type": "application/json" });
      if (responseBody === "malformed-body") {
        response.end("not-json");
        return;
      }
      response.write('{"status":"pending","interval":5');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    cloud = new RegistrationCloud(`http://127.0.0.1:${address.port}`, server);
    return cloud;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}
