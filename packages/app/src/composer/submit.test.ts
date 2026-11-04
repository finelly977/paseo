import { describe, expect, it, vi } from "vitest";
import { submitAgentInput, type AgentInputSubmitActionInput } from "./submit";

function createSubmissionInput(): AgentInputSubmitActionInput<{ id: string }> {
  return {
    submission: { status: "idle" },
    message: "创建会话",
    attachments: [{ id: "image-1" }],
    submitBehavior: "preserve-and-lock",
    isAgentRunning: false,
    canSubmit: true,
    queueMessage: vi.fn(),
    submitMessage: vi.fn(async () => {}),
    clearDraft: vi.fn(),
    setUserInput: vi.fn(),
    setAttachments: vi.fn(),
    setSendError: vi.fn(),
    setIsProcessing: vi.fn(),
  };
}

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

describe("submitAgentInput", () => {
  it("只执行一次同一帧内重复触发的新会话提交", async () => {
    const deferred = createDeferredPromise<void>();
    const submitMessage = vi.fn(() => deferred.promise);
    const input = {
      message: "创建一个会话",
      attachments: [],
      submission: { status: "idle" as "idle" | "submitting" | "submitted" },
      submitBehavior: "preserve-and-lock" as const,
      isAgentRunning: false,
      canSubmit: true,
      queueMessage: vi.fn(),
      submitMessage,
      clearDraft: vi.fn(),
      setUserInput: vi.fn(),
      setAttachments: vi.fn(),
      setSendError: vi.fn(),
      setIsProcessing: vi.fn(),
    };

    const first = submitAgentInput(input);
    const duplicate = submitAgentInput(input);
    const requestsWhilePending = submitMessage.mock.calls.length;
    deferred.resolve();

    expect(await Promise.all([first, duplicate])).toEqual(["submitted", "noop"]);
    expect(requestsWhilePending).toBe(1);
    expect(input.clearDraft).toHaveBeenCalledTimes(1);
    expect(input.setSendError).toHaveBeenCalledTimes(1);
  });

  it("创建成功到切换页面之间再次发送也不会创建第二个会话", async () => {
    const input = createSubmissionInput();

    expect(await submitAgentInput(input)).toBe("submitted");
    expect(await submitAgentInput(input)).toBe("noop");
    expect(input.submitMessage).toHaveBeenCalledTimes(1);
    expect(input.submission.status).toBe("submitted");
  });

  it("创建失败后保留草稿和错误提示，允许原地重试一次", async () => {
    const input = createSubmissionInput();
    input.submitMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("主机连接失败"))
      .mockResolvedValueOnce(undefined);

    expect(await submitAgentInput(input)).toBe("failed");
    expect(input.submission.status).toBe("idle");
    expect(input.setSendError).toHaveBeenLastCalledWith("主机连接失败");
    expect(input.setUserInput).not.toHaveBeenCalled();
    expect(input.setAttachments).not.toHaveBeenCalled();
    expect(input.clearDraft).not.toHaveBeenCalled();

    expect(await submitAgentInput(input)).toBe("submitted");
    expect(input.submitMessage).toHaveBeenCalledTimes(2);
    expect(input.clearDraft).toHaveBeenCalledTimes(1);
  });

  it("服务端已接收但本地清草稿失败时不重新发送创建请求", async () => {
    const input = createSubmissionInput();
    input.clearDraft = () => {
      throw new Error("本地草稿写入失败");
    };

    expect(await submitAgentInput(input)).toBe("failed");
    expect(await submitAgentInput(input)).toBe("noop");
    expect(input.submitMessage).toHaveBeenCalledTimes(1);
    expect(input.setSendError).toHaveBeenLastCalledWith("本地草稿写入失败");
  });

  it("已有会话发送完成后仍可继续发送下一条消息", async () => {
    const input = createSubmissionInput();
    input.submitBehavior = "clear";

    expect(await submitAgentInput(input)).toBe("submitted");
    input.message = "下一条消息";
    expect(await submitAgentInput(input)).toBe("submitted");
    expect(input.submitMessage).toHaveBeenCalledTimes(2);
    expect(input.submitMessage).toHaveBeenLastCalledWith({
      message: "下一条消息",
      attachments: [{ id: "image-1" }],
    });
  });

  it("clears the composer before an in-flight submit resolves", async () => {
    const deferred = createDeferredPromise<void>();
    const queueMessage = vi.fn();
    const submitMessage = vi.fn(async () => {
      await deferred.promise;
    });
    const clearDraft = vi.fn();
    const setUserInput = vi.fn();
    const setAttachments = vi.fn();
    const setSendError = vi.fn();
    const setIsProcessing = vi.fn();

    const submitPromise = submitAgentInput({
      submission: { status: "idle" },
      message: "  hello world  ",
      attachments: [],
      isAgentRunning: false,
      canSubmit: true,
      queueMessage,
      submitMessage,
      clearDraft,
      setUserInput,
      setAttachments,
      setSendError,
      setIsProcessing,
    });

    expect(queueMessage).not.toHaveBeenCalled();
    expect(submitMessage).toHaveBeenCalledWith({
      message: "hello world",
      attachments: [],
    });
    expect(setUserInput).toHaveBeenCalledWith("");
    expect(setAttachments).toHaveBeenCalledWith([]);
    expect(setSendError).toHaveBeenCalledWith(null);
    expect(setIsProcessing).toHaveBeenCalledWith(true);
    expect(clearDraft).not.toHaveBeenCalled();

    deferred.resolve();

    await expect(submitPromise).resolves.toBe("submitted");
    expect(setUserInput).toHaveBeenCalledTimes(2);
    expect(setUserInput).toHaveBeenNthCalledWith(2, "");
    expect(setAttachments).toHaveBeenCalledTimes(2);
    expect(setAttachments).toHaveBeenNthCalledWith(2, []);
    expect(clearDraft).toHaveBeenCalledWith("sent");
  });

  it("preserves the composer before an in-flight submit resolves when requested", async () => {
    const deferred = createDeferredPromise<void>();
    const attachments = [{ id: "img-1" }];
    const queueMessage = vi.fn();
    const submitMessage = vi.fn(async () => {
      await deferred.promise;
    });
    const clearDraft = vi.fn();
    const setUserInput = vi.fn();
    const setAttachments = vi.fn();
    const setSendError = vi.fn();
    const setIsProcessing = vi.fn();

    const submitPromise = submitAgentInput({
      submission: { status: "idle" },
      message: "  keep me  ",
      attachments,
      submitBehavior: "preserve-and-lock",
      isAgentRunning: false,
      canSubmit: true,
      queueMessage,
      submitMessage,
      clearDraft,
      setUserInput,
      setAttachments,
      setSendError,
      setIsProcessing,
    });

    expect(queueMessage).not.toHaveBeenCalled();
    expect(submitMessage).toHaveBeenCalledWith({
      message: "keep me",
      attachments,
    });
    expect(setUserInput).not.toHaveBeenCalled();
    expect(setAttachments).not.toHaveBeenCalled();
    expect(setSendError).toHaveBeenCalledWith(null);
    expect(setIsProcessing).toHaveBeenCalledWith(true);
    expect(clearDraft).not.toHaveBeenCalled();

    deferred.resolve();

    await expect(submitPromise).resolves.toBe("submitted");
    expect(clearDraft).toHaveBeenCalledWith("sent");
  });

  it("queues while the agent is running and clears the composer immediately", async () => {
    const queueMessage = vi.fn();
    const submitMessage = vi.fn();
    const clearDraft = vi.fn();
    const setUserInput = vi.fn();
    const setAttachments = vi.fn();
    const setSendError = vi.fn();
    const setIsProcessing = vi.fn();

    await expect(
      submitAgentInput({
        submission: { status: "idle" },
        message: "  queued message  ",
        attachments: [{ id: "img-1" }],
        isAgentRunning: true,
        canSubmit: true,
        queueMessage,
        submitMessage,
        clearDraft,
        setUserInput,
        setAttachments,
        setSendError,
        setIsProcessing,
      }),
    ).resolves.toBe("queued");

    expect(queueMessage).toHaveBeenCalledWith({
      message: "queued message",
      attachments: [{ id: "img-1" }],
    });
    expect(submitMessage).not.toHaveBeenCalled();
    expect(setUserInput).toHaveBeenCalledWith("");
    expect(setAttachments).toHaveBeenCalledWith([]);
    expect(setSendError).not.toHaveBeenCalled();
    expect(setIsProcessing).not.toHaveBeenCalled();
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it("restores the composer when submit fails", async () => {
    const submitError = new Error("No host selected");
    const queueMessage = vi.fn();
    const submitMessage = vi.fn(async () => {
      throw submitError;
    });
    const clearDraft = vi.fn();
    const setUserInput = vi.fn();
    const setAttachments = vi.fn();
    const setSendError = vi.fn();
    const setIsProcessing = vi.fn();
    const onSubmitError = vi.fn();
    const attachments = [{ id: "img-1" }];

    await expect(
      submitAgentInput({
        submission: { status: "idle" },
        message: "  hello world  ",
        attachments,
        isAgentRunning: false,
        canSubmit: true,
        queueMessage,
        submitMessage,
        clearDraft,
        setUserInput,
        setAttachments,
        setSendError,
        setIsProcessing,
        onSubmitError,
      }),
    ).resolves.toBe("failed");

    expect(onSubmitError).toHaveBeenCalledWith(submitError);
    expect(setUserInput).toHaveBeenNthCalledWith(1, "");
    expect(setUserInput).toHaveBeenNthCalledWith(2, "hello world");
    expect(setAttachments).toHaveBeenNthCalledWith(1, []);
    expect(setAttachments).toHaveBeenNthCalledWith(2, attachments);
    expect(setSendError).toHaveBeenNthCalledWith(1, null);
    expect(setSendError).toHaveBeenNthCalledWith(2, "No host selected");
    expect(setIsProcessing).toHaveBeenNthCalledWith(1, true);
    expect(setIsProcessing).toHaveBeenNthCalledWith(2, false);
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it("restores a steered active-turn draft after an ambiguous immediate-send error", async () => {
    const error = new Error("connection lost after delivery");
    const setUserInput = vi.fn();
    const setAttachments = vi.fn();
    const setSendError = vi.fn();
    const setIsProcessing = vi.fn();

    await expect(
      submitAgentInput({
        submission: { status: "idle" },
        message: "  steer this turn  ",
        attachments: [{ id: "img-1" }],
        forceSend: true,
        isAgentRunning: true,
        canSubmit: true,
        queueMessage: vi.fn(),
        submitMessage: async () => {
          throw error;
        },
        clearDraft: vi.fn(),
        setUserInput,
        setAttachments,
        setSendError,
        setIsProcessing,
      }),
    ).resolves.toBe("failed");

    expect(setUserInput).toHaveBeenNthCalledWith(1, "");
    expect(setUserInput).toHaveBeenNthCalledWith(2, "steer this turn");
    expect(setAttachments).toHaveBeenNthCalledWith(1, []);
    expect(setAttachments).toHaveBeenNthCalledWith(2, [{ id: "img-1" }]);
    expect(setSendError).toHaveBeenLastCalledWith("connection lost after delivery");
  });

  it("submits when empty submit is explicitly allowed", async () => {
    const queueMessage = vi.fn();
    const submitMessage = vi.fn(async () => {});
    const clearDraft = vi.fn();
    const setUserInput = vi.fn();
    const setAttachments = vi.fn();
    const setSendError = vi.fn();
    const setIsProcessing = vi.fn();

    await expect(
      submitAgentInput({
        submission: { status: "idle" },
        message: "   ",
        attachments: [],
        allowEmptySubmit: true,
        isAgentRunning: false,
        canSubmit: true,
        queueMessage,
        submitMessage,
        clearDraft,
        setUserInput,
        setAttachments,
        setSendError,
        setIsProcessing,
      }),
    ).resolves.toBe("submitted");

    expect(queueMessage).not.toHaveBeenCalled();
    expect(submitMessage).toHaveBeenCalledWith({
      message: "",
      attachments: [],
    });
    expect(clearDraft).toHaveBeenCalledWith("sent");
  });
});
