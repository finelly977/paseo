export interface AgentFailurePresentation {
  summary: string;
  details: string;
}

export function agentFailurePresentation(message: string): AgentFailurePresentation {
  const details = message
    .replace(/^\s*\[System Error\]\s*/, "")
    // oxlint-disable-next-line no-control-regex -- ANSI 控制字符是明确的诊断清理对象。
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .trim();
  let summary = "本次运行未完成，请查看诊断详情，处理原因后重新发送。";
  if (/token_revoked|refresh token was revoked|refresh token has been revoked/i.test(details)) {
    summary = "登录凭据已失效，请在智能体官方客户端重新登录后重试。";
  } else if (/invalid model|model.*not found/i.test(details)) {
    summary = "模型配置不可用，请检查当前模型后重试。";
  } else if (/app-server exited|process.*exited/i.test(details)) {
    summary = "智能体进程意外退出，请查看诊断详情后重试。";
  }
  return { summary, details };
}
