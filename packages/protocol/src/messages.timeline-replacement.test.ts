import { describe, expect, test } from "vitest";
import { CLIENT_CAPS } from "./client-capabilities.js";
import { SessionOutboundMessageSchema, WSHelloMessageSchema } from "./messages.js";

describe("时间线替换协议", () => {
  test("客户端必须显式声明替换失效能力", () => {
    const hello = WSHelloMessageSchema.parse({
      type: "hello",
      clientId: "capable-client",
      clientType: "mobile",
      protocolVersion: 1,
      capabilities: { [CLIENT_CAPS.timelineReplacementInvalidation]: true },
    });

    expect(hello.capabilities).toEqual({ timeline_replacement_invalidation: true });
  });

  test("替换通知只携带智能体与新时间线版本", () => {
    expect(
      SessionOutboundMessageSchema.parse({
        type: "agent.timeline.replacement",
        payload: { agentId: "agent-1", epoch: "epoch-2" },
      }),
    ).toEqual({
      type: "agent.timeline.replacement",
      payload: { agentId: "agent-1", epoch: "epoch-2" },
    });
  });
});
