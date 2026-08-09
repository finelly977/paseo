import { describe, expect, test } from "vitest";

import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("会话运行时释放协议", () => {
  test("解析请求和响应", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.runtime.release.request",
        agentId: "agent-1",
        requestId: "release-1",
      }),
    ).toMatchObject({ type: "agent.runtime.release.request", agentId: "agent-1" });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "agent.runtime.release.response",
        payload: {
          agentId: "agent-1",
          requestId: "release-1",
          accepted: true,
          error: null,
        },
      }),
    ).toMatchObject({ type: "agent.runtime.release.response", payload: { accepted: true } });
  });

  test("旧守护进程可以不声明能力", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "old-host",
        features: {},
      }).features?.agentRuntimeRelease,
    ).toBeUndefined();

    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "new-host",
        features: { agentRuntimeRelease: true },
      }).features?.agentRuntimeRelease,
    ).toBe(true);
  });
});
