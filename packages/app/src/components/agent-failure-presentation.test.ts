import { expect, test } from "vitest";
import { agentFailurePresentation } from "./agent-failure-presentation";

test("登录失效只显示可操作摘要，保留不含颜色控制字符的完整诊断", () => {
  expect(
    agentFailurePresentation(
      "[System Error] Codex app-server exited\n\u001b[31mYour refresh token was revoked\u001b[0m",
    ),
  ).toEqual({
    summary: "登录凭据已失效，请在智能体官方客户端重新登录后重试。",
    details: "Codex app-server exited\nYour refresh token was revoked",
  });
});
test("其他故障不误报认证失败，诊断原文仍可展开和复制", () => {
  expect(agentFailurePresentation("invalid model id").summary).toBe(
    "模型配置不可用，请检查当前模型后重试。",
  );
  expect(agentFailurePresentation("Provider failed\ncode: 126")).toEqual({
    summary: "本次运行未完成，请查看诊断详情，处理原因后重新发送。",
    details: "Provider failed\ncode: 126",
  });
});
