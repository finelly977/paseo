import { expect, test } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages.js";
test("Claude 插件请求保留明确安装范围与目录，不接受选项注入", () => {
  expect(
    SessionInboundMessageSchema.parse({
      type: "claude.plugins.manage.request",
      requestId: "one",
      cwd: "C:\\project",
      action: { kind: "install", pluginId: "demo@test", scope: "project" },
    }),
  ).toMatchObject({ cwd: "C:\\project", action: { scope: "project" } });
  expect(() =>
    SessionInboundMessageSchema.parse({
      type: "claude.plugins.manage.request",
      requestId: "one",
      action: { kind: "install", pluginId: "--help", scope: "user" },
    }),
  ).toThrow();
  expect(() =>
    SessionInboundMessageSchema.parse({
      type: "claude.plugins.manage.request",
      requestId: "one",
      action: { kind: "remove_marketplace", name: "--all", scope: "user" },
    }),
  ).toThrow();
});
test("Claude 插件响应保留请求标识与原生结果", () => {
  expect(
    SessionOutboundMessageSchema.safeParse({
      type: "claude.plugins.manage.response",
      payload: {
        requestId: "one",
        result: { restartRequired: true, message: "原生操作完成", confirmation: null },
      },
    }).success,
  ).toBe(true);
});
