import { describe, expect, test } from "vitest";
import {
  CODEX_MODEL_CAPACITY_MESSAGE,
  hasValidCodexAssistantOutput,
  isCodexModelCapacityMessage,
  planCodexCapacityRetry,
} from "./capacity-retry.js";

describe("Codex 模型容量错误恢复", () => {
  test("精确识别容量提示且不把它当作有效答复", () => {
    expect(isCodexModelCapacityMessage(` ${CODEX_MODEL_CAPACITY_MESSAGE}\n`)).toBe(true);
    expect(hasValidCodexAssistantOutput([CODEX_MODEL_CAPACITY_MESSAGE])).toBe(false);
    expect(hasValidCodexAssistantOutput(["已经完成了一部分", CODEX_MODEL_CAPACITY_MESSAGE])).toBe(
      true,
    );
  });

  test("已有有效信息时发送继续，没有有效信息时回退并重发原消息", () => {
    const request = { prompt: "完成任务" };
    expect(
      planCodexCapacityRetry({
        request,
        assistantMessages: ["已完成第一步"],
        hasSubstantiveTimelineOutput: false,
      }),
    ).toEqual({ request: { prompt: "继续" }, rollback: false });
    expect(
      planCodexCapacityRetry({
        request,
        assistantMessages: [CODEX_MODEL_CAPACITY_MESSAGE],
        hasSubstantiveTimelineOutput: false,
      }),
    ).toEqual({ request, rollback: true });
  });

  test("已经执行工具时继续当前任务而不回退重放副作用", () => {
    const request = { prompt: "修改文件" };
    expect(
      planCodexCapacityRetry({
        request,
        assistantMessages: [CODEX_MODEL_CAPACITY_MESSAGE],
        hasSubstantiveTimelineOutput: true,
      }),
    ).toEqual({ request: { prompt: "继续" }, rollback: false });
  });
});
