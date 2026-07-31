import type { AgentRunOptions } from "../../agent-sdk-types.js";

export const CODEX_MODEL_CAPACITY_MESSAGE =
  "Selected model is at capacity. Please try a different model.";

export function isCodexModelCapacityMessage(message: string | null | undefined): boolean {
  return message?.trim() === CODEX_MODEL_CAPACITY_MESSAGE;
}

export function hasValidCodexAssistantOutput(messages: Iterable<string>): boolean {
  for (const message of messages) {
    if (message.trim().length > 0 && !isCodexModelCapacityMessage(message)) {
      return true;
    }
  }
  return false;
}

export interface CodexCapacityRetryRequest<TPrompt = string> {
  prompt: TPrompt;
  options?: AgentRunOptions;
}

export function planCodexCapacityRetry<TPrompt>(input: {
  request: CodexCapacityRetryRequest<TPrompt>;
  assistantMessages: Iterable<string>;
  hasSubstantiveTimelineOutput: boolean;
}): { request: CodexCapacityRetryRequest<TPrompt | string>; rollback: boolean } {
  if (input.hasSubstantiveTimelineOutput || hasValidCodexAssistantOutput(input.assistantMessages)) {
    return {
      request: {
        prompt: "继续",
        ...(input.request.options ? { options: input.request.options } : {}),
      },
      rollback: false,
    };
  }
  return { request: input.request, rollback: true };
}
