import { describe, expect, test } from "vitest";
import {
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
          model: "gpt-proxy",
          definition: { base_url: "https://proxy.example/v1", wire_api: "responses" },
          env: { PROXY_API_KEY: "secret" },
        },
      ],
    });

    expect(parsed.codexProviderInjections?.[0]).toMatchObject({
      id: "proxy",
      modelProvider: "proxy_api",
      env: { PROXY_API_KEY: "secret" },
    });
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

  test("parses the apply request and response", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.codex_provider_injection.apply.request",
        agentId: "agent-1",
        injectionId: "proxy",
        requestId: "request-1",
      }),
    ).toMatchObject({ injectionId: "proxy" });
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
