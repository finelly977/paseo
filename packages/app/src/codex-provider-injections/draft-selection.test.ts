import { describe, expect, it } from "vitest";
import { resolveDraftCodexProviderInjection } from "./draft-selection";

const injections = [
  {
    id: "proxy",
    name: "Proxy",
    modelProvider: "proxy-provider",
    models: ["proxy-a", "proxy-b"],
    definition: { name: "Proxy", base_url: "https://example.invalid" },
  },
];

describe("resolveDraftCodexProviderInjection", () => {
  it("新建会话选择服务商时默认使用该配置的第一个模型", () => {
    expect(
      resolveDraftCodexProviderInjection({
        injections,
        injectionId: "proxy",
      }),
    ).toEqual({ injectionId: "proxy", model: "proxy-a" });
  });

  it("新建会话可以指定注入服务商中的具体模型", () => {
    expect(
      resolveDraftCodexProviderInjection({
        injections,
        injectionId: "proxy",
        model: "proxy-b",
      }),
    ).toEqual({ injectionId: "proxy", model: "proxy-b" });
  });

  it("拒绝不属于所选服务商的模型", () => {
    expect(() =>
      resolveDraftCodexProviderInjection({
        injections,
        injectionId: "proxy",
        model: "foreign-model",
      }),
    ).toThrow("模型不属于所选 Codex 服务商注入配置");
  });
});
