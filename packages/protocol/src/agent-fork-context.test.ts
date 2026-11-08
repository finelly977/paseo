import { expect, test } from "vitest";
import { SessionInboundMessageSchema } from "./messages.js";

test("原生回合分叉边界经入站协议保留", () => {
  const request = {
    type: "agent.fork_context.request",
    requestId: "r",
    agentId: "agent",
    boundaryTurnId: "stopped",
  };
  expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
});

test("未指定回合边界的既有请求保持不变", () => {
  const request = {
    type: "agent.fork_context.request",
    requestId: "r",
    agentId: "agent",
    boundaryMessageId: "message",
  };
  expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
});
