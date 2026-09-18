import { describe, expect, test } from "vitest";
import {
  getCodexProviderInjectionModels,
  MutableDaemonConfigSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

const BASE_CONFIG = {
  mcp: { injectIntoAgents: false },
  browserTools: { enabled: false },
  providers: {},
  metadataGeneration: { providers: [] },
};

describe("Codex provider injection protocol", () => {
  test("parses an ordered daemon provider injection list", () => {
    const parsed = MutableDaemonConfigSchema.parse({
      ...BASE_CONFIG,
      codexProviderInjections: [
        {
          id: "proxy",
          name: "Proxy",
          modelProvider: "proxy_api",
          models: ["gpt-proxy", "gpt-proxy-fast"],
          definition: { base_url: "https://proxy.example/v1", wire_api: "responses" },
          env: { PROXY_API_KEY: "secret" },
        },
      ],
    });

    expect(parsed.codexProviderInjections?.[0]).toMatchObject({
      id: "proxy",
      modelProvider: "proxy_api",
      models: ["gpt-proxy", "gpt-proxy-fast"],
      env: { PROXY_API_KEY: "secret" },
    });
  });

  test("keeps reading legacy single-model entries", () => {
    const injection = MutableDaemonConfigSchema.parse({
      ...BASE_CONFIG,
      codexProviderInjections: [
        {
          id: "legacy",
          name: "Legacy",
          modelProvider: "legacy_api",
          model: "gpt-legacy",
          definition: { base_url: "https://legacy.example/v1" },
        },
      ],
    }).codexProviderInjections?.[0];

    if (!injection) throw new Error("legacy injection was not parsed");
    expect(getCodexProviderInjectionModels(injection)).toEqual(["gpt-legacy"]);
  });

  test("allows separate entries to reuse the same model_provider id", () => {
    const parsed = MutableDaemonConfigSchema.parse({
      ...BASE_CONFIG,
      codexProviderInjections: [
        { id: "one", name: "One", modelProvider: "same", definition: { name: "One" } },
        { id: "two", name: "Two", modelProvider: "same", definition: { name: "Two" } },
      ],
    });

    expect(parsed.codexProviderInjections).toHaveLength(2);
  });

  test("rejects duplicate entry ids and nested model_provider fields", () => {
    expect(() =>
      MutableDaemonConfigSchema.parse({
        ...BASE_CONFIG,
        codexProviderInjections: [
          {
            id: "duplicate",
            name: "One",
            modelProvider: "one",
            definition: { name: "One", model_provider: "one" },
          },
          { id: "duplicate", name: "Two", modelProvider: "two", definition: { name: "Two" } },
        ],
      }),
    ).toThrow();
  });

  test("rejects duplicate models inside one provider", () => {
    expect(() =>
      MutableDaemonConfigSchema.parse({
        ...BASE_CONFIG,
        codexProviderInjections: [
          {
            id: "duplicate-models",
            name: "Duplicate models",
            modelProvider: "proxy",
            models: ["gpt-proxy", "gpt-proxy"],
            definition: { base_url: "https://proxy.example/v1" },
          },
        ],
      }),
    ).toThrow();
  });

  test("parses the apply request and response", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.codex_provider_injection.apply.request",
        agentId: "agent-1",
        injectionId: "proxy",
        model: "gpt-proxy-fast",
        requestId: "request-1",
      }),
    ).toMatchObject({ injectionId: "proxy", model: "gpt-proxy-fast" });
    expect(
      SessionOutboundMessageSchema.parse({
        type: "agent.codex_provider_injection.apply.response",
        payload: {
          agentId: "agent-1",
          injectionId: "proxy",
          requestId: "request-1",
          action: "reloaded",
        },
      }),
    ).toMatchObject({ payload: { action: "reloaded" } });
  });
});
