import { expect, test } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages.js";

test("远程后端标识经详情与安装协议保留，未提供标识的请求仍可解析", () => {
  const target = {
    marketplaceName: "official",
    marketplacePath: null,
    pluginName: "app-example",
    remotePluginId: "plugin_asdk_app_example",
  };
  const request = { type: "codex.plugins.get_detail.request", requestId: "detail", target };
  expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  const install = {
    type: "codex.plugins.manage.request",
    requestId: "install",
    action: { kind: "install", ...target },
  };
  expect(SessionInboundMessageSchema.parse(install)).toEqual(install);
  const oldTarget = { marketplaceName: "official", marketplacePath: null, pluginName: "remotion" };
  expect(SessionInboundMessageSchema.parse({ ...request, target: oldTarget })).toEqual({
    ...request,
    target: oldTarget,
  });
});

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
