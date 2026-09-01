import { describe, expect, test } from "vitest";
import {
  DAEMON_PERMISSIONS,
  OWNER_PERMISSIONS,
  SessionAuthorization,
  permissionsForLegacyHubScopes,
  parseDaemonPermissions,
} from "./index.js";

describe("SessionAuthorization", () => {
  test("owner authority contains every semantic permission", () => {
    const authorization = new SessionAuthorization(OWNER_PERMISSIONS);

    expect(
      DAEMON_PERMISSIONS.every((permission) => authorization.allowsPermission(permission)),
    ).toBe(true);
  });

  test("semantic permissions authorize operations instead of RPC namespaces", () => {
    const authorization = new SessionAuthorization(["hub.execute"]);

    expect(
      authorization.allowsInbound({
        type: "hub.execution.agent.create.request",
        requestId: "create",
        executionId: "execution",
        provider: "codex",
        cwd: "/workspace",
        prompt: "run",
      }),
    ).toBe(true);
    expect(
      authorization.allowsInbound({
        type: "hub.management.daemon.get_status.request",
        requestId: "status",
      }),
    ).toBe(false);
  });

  test("correlated authorization errors can always be emitted", () => {
    const authorization = new SessionAuthorization([]);

    expect(
      authorization.allowsOutbound({
        type: "rpc_error",
        payload: {
          requestId: "denied",
          requestType: "hub.execution.agent.create.request",
          error: "denied",
          code: "access_denied",
        },
      }),
    ).toBe(true);
  });

  test("legacy Hub authority is translated at one compatibility boundary", () => {
    expect(permissionsForLegacyHubScopes(["hub.execution.*"])).toEqual(["hub.execute"]);
    expect(() => permissionsForLegacyHubScopes(["*"])).toThrow("Unsupported legacy Hub scopes: *");
  });

  test("permission names are semantic", () => {
    expect(
      DAEMON_PERMISSIONS.every(
        (permission) => !permission.includes("*") && !permission.includes("request"),
      ),
    ).toBe(true);
  });

  test("permission parsing validates against the shared registry and removes duplicates", () => {
    expect(parseDaemonPermissions(["hub.execute", "hub.execute"])).toEqual(["hub.execute"]);
    expect(() => parseDaemonPermissions(["hub.execution.*"])).toThrow("Invalid daemon permission");
  });
});
