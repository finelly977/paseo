import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GIT_AI_COMMIT_MESSAGE_PROMPT,
  DEFAULT_GIT_AI_COMMIT_REVIEW_PROMPT,
} from "@getpaseo/protocol/messages";
import {
  GitAiSession,
  buildGitCommitMessagePrompt,
  buildGitCommitReviewPrompt,
  resolveGitAiCleanupStrategy,
} from "./git-ai-session.js";

describe("Git AI 临时智能体清理策略", () => {
  it.each(["claude", "codex", "opencode", "pi", "grok"])("%s 使用删除型清理", (provider) => {
    expect(resolveGitAiCleanupStrategy(provider)).toBe("delete");
  });

  it("其他智能体使用归档型清理", () => {
    expect(resolveGitAiCleanupStrategy("gemini")).toBe("archive");
    expect(resolveGitAiCleanupStrategy("custom-acp")).toBe("archive");
  });

  it("智能体标识不受首尾空格和大小写影响", () => {
    expect(resolveGitAiCleanupStrategy("  CoDeX ")).toBe("delete");
  });
});

describe("Git AI 提示词", () => {
  it("提交说明提示词包含改动、差异和用户规则", () => {
    const prompt = buildGitCommitMessagePrompt({
      files: "改动文件：\n修改\tpackages/app/src/a.ts\t(+2 -1)",
      patch: "diff --git a/a.ts b/a.ts",
      customPrompt: "使用简体中文，标题不超过 30 个字",
    });

    expect(prompt).toContain("packages/app/src/a.ts");
    expect(prompt).toContain("diff --git a/a.ts b/a.ts");
    expect(prompt).toContain("使用简体中文，标题不超过 30 个字");
    expect(prompt).toContain("不得描述分析过程");
  });

  it("提交审查提示词限定指定提交和只读检查", () => {
    const prompt = buildGitCommitReviewPrompt({
      sha: "abc1234",
      customPrompt: "优先检查并发问题",
    });

    expect(prompt).toContain("abc1234");
    expect(prompt).toContain("只读 Git 命令");
    expect(prompt).toContain("优先检查并发问题");
  });

  it("空白设置会使用预置的提交说明与审查提示词", () => {
    const commitMessagePrompt = buildGitCommitMessagePrompt({
      files: "改动文件：\n修改\ta.ts\t(+1 -0)",
      patch: "diff --git a/a.ts b/a.ts",
      customPrompt: "  ",
    });
    const reviewPrompt = buildGitCommitReviewPrompt({ sha: "abc1234", customPrompt: "" });

    expect(commitMessagePrompt).toContain(DEFAULT_GIT_AI_COMMIT_MESSAGE_PROMPT);
    expect(reviewPrompt).toContain(DEFAULT_GIT_AI_COMMIT_REVIEW_PROMPT);
  });
});

describe("Git AI 会话清理", () => {
  it("断开会话时取消并清理正在生成提交说明的临时智能体", async () => {
    let rejectRun!: (error: Error) => void;
    let running = true;
    let live = true;
    const runAgent = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectRun = reject;
        }),
    );
    const cancelAgentRun = vi.fn(async () => {
      running = false;
      rejectRun(new Error("测试取消生成"));
    });
    const closeAgent = vi.fn(async () => {
      live = false;
    });
    const flush = vi.fn(async () => undefined);
    const deleteAgentState = vi.fn(async () => undefined);
    const agentManager = {
      createAgent: vi.fn(async () => ({ id: "agent-1", provider: "codex" })),
      runAgent,
      hasInFlightRun: vi.fn(() => running),
      cancelAgentRun,
      getAgent: vi.fn(() => (live ? { persistence: null } : null)),
      closeAgent,
      flush,
      deleteAgentState,
      archiveNativeSessionBestEffort: vi.fn(async () => undefined),
    };
    const logger = {
      child: vi.fn(() => logger),
      error: vi.fn(),
    };
    const session = new GitAiSession({
      host: { emit: vi.fn() },
      agentManager: agentManager as never,
      workspaceGitService: {
        getCheckoutDiff: vi.fn(async () => ({
          diff: "diff --git a/a.ts b/a.ts",
          structured: [],
        })),
      },
      readDaemonConfig: () =>
        ({
          gitAi: {
            commitMessage: {
              provider: "codex",
              model: null,
              modeId: null,
              thinkingOptionId: null,
              prompt: "",
            },
            commitReview: {
              provider: null,
              model: null,
              modeId: null,
              thinkingOptionId: null,
              prompt: "",
            },
          },
        }) as never,
      logger: logger as never,
    });

    const generation = session.handleGenerateCommitMessageRequest({
      type: "git.ai.generate_commit_message.request",
      cwd: "E:\\paseo",
      requestId: "request-1",
    });
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledOnce());

    await session.cleanup();
    await generation;

    expect(cancelAgentRun).toHaveBeenCalledOnce();
    expect(closeAgent).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledOnce();
    expect(deleteAgentState).toHaveBeenCalledOnce();
  });
});
