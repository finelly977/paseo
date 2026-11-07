import { expect, test } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages.js";

test("Codex 市场目录和管理消息通过会话协议", () => {
  const request = {
    type: "codex.plugins.get_catalog.request",
    requestId: "1",
    scope: "official",
    force: false,
    query: "Remotion",
    offset: 50,
  };
  expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  const response = {
    type: "codex.plugins.get_catalog.response",
    payload: {
      requestId: "1",
      catalog: { marketplaces: [], errors: [], total: 0, nextOffset: null },
    },
  };
  expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  expect(
    SessionInboundMessageSchema.parse({
      type: "codex.plugins.manage.request",
      requestId: "2",
      action: { kind: "set_enabled", pluginId: "remotion@official", enabled: false },
    }).type,
  ).toBe("codex.plugins.manage.request");
});

test("非法插件标识和分页输入在边界拒绝", () => {
  expect(() =>
    SessionInboundMessageSchema.parse({
      type: "codex.plugins.manage.request",
      requestId: "1",
      action: { kind: "set_enabled", pluginId: 'x".model_provider', enabled: true },
    }),
  ).toThrow();
  expect(() =>
    SessionInboundMessageSchema.parse({
      type: "codex.plugins.get_catalog.request",
      requestId: "2",
      scope: "official",
      force: false,
      offset: -1,
    }),
  ).toThrow();
});
