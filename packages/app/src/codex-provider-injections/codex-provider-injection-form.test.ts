import { describe, expect, it } from "vitest";
import {
  buildCodexProviderDefinition,
  buildEnvironmentVariables,
  openCodexProviderInjectionForm,
  parseCodexProviderDefinition,
} from "./codex-provider-injection-form";

describe("Codex 服务商结构化表单", () => {
  it("编辑已保存的服务商时用完整配置初始化表单", () => {
    expect(
      openCodexProviderInjectionForm({
        id: "gateway",
        name: "内部中转",
        modelProvider: "internal_gateway",
        models: ["gpt-5.4", "gpt-5.4-mini"],
        definition: {
          name: "Gateway",
          base_url: "https://gateway.example/v1",
          wire_api: "responses",
          env_key: "GATEWAY_KEY",
          requires_openai_auth: false,
          supports_websockets: true,
          request_max_retries: 3,
        },
        env: {
          GATEWAY_KEY: "secret",
          HTTPS_PROXY: "http://proxy.example:7890",
        },
      }),
    ).toEqual({
      draft: {
        name: "内部中转",
        modelProvider: "internal_gateway",
        models: ["gpt-5.4", "gpt-5.4-mini"],
        providerName: "Gateway",
        baseUrl: "https://gateway.example/v1",
        envKey: "GATEWAY_KEY",
        requiresOpenAiAuth: "disabled",
        supportsWebsockets: "enabled",
        environmentVariables: [
          { key: "GATEWAY_KEY", value: "secret" },
          { key: "HTTPS_PROXY", value: "http://proxy.example:7890" },
        ],
        additionalDefinition: '{\n  "request_max_retries": 3\n}',
        advancedOpen: true,
      },
      error: null,
    });
  });

  it("拆分常用字段并保留额外参数", () => {
    expect(
      parseCodexProviderDefinition({
        name: "Gateway",
        base_url: "https://gateway.example/v1",
        wire_api: "responses",
        env_key: "GATEWAY_KEY",
        requires_openai_auth: false,
        supports_websockets: true,
        request_max_retries: 3,
      }),
    ).toEqual({
      providerName: "Gateway",
      baseUrl: "https://gateway.example/v1",
      envKey: "GATEWAY_KEY",
      requiresOpenAiAuth: "disabled",
      supportsWebsockets: "enabled",
      additionalDefinition: { request_max_retries: 3 },
    });
  });

  it("生成 Codex model_providers 定义并使用显示名称兜底", () => {
    expect(
      buildCodexProviderDefinition({
        displayName: "内部中转",
        providerName: "",
        baseUrl: " https://gateway.example/v1 ",
        envKey: " GATEWAY_KEY ",
        requiresOpenAiAuth: "disabled",
        supportsWebsockets: "default",
        additionalDefinition: { request_max_retries: 3 },
      }),
    ).toEqual({
      request_max_retries: 3,
      name: "内部中转",
      base_url: "https://gateway.example/v1",
      wire_api: "responses",
      env_key: "GATEWAY_KEY",
      requires_openai_auth: false,
    });
  });

  it("拒绝在额外参数中重复结构化字段", () => {
    expect(() =>
      buildCodexProviderDefinition({
        displayName: "Gateway",
        providerName: "Gateway",
        baseUrl: "",
        envKey: "",
        requiresOpenAiAuth: "default",
        supportsWebsockets: "default",
        additionalDefinition: { base_url: "https://duplicate.example/v1" },
      }),
    ).toThrow("不要重复填写 base_url");
  });

  it("生成运行时环境变量并拒绝不完整或重复的行", () => {
    expect(
      buildEnvironmentVariables([
        { key: "GATEWAY_KEY", value: "secret" },
        { key: "", value: "" },
      ]),
    ).toEqual({ GATEWAY_KEY: "secret" });
    expect(() => buildEnvironmentVariables([{ key: "GATEWAY_KEY", value: "" }])).toThrow(
      "必须同时填写",
    );
    expect(() =>
      buildEnvironmentVariables([
        { key: "GATEWAY_KEY", value: "one" },
        { key: " GATEWAY_KEY ", value: "two" },
      ]),
    ).toThrow("不能重复");
  });
});
