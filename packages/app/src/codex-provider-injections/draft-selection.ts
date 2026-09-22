import {
  getCodexProviderInjectionModels,
  type CodexProviderInjection,
} from "@getpaseo/protocol/messages";

export function resolveDraftCodexProviderInjection(input: {
  injections: readonly CodexProviderInjection[];
  injectionId: string;
  model?: string;
}): { injectionId: string; model: string | null } {
  const injection = input.injections.find((entry) => entry.id === input.injectionId);
  if (!injection) {
    throw new Error(`未找到 Codex 服务商注入配置：${input.injectionId}`);
  }

  const models = getCodexProviderInjectionModels(injection);
  if (input.model && !models.includes(input.model)) {
    throw new Error(`模型不属于所选 Codex 服务商注入配置：${input.model}`);
  }

  return {
    injectionId: injection.id,
    model: input.model ?? models[0] ?? null,
  };
}
