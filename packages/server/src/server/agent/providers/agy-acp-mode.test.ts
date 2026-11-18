import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { describe, expect, test } from "vitest";
import {
  AGY_ALLOW_ALL_MODE_ID,
  transformAgyConfigOptions,
  transformAgySessionResponse,
  writeAgyMode,
} from "./agy-acp-agent.js";

type ModeWriteContext = Parameters<typeof writeAgyMode>[0];

function modeConfig(currentValue: string): SessionConfigOption[] {
  return [
    {
      id: "mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue,
      options: [
        { value: "default", name: "Default" },
        { value: "auto", name: "Auto" },
        { value: "plan", name: "Plan" },
      ],
    },
  ];
}

function createModeAdapter(requestedModeId = AGY_ALLOW_ALL_MODE_ID) {
  const adapter = {
    calls: [] as Array<{ method: string; value: string }>,
    failure: null as Error | null,
    configResultMode: null as string | null,
    waitForWrite: Promise.resolve(),
  };
  const connection: ModeWriteContext["connection"] = {
    async setSessionMode(params) {
      adapter.calls.push({ method: "mode", value: params.modeId });
      await adapter.waitForWrite;
      if (adapter.failure) {
        throw adapter.failure;
      }
      return {};
    },
    async setSessionConfigOption(params) {
      adapter.calls.push({ method: "config", value: params.value });
      await adapter.waitForWrite;
      if (adapter.failure) {
        throw adapter.failure;
      }
      return { configOptions: modeConfig(adapter.configResultMode ?? params.value) };
    },
  };
  const configOptions = modeConfig("default");
  const context: ModeWriteContext = {
    connection,
    sessionId: "agy-session",
    requestedModeId,
    currentModeId: "default",
    configOptions,
    selection: {
      hasAvailableModes: true,
      availableMode: { id: requestedModeId, label: requestedModeId },
      configOption: null,
      configChoice: null,
    },
  };
  return { adapter, context };
}

describe("Antigravity Allow All 会话模式", () => {
  test("使用 Default 承载 Allow All，成功前不启用自动审批", async () => {
    const { adapter, context } = createModeAdapter();
    const pending = Promise.withResolvers<void>();
    adapter.waitForWrite = pending.promise;
    const state = { allowAllActive: false };
    const write = writeAgyMode(context, state);

    expect(state.allowAllActive).toBe(false);
    expect(adapter.calls).toEqual([{ method: "mode", value: "default" }]);
    pending.resolve();
    await expect(write).resolves.toEqual({
      handled: true,
      currentModeId: AGY_ALLOW_ALL_MODE_ID,
      configOptions: transformAgyConfigOptions(modeConfig("default"), {
        allowAllActive: true,
      }),
    });
    expect(state.allowAllActive).toBe(true);
  });

  test("启用失败原样抛出错误，不遗留自动审批", async () => {
    const { adapter, context } = createModeAdapter();
    const failure = new Error("Mode write failed");
    adapter.failure = failure;
    const state = { allowAllActive: false };

    await expect(writeAgyMode(context, state)).rejects.toBe(failure);
    expect(state.allowAllActive).toBe(false);
    expect(transformAgyConfigOptions(modeConfig("default"), state)).toEqual(
      transformAgyConfigOptions(modeConfig("default")),
    );
  });

  test("切回 Default 成功后恢复交互审批，配置不残留 Allow All", async () => {
    const { adapter, context } = createModeAdapter("default");
    context.currentModeId = AGY_ALLOW_ALL_MODE_ID;
    context.configOptions = modeConfig(AGY_ALLOW_ALL_MODE_ID);
    const state = { allowAllActive: true };

    await expect(writeAgyMode(context, state)).resolves.toEqual({
      handled: true,
      currentModeId: "default",
      configOptions: transformAgyConfigOptions(modeConfig("default")),
    });
    expect(state.allowAllActive).toBe(false);
    expect(adapter.calls).toEqual([{ method: "mode", value: "default" }]);
  });

  test("切换原生 Auto 失败仍保留 Allow All，不隐式降级模式", async () => {
    const { adapter, context } = createModeAdapter("auto");
    const failure = new Error("Auto mode needs the OS terminal sandbox");
    adapter.failure = failure;
    context.currentModeId = AGY_ALLOW_ALL_MODE_ID;
    const state = { allowAllActive: true };

    await expect(writeAgyMode(context, state)).rejects.toBe(failure);
    expect(state.allowAllActive).toBe(true);
    expect(adapter.calls).toEqual([{ method: "mode", value: "auto" }]);
  });

  test("支持仅通过 configOptions 切换模式的会话", async () => {
    const { adapter, context } = createModeAdapter();
    context.selection.hasAvailableModes = false;
    context.selection.configOption = {
      id: "mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: "default",
      options: [{ value: "default", name: "Default" }],
    };
    const state = { allowAllActive: false };

    await expect(writeAgyMode(context, state)).resolves.toEqual({
      handled: true,
      currentModeId: AGY_ALLOW_ALL_MODE_ID,
      configOptions: transformAgyConfigOptions(modeConfig("default"), {
        allowAllActive: true,
      }),
    });
    expect(adapter.calls).toEqual([{ method: "config", value: "default" }]);
    expect(state.allowAllActive).toBe(true);

    context.requestedModeId = "default";
    await expect(writeAgyMode(context, state)).resolves.toMatchObject({
      handled: true,
      currentModeId: "default",
    });
    expect(state.allowAllActive).toBe(false);
  });

  test("配置返回未生效时明确报错且不启用自动审批", async () => {
    const { adapter, context } = createModeAdapter();
    context.selection.hasAvailableModes = false;
    context.selection.configOption = {
      id: "mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: "plan",
      options: [{ value: "default", name: "Default" }],
    };
    adapter.configResultMode = "plan";
    const state = { allowAllActive: false };

    await expect(writeAgyMode(context, state)).rejects.toThrow(
      "Antigravity did not apply mode: default",
    );
    expect(state.allowAllActive).toBe(false);
  });

  test("不支持模式写入时明确失败，不凭空启用 Allow All", async () => {
    const { adapter, context } = createModeAdapter();
    context.selection.hasAvailableModes = false;
    const state = { allowAllActive: false };

    await expect(writeAgyMode(context, state)).rejects.toThrow(
      "Antigravity does not expose ACP mode switching",
    );
    expect(adapter.calls).toEqual([]);
    expect(state.allowAllActive).toBe(false);
  });

  test("模型配置更新保留 Allow All，重复转换不改变审批策略", () => {
    const state = { allowAllActive: true };
    const transformed = transformAgyConfigOptions(modeConfig("default"), state);
    expect(transformAgyConfigOptions(transformed, state)).toEqual(transformed);
    expect(state.allowAllActive).toBe(true);
    expect(
      transformAgySessionResponse(
        {
          sessionId: "agy-session",
          modes: {
            currentModeId: "default",
            availableModes: [{ id: "default", name: "Default" }],
          },
        },
        state,
      ).modes,
    ).toEqual({
      currentModeId: AGY_ALLOW_ALL_MODE_ID,
      availableModes: [
        { id: "default", name: "Default" },
        {
          id: AGY_ALLOW_ALL_MODE_ID,
          name: "Allow All",
          description:
            "Automatically approves all Antigravity tool and command permission requests.",
        },
      ],
    });
  });

  test("原生模式通知切到 Plan 后停止自动审批", () => {
    const state = { allowAllActive: true };
    expect(transformAgyConfigOptions(modeConfig("plan"), state)).toEqual(
      transformAgyConfigOptions(modeConfig("plan")),
    );
    expect(state.allowAllActive).toBe(false);
  });

  test("普通原生模式继续走通用 ACP 写入，不强制改写为 Allow All", async () => {
    const { adapter, context } = createModeAdapter("auto");
    const state = { allowAllActive: false };
    await expect(writeAgyMode(context, state)).resolves.toEqual({ handled: false });
    expect(adapter.calls).toEqual([]);
  });
});
