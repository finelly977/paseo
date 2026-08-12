import { describe, expect, it } from "vitest";
import {
  DEFAULT_GIT_AI_COMMIT_MESSAGE_PROMPT,
  DEFAULT_GIT_AI_COMMIT_REVIEW_PROMPT,
  GIT_AI_COMMIT_REVIEW_PROMPT_VERSION,
  GitAiConfigSchema,
  MutableDaemonConfigPatchSchema,
  MutableDaemonConfigSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

const BASE_MUTABLE_CONFIG = {
  mcp: { injectIntoAgents: false },
};

describe("Git AI 配置协议", () => {
  it("缺少 Git AI 配置时仍能解析旧主机配置", () => {
    const parsed = MutableDaemonConfigSchema.parse(BASE_MUTABLE_CONFIG);
    expect(parsed.gitAi).toBeUndefined();
  });

  it("空配置会生成两套完整的独立任务设置", () => {
    const parsed = GitAiConfigSchema.parse({});
    expect(parsed.commitMessage).toEqual({
      provider: null,
      model: null,
      modeId: null,
      thinkingOptionId: null,
      prompt: DEFAULT_GIT_AI_COMMIT_MESSAGE_PROMPT,
    });
    expect(parsed.commitReview).toEqual({
      provider: null,
      model: null,
      modeId: null,
      thinkingOptionId: null,
      promptVersion: GIT_AI_COMMIT_REVIEW_PROMPT_VERSION,
      prompt: DEFAULT_GIT_AI_COMMIT_REVIEW_PROMPT,
    });
    expect(parsed.commitReview).not.toBe(parsed.commitMessage);
  });

  it("任务配置缺少提示词时按用途补入不同默认值", () => {
    const parsed = GitAiConfigSchema.parse({
      commitMessage: { provider: "codex" },
      commitReview: { provider: "claude" },
    });
    expect(parsed.commitMessage.prompt).toBe(DEFAULT_GIT_AI_COMMIT_MESSAGE_PROMPT);
    expect(parsed.commitReview.prompt).toBe(DEFAULT_GIT_AI_COMMIT_REVIEW_PROMPT);
  });

  it("配置补丁允许只更新一项提示词", () => {
    const parsed = MutableDaemonConfigPatchSchema.parse({
      gitAi: { commitReview: { prompt: "检查资源释放" } },
    });
    expect(parsed.gitAi?.commitReview?.prompt).toBe("检查资源释放");
    expect(parsed.gitAi?.commitMessage).toBeUndefined();
  });

  it("配置补丁允许为 OpenCode 开启自动批准", () => {
    const parsed = MutableDaemonConfigPatchSchema.parse({
      gitAi: { commitReview: { autoApprovePermissions: true } },
    });
    expect(parsed.gitAi?.commitReview?.autoApprovePermissions).toBe(true);
  });

  it("配置补丁允许标记审查提示词版本", () => {
    const parsed = MutableDaemonConfigPatchSchema.parse({
      gitAi: { commitReview: { promptVersion: GIT_AI_COMMIT_REVIEW_PROMPT_VERSION } },
    });
    expect(parsed.gitAi?.commitReview?.promptVersion).toBe(GIT_AI_COMMIT_REVIEW_PROMPT_VERSION);
  });
});

describe("Git AI 会话协议", () => {
  it("解析提交审查启动请求", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "git.ai.start_commit_review.request",
        cwd: "E:\\paseo",
        sha: "abcdef1234567",
        workspaceId: "workspace-1",
        requestId: "request-1",
      }),
    ).toMatchObject({ type: "git.ai.start_commit_review.request", sha: "abcdef1234567" });
  });

  it("拒绝不是 Git 提交标识的审查请求", () => {
    expect(() =>
      SessionInboundMessageSchema.parse({
        type: "git.ai.start_commit_review.request",
        cwd: "E:\\paseo",
        sha: "not-a-sha",
        requestId: "request-1",
      }),
    ).toThrow();
  });

  it("解析提交审查流事件", () => {
    expect(
      SessionOutboundMessageSchema.parse({
        type: "git.ai.commit_review.stream",
        payload: {
          taskId: "task-1",
          agentId: "agent-1",
          event: {
            type: "timeline",
            provider: "codex",
            item: {
              type: "assistant_message",
              messageId: "message-1",
              text: "发现一个问题",
            },
          },
          timestamp: "2026-08-10T00:00:00.000Z",
        },
      }),
    ).toMatchObject({ type: "git.ai.commit_review.stream" });
  });
});
