import { randomUUID } from "node:crypto";
import { z } from "zod";
import type pino from "pino";
import {
  DEFAULT_GIT_AI_COMMIT_MESSAGE_PROMPT,
  DEFAULT_GIT_AI_COMMIT_REVIEW_PROMPT,
  GIT_AI_COMMIT_REVIEW_PROMPT_VERSION,
  LEGACY_GIT_AI_COMMIT_REVIEW_RUNTIME_PROMPT,
  type GitAiCloseCommitReviewRequest,
  type GitAiGenerateCommitMessageRequest,
  type GitAiStartCommitReviewRequest,
  type GitAiTaskProfile,
  type MutableDaemonConfig,
  type SessionOutboundMessage,
} from "@getpaseo/protocol/messages";
import type { AgentSessionConfig } from "../agent/agent-sdk-types.js";
import type { AgentManager, AgentManagerEvent } from "../agent/agent-manager.js";
import { getStructuredAgentResponse } from "../agent/agent-response-loop.js";
import type { WorkspaceGitService } from "../workspace-git-service.js";
import { serializeAgentSnapshot, serializeAgentStreamEvent } from "../messages.js";

const DELETE_SESSION_PROVIDERS = new Set(["claude", "codex", "opencode", "pi", "grok"]);
const MAX_COMMIT_PATCH_CHARS = 120_000;
const COMMIT_MESSAGE_SCHEMA = z.object({
  message: z.string().trim().min(1).max(4_000),
});

export type GitAiCleanupStrategy = "delete" | "archive";

export function resolveGitAiCleanupStrategy(provider: string): GitAiCleanupStrategy {
  return DELETE_SESSION_PROVIDERS.has(provider.trim().toLowerCase()) ? "delete" : "archive";
}

export function buildGitCommitMessagePrompt(input: {
  files: string;
  patch: string;
  customPrompt: string;
}): string {
  const taskPrompt = input.customPrompt.trim() || DEFAULT_GIT_AI_COMMIT_MESSAGE_PROMPT;
  return [
    "你只负责根据当前未提交改动生成 Git 提交说明。",
    "提交说明必须准确概括实际改动，不得描述分析过程、工具调用或未发生的工作。",
    "可以输出单行标题，也可以输出标题与正文；不要使用 Markdown 代码块。",
    `提交说明规则：\n${taskPrompt}`,
    "",
    input.files,
    "",
    input.patch || "（没有可用的差异内容）",
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}

export function buildGitCommitReviewPrompt(input: {
  sha: string;
  customPrompt: string;
  promptVersion?: number;
}): string {
  const customPrompt = input.customPrompt.trim();
  const taskPrompt = customPrompt || DEFAULT_GIT_AI_COMMIT_REVIEW_PROMPT;
  let completePrompt = taskPrompt;
  const isLegacyPrompt =
    customPrompt &&
    (input.promptVersion === undefined ||
      input.promptVersion < GIT_AI_COMMIT_REVIEW_PROMPT_VERSION);
  // COMPAT(gitAiCompleteReviewPrompt)：v0.2.2 保留旧配置原有审查约束，2027-02-12 后删除。
  if (isLegacyPrompt && !taskPrompt.startsWith(LEGACY_GIT_AI_COMMIT_REVIEW_RUNTIME_PROMPT)) {
    completePrompt = `${LEGACY_GIT_AI_COMMIT_REVIEW_RUNTIME_PROMPT}\n${taskPrompt}`;
  }
  return [`审查目标提交：${input.sha}`, completePrompt]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

interface GitAiSessionHost {
  emit(message: SessionOutboundMessage): void;
}

interface GitCommitReviewTask {
  taskId: string;
  agentId: string;
  provider: string;
  cleanupStrategy: GitAiCleanupStrategy;
  unsubscribe: (() => void) | null;
}

interface GitCommitMessageTask {
  agentId: string;
  provider: string;
  cleanupStrategy: GitAiCleanupStrategy;
}

type ConfiguredGitAiTaskProfile = GitAiTaskProfile & { provider: string };

const OPENCODE_PROVIDER_ID = "opencode";
const OPENCODE_AUTO_ACCEPT_FEATURE_ID = "auto_accept";

export interface GitAiSessionOptions {
  host: GitAiSessionHost;
  agentManager: AgentManager;
  workspaceGitService: Pick<WorkspaceGitService, "getCheckoutDiff">;
  readDaemonConfig: () => MutableDaemonConfig;
  logger: pino.Logger;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireConfiguredProfile(
  config: MutableDaemonConfig,
  key: "commitMessage" | "commitReview",
): ConfiguredGitAiTaskProfile {
  const profile = config.gitAi?.[key];
  if (!profile?.provider) {
    const taskName = key === "commitMessage" ? "提交说明生成" : "提交审查";
    throw new Error(`请先在主机的智能体设置中配置${taskName}使用的智能体`);
  }
  return { ...profile, provider: profile.provider };
}

function buildAgentConfig(input: {
  profile: GitAiTaskProfile;
  cwd: string;
  title: string;
}): AgentSessionConfig {
  const { profile } = input;
  if (!profile.provider) {
    throw new Error("Git AI 任务缺少智能体配置");
  }
  return {
    provider: profile.provider,
    cwd: input.cwd,
    title: input.title,
    internal: true,
    ...(profile.model ? { model: profile.model } : {}),
    ...(profile.modeId ? { modeId: profile.modeId } : {}),
    ...(profile.thinkingOptionId ? { thinkingOptionId: profile.thinkingOptionId } : {}),
    ...(profile.provider === OPENCODE_PROVIDER_ID && profile.autoApprovePermissions === true
      ? { featureValues: { [OPENCODE_AUTO_ACCEPT_FEATURE_ID]: true } }
      : {}),
  };
}

function renderChangedFiles(
  structured: Awaited<ReturnType<WorkspaceGitService["getCheckoutDiff"]>>["structured"],
): string {
  if (!structured || structured.length === 0) {
    return "改动文件：（未知）";
  }
  return [
    "改动文件：",
    ...structured.map((file) => {
      let status = "修改";
      if (file.isNew) {
        status = "新增";
      } else if (file.isDeleted) {
        status = "删除";
      }
      return `${status}\t${file.path}\t(+${file.additions} -${file.deletions})`;
    }),
  ].join("\n");
}

function truncatePatch(patch: string): string {
  if (patch.length <= MAX_COMMIT_PATCH_CHARS) {
    return patch;
  }
  return `${patch.slice(0, MAX_COMMIT_PATCH_CHARS)}\n\n（差异内容已截断）`;
}

export class GitAiSession {
  private readonly host: GitAiSessionHost;
  private readonly agentManager: AgentManager;
  private readonly workspaceGitService: Pick<WorkspaceGitService, "getCheckoutDiff">;
  private readonly readDaemonConfig: () => MutableDaemonConfig;
  private readonly logger: pino.Logger;
  private readonly reviewTasks = new Map<string, GitCommitReviewTask>();
  private readonly commitMessageTasks = new Map<string, GitCommitMessageTask>();
  private readonly cleanupPromises = new Map<string, Promise<void>>();
  private cleaningUp = false;

  constructor(options: GitAiSessionOptions) {
    this.host = options.host;
    this.agentManager = options.agentManager;
    this.workspaceGitService = options.workspaceGitService;
    this.readDaemonConfig = options.readDaemonConfig;
    this.logger = options.logger.child({ module: "git-ai-session" });
  }

  async handleGenerateCommitMessageRequest(
    message: GitAiGenerateCommitMessageRequest,
  ): Promise<void> {
    try {
      const generated = await this.generateCommitMessage(message.cwd);
      this.host.emit({
        type: "git.ai.generate_commit_message.response",
        payload: {
          cwd: message.cwd,
          success: true,
          message: generated,
          error: null,
          requestId: message.requestId,
        },
      });
    } catch (error) {
      this.logger.error({ err: error, cwd: message.cwd }, "生成 Git 提交说明失败");
      this.host.emit({
        type: "git.ai.generate_commit_message.response",
        payload: {
          cwd: message.cwd,
          success: false,
          message: null,
          error: errorMessage(error),
          requestId: message.requestId,
        },
      });
    }
  }

  async handleStartCommitReviewRequest(message: GitAiStartCommitReviewRequest): Promise<void> {
    let task: GitCommitReviewTask | null = null;
    let createdAgent: Awaited<ReturnType<AgentManager["createAgent"]>> | null = null;
    let cleanupStrategy: GitAiCleanupStrategy | null = null;
    try {
      this.requireActiveSession();
      const profile = requireConfiguredProfile(this.readDaemonConfig(), "commitReview");
      cleanupStrategy = resolveGitAiCleanupStrategy(profile.provider);
      createdAgent = await this.agentManager.createAgent(
        buildAgentConfig({ profile, cwd: message.cwd, title: "Git 提交审查" }),
        undefined,
        {
          persistSession: cleanupStrategy !== "delete",
          workspaceId: message.workspaceId,
        },
      );
      this.requireActiveSession();
      const taskId = randomUUID();
      const unsubscribe = this.agentManager.subscribe(
        (event) => this.forwardReviewEvent(taskId, event),
        { agentId: createdAgent.id, replayState: false },
      );
      task = {
        taskId,
        agentId: createdAgent.id,
        provider: createdAgent.provider,
        cleanupStrategy,
        unsubscribe,
      };
      this.reviewTasks.set(taskId, task);
      this.host.emit({
        type: "git.ai.start_commit_review.response",
        payload: {
          cwd: message.cwd,
          sha: message.sha,
          success: true,
          taskId,
          agent: serializeAgentSnapshot(createdAgent, { title: "Git 提交审查" }),
          error: null,
          requestId: message.requestId,
        },
      });
      const prompt = buildGitCommitReviewPrompt({
        sha: message.sha,
        customPrompt: profile.prompt,
        promptVersion: profile.promptVersion,
      });
      queueMicrotask(() => this.runCommitReview(taskId, prompt));
    } catch (error) {
      if (task) {
        const failedTask = task;
        this.reviewTasks.delete(failedTask.taskId);
        await this.cleanupReviewTask(failedTask).catch((cleanupError) => {
          this.reviewTasks.set(failedTask.taskId, failedTask);
          this.logger.error(
            { err: cleanupError, taskId: failedTask.taskId },
            "启动失败后清理 Git 提交审查智能体失败",
          );
        });
      } else if (createdAgent && cleanupStrategy) {
        const unregisteredAgent = createdAgent;
        const recoveryTask: GitCommitReviewTask = {
          taskId: randomUUID(),
          agentId: unregisteredAgent.id,
          provider: unregisteredAgent.provider,
          cleanupStrategy,
          unsubscribe: null,
        };
        await this.cleanupTemporaryAgent(
          unregisteredAgent.id,
          unregisteredAgent.provider,
          cleanupStrategy,
        ).catch((cleanupError) => {
          this.reviewTasks.set(recoveryTask.taskId, recoveryTask);
          this.logger.error(
            { err: cleanupError, agentId: unregisteredAgent.id },
            "启动失败后清理未注册的 Git 提交审查智能体失败",
          );
        });
      }
      this.logger.error(
        { err: error, cwd: message.cwd, sha: message.sha },
        "启动 Git 提交审查失败",
      );
      this.host.emit({
        type: "git.ai.start_commit_review.response",
        payload: {
          cwd: message.cwd,
          sha: message.sha,
          success: false,
          taskId: null,
          agent: null,
          error: errorMessage(error),
          requestId: message.requestId,
        },
      });
    }
  }

  async handleCloseCommitReviewRequest(message: GitAiCloseCommitReviewRequest): Promise<void> {
    const task = this.reviewTasks.get(message.taskId);
    if (!task) {
      this.host.emit({
        type: "git.ai.close_commit_review.response",
        payload: {
          taskId: message.taskId,
          success: false,
          error: "未找到要关闭的 Git 提交审查任务",
          requestId: message.requestId,
        },
      });
      return;
    }

    this.reviewTasks.delete(task.taskId);
    try {
      await this.cleanupReviewTask(task);
      this.host.emit({
        type: "git.ai.close_commit_review.response",
        payload: {
          taskId: task.taskId,
          success: true,
          error: null,
          requestId: message.requestId,
        },
      });
    } catch (error) {
      this.reviewTasks.set(task.taskId, task);
      this.logger.error({ err: error, taskId: task.taskId }, "关闭 Git 提交审查失败");
      this.host.emit({
        type: "git.ai.close_commit_review.response",
        payload: {
          taskId: task.taskId,
          success: false,
          error: errorMessage(error),
          requestId: message.requestId,
        },
      });
    }
  }

  async cleanup(): Promise<void> {
    this.cleaningUp = true;
    const reviewTasks = [...this.reviewTasks.values()];
    const commitMessageTasks = [...this.commitMessageTasks.values()];
    const inFlightCleanups = [...this.cleanupPromises.values()];
    this.reviewTasks.clear();
    this.commitMessageTasks.clear();
    const results = await Promise.allSettled([
      ...inFlightCleanups,
      ...reviewTasks.map((task) => this.cleanupReviewTask(task)),
      ...commitMessageTasks.map((task) =>
        this.cleanupTemporaryAgent(task.agentId, task.provider, task.cleanupStrategy),
      ),
    ]);
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length > 0) {
      throw new AggregateError(errors, "清理 Git AI 审查任务失败");
    }
  }

  private async generateCommitMessage(cwd: string): Promise<string> {
    this.requireActiveSession();
    const profile = requireConfiguredProfile(this.readDaemonConfig(), "commitMessage");
    const cleanupStrategy = resolveGitAiCleanupStrategy(profile.provider);
    const diff = await this.workspaceGitService.getCheckoutDiff(
      cwd,
      {
        mode: "uncommitted",
        includeStructured: true,
      },
      {
        force: true,
        reason: "生成 Git 提交说明",
      },
    );
    if (!diff.diff.trim() && (!diff.structured || diff.structured.length === 0)) {
      throw new Error("当前没有可用于生成提交说明的改动");
    }
    const prompt = buildGitCommitMessagePrompt({
      files: renderChangedFiles(diff.structured),
      patch: truncatePatch(diff.diff),
      customPrompt: profile.prompt,
    });
    this.requireActiveSession();
    const agent = await this.agentManager.createAgent(
      buildAgentConfig({ profile, cwd, title: "Git 提交说明" }),
      undefined,
      { persistSession: cleanupStrategy !== "delete", workspaceId: undefined },
    );
    if (this.cleaningUp) {
      await this.cleanupTemporaryAgent(agent.id, agent.provider, cleanupStrategy);
      throw new Error("Git AI 会话正在关闭");
    }
    const task: GitCommitMessageTask = {
      agentId: agent.id,
      provider: agent.provider,
      cleanupStrategy,
    };
    this.commitMessageTasks.set(agent.id, task);

    let result: string | null = null;
    let generationError: unknown;
    try {
      const response = await getStructuredAgentResponse({
        caller: async (nextPrompt) => {
          const run = await this.agentManager.runAgent(agent.id, nextPrompt);
          const finalText = run.finalText?.trim();
          if (finalText) {
            return finalText;
          }
          return run.timeline.findLast((item) => item.type === "assistant_message")?.text ?? "";
        },
        prompt,
        schema: COMMIT_MESSAGE_SCHEMA,
        schemaName: "GitCommitMessage",
        maxRetries: 1,
      });
      result = response.message.trim();
    } catch (error) {
      generationError = error;
    }

    let cleanupError: unknown;
    try {
      await this.cleanupTemporaryAgent(agent.id, agent.provider, cleanupStrategy);
    } catch (error) {
      cleanupError = error;
    }
    this.commitMessageTasks.delete(agent.id);

    if (generationError !== undefined && cleanupError !== undefined) {
      throw new AggregateError([generationError, cleanupError], "生成并清理 Git 提交说明任务失败");
    }
    if (generationError !== undefined) {
      throw generationError;
    }
    if (cleanupError !== undefined) {
      throw cleanupError;
    }
    if (!result) {
      throw new Error("智能体没有返回提交说明");
    }
    return result;
  }

  private requireActiveSession(): void {
    if (this.cleaningUp) {
      throw new Error("Git AI 会话正在关闭");
    }
  }

  private runCommitReview(taskId: string, prompt: string): void {
    const task = this.reviewTasks.get(taskId);
    if (!task) {
      return;
    }
    this.host.emit({
      type: "git.ai.commit_review.status",
      payload: { taskId, agentId: task.agentId, status: "running", error: null },
    });
    void this.agentManager
      .runAgent(task.agentId, prompt)
      .then(() => {
        if (!this.reviewTasks.has(taskId)) {
          return;
        }
        this.host.emit({
          type: "git.ai.commit_review.status",
          payload: { taskId, agentId: task.agentId, status: "completed", error: null },
        });
        return undefined;
      })
      .catch((error) => {
        if (!this.reviewTasks.has(taskId)) {
          return;
        }
        this.logger.error({ err: error, taskId, agentId: task.agentId }, "Git 提交审查失败");
        this.host.emit({
          type: "git.ai.commit_review.status",
          payload: {
            taskId,
            agentId: task.agentId,
            status: "failed",
            error: errorMessage(error),
          },
        });
      });
  }

  private forwardReviewEvent(taskId: string, event: AgentManagerEvent): void {
    if (event.type !== "agent_stream") {
      return;
    }
    const tracked = this.reviewTasks.has(taskId);
    if (!tracked && event.event.type !== "permission_resolved") {
      return;
    }
    if (tracked) {
      const serialized = serializeAgentStreamEvent(event.event);
      if (serialized) {
        this.host.emit({
          type: "git.ai.commit_review.stream",
          payload: {
            taskId,
            agentId: event.agentId,
            event: serialized,
            timestamp: event.timestamp ?? new Date().toISOString(),
            ...(typeof event.seq === "number" ? { seq: event.seq } : {}),
            ...(typeof event.epoch === "string" ? { epoch: event.epoch } : {}),
          },
        });
      }
    }
    if (tracked && event.event.type === "permission_requested") {
      this.host.emit({
        type: "agent_permission_request",
        payload: { agentId: event.agentId, request: event.event.request },
      });
    } else if (event.event.type === "permission_resolved") {
      this.host.emit({
        type: "agent_permission_resolved",
        payload: {
          agentId: event.agentId,
          requestId: event.event.requestId,
          resolution: event.event.resolution,
        },
      });
    }
  }

  private async cleanupReviewTask(task: GitCommitReviewTask): Promise<void> {
    await this.cleanupTemporaryAgent(task.agentId, task.provider, task.cleanupStrategy);
    task.unsubscribe?.();
    task.unsubscribe = null;
  }

  private cleanupTemporaryAgent(
    agentId: string,
    provider: string,
    cleanupStrategy: GitAiCleanupStrategy,
  ): Promise<void> {
    const existing = this.cleanupPromises.get(agentId);
    if (existing) {
      return existing;
    }
    const cleanup = this.performTemporaryAgentCleanup(agentId, provider, cleanupStrategy);
    this.cleanupPromises.set(agentId, cleanup);
    const clear = () => {
      if (this.cleanupPromises.get(agentId) === cleanup) {
        this.cleanupPromises.delete(agentId);
      }
    };
    void cleanup.then(clear, clear);
    return cleanup;
  }

  private async performTemporaryAgentCleanup(
    agentId: string,
    provider: string,
    cleanupStrategy: GitAiCleanupStrategy,
  ): Promise<void> {
    const errors: unknown[] = [];
    if (this.agentManager.hasInFlightRun(agentId)) {
      try {
        await this.agentManager.cancelAgentRun(agentId);
      } catch (error) {
        errors.push(error);
      }
    }

    if (cleanupStrategy === "archive") {
      if (this.agentManager.getAgent(agentId)) {
        try {
          await this.agentManager.archiveAgent(agentId);
        } catch (error) {
          errors.push(error);
        }
      }
    } else {
      let persistence = this.agentManager.getAgent(agentId)?.persistence ?? null;
      if (this.agentManager.getAgent(agentId)) {
        try {
          await this.agentManager.closeAgent(agentId);
        } catch (error) {
          errors.push(error);
        }
      }
      persistence = this.agentManager.getAgent(agentId)?.persistence ?? persistence;
      try {
        await this.agentManager.flush();
        await this.agentManager.deleteAgentState(agentId);
      } catch (error) {
        errors.push(error);
      }
      if (provider === "codex" && persistence) {
        await this.agentManager.archiveNativeSessionBestEffort(provider, persistence);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, `清理 Git AI 临时智能体 ${agentId} 失败`);
    }
  }
}
