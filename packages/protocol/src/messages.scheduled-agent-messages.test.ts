import { describe, expect, it } from "vitest";
import {
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  AgentMessageScheduleRequestSchema,
} from "./messages";

const request = {
  type: "agent.message.schedule.request" as const,
  requestId: "request",
  agentId: "c605de73-a4b6-4097-b5b3-4b819521d37d",
  clientMessageId: "message",
  text: "消息",
  delayMinutes: 5,
};
describe("定时消息协议", () => {
  it("命名空间请求和响应可解析，摘要无需携带图片内容", () => {
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
    const message = {
      id: "a605de73-a4b6-4097-b5b3-4b819521d37d",
      agentId: request.agentId,
      clientMessageId: "message",
      text: "消息",
      sendAt: "2026-10-11T12:05:00.000Z",
      createdAt: "2026-10-11T12:00:00.000Z",
      updatedAt: "2026-10-11T12:00:00.000Z",
      status: "waiting",
      error: null,
      imageCount: 1,
      attachmentCount: 0,
    };
    for (const type of [
      "agent.message.schedule.response",
      "agent.message.schedule.cancel.response",
      "agent.message.schedule.send-now.response",
    ]) {
      expect(
        SessionOutboundMessageSchema.parse({
          type,
          payload: { requestId: "request", message, error: null },
        }),
      ).toMatchObject({ payload: { message } });
    }
    for (const type of [
      "agent.message.schedule.cancel.request",
      "agent.message.schedule.send-now.request",
    ]) {
      expect(
        SessionInboundMessageSchema.parse({
          type,
          requestId: "request",
          agentId: request.agentId,
          messageId: message.id,
        }),
      ).toMatchObject({ type });
    }
    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.message.schedules.list.request",
        requestId: "request",
        agentId: request.agentId,
      }),
    ).toBeDefined();
    expect(
      SessionOutboundMessageSchema.parse({
        type: "agent.message.schedules.list.response",
        payload: { requestId: "request", messages: [message], error: null },
      }),
    ).toBeDefined();
  });
  it("分钟必须为范围内整数，图片不能为空或损坏的编码", () => {
    for (const delayMinutes of [0, -1, 1.5, 10081])
      expect(
        AgentMessageScheduleRequestSchema.safeParse({ ...request, delayMinutes }).success,
      ).toBe(false);
    for (const data of ["", "not base64!"])
      expect(
        AgentMessageScheduleRequestSchema.safeParse({
          ...request,
          images: [{ data, mimeType: "image/png" }],
        }).success,
      ).toBe(false);
    expect(
      AgentMessageScheduleRequestSchema.parse({
        ...request,
        images: [{ data: "aW1hZ2U=", mimeType: "image/png" }],
      }).images,
    ).toHaveLength(1);
  });
});
