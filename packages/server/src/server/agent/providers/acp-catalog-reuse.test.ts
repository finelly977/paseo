import { describe, expect, test } from "vitest";
import { ACPAgentClient, ACPAgentSession, type ACPAgentSessionOptions } from "./acp-agent.js";
import type {
  AgentSessionConfig,
  ProviderCatalog,
  FetchCatalogOptions,
} from "../agent-sdk-types.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";

const catalog: ProviderCatalog = {
  models: [{ id: "test-model", provider: "acp", label: "Test" }],
  modes: [],
};

describe("ACP 恢复模型目录复用", () => {
  test("Grok 类型的恢复进行中请求目录不额外启动探测或改写历史", async () => {
    const initialized = Promise.withResolvers<void>();
    let initializations = 0;
    class Session extends ACPAgentSession {
      override async initializeResumedSession(): Promise<void> {
        initializations++;
        await initialized.promise;
      }
      override getCatalog(): ProviderCatalog {
        return catalog;
      }
    }
    class Client extends ACPAgentClient {
      protected override createSessionInstance(
        config: AgentSessionConfig,
        options: ACPAgentSessionOptions,
      ): ACPAgentSession {
        return new Session(config, options);
      }
      protected override async spawnProcess(): Promise<never> {
        throw new Error("不应额外启动模型探测进程");
      }
    }
    const client = new Client({
      provider: "acp",
      logger: createTestLogger(),
      defaultCommand: ["grok", "agent", "stdio"],
    });
    const resumed = client.resumeSession(
      { provider: "acp", sessionId: "old", metadata: { cwd: "/workspace" } },
      undefined,
      { env: { PASEO_AGENT_ID: "agent-1", PASEO_AGENT_CWD: "/workspace" } },
    );
    const models = client.fetchCatalog({ scope: "workspace", cwd: "/workspace", force: false });
    initialized.resolve();
    await resumed;
    expect(await models).toEqual(catalog);
    expect(
      await client.fetchCatalog({ scope: "workspace", cwd: "/workspace", force: false }),
    ).toEqual(catalog);
    expect(initializations).toBe(1);
    await expect(
      client.fetchCatalog({ scope: "workspace", cwd: "/workspace", force: true }),
    ).rejects.toThrow("不应额外启动");
  });
});

class CatalogSession extends ACPAgentSession {
  failure: Error | null = null;
  catalog: ProviderCatalog | null = catalog;
  override async initializeResumedSession(): Promise<void> {
    if (this.failure) throw this.failure;
  }
  override getCatalog(): ProviderCatalog | null {
    return this.catalog;
  }
}
class CatalogClient extends ACPAgentClient {
  readonly probes: FetchCatalogOptions[] = [];
  readonly sessions: CatalogSession[] = [];
  nextFailure: Error | null = null;
  nextCatalog: ProviderCatalog | null = catalog;
  constructor() {
    super({
      provider: "acp",
      logger: createTestLogger(),
      defaultCommand: ["grok", "agent", "stdio"],
    });
  }
  protected override createSessionInstance(
    config: AgentSessionConfig,
    options: ACPAgentSessionOptions,
  ): ACPAgentSession {
    const session = new CatalogSession(config, options);
    session.failure = this.nextFailure;
    session.catalog = this.nextCatalog;
    this.sessions.push(session);
    return session;
  }
  protected override async probeCatalog(options: FetchCatalogOptions): Promise<ProviderCatalog> {
    this.probes.push(options);
    return catalog;
  }
}
const handle = { provider: "acp", sessionId: "old", metadata: { cwd: "/workspace" } };
const options: FetchCatalogOptions = { scope: "workspace", cwd: "/workspace", force: false };

test("恢复未返回模型目录时仍执行实际目录探测", async () => {
  const client = new CatalogClient();
  client.nextCatalog = null;
  await client.resumeSession(handle);
  expect(await client.fetchCatalog(options)).toEqual(catalog);
  expect(client.probes).toEqual([options]);
});

test("不同目录和自定义环境不串用恢复模型目录", async () => {
  const client = new CatalogClient();
  await client.resumeSession(handle, undefined, { env: { API_KEY: "different-environment" } });
  await client.fetchCatalog(options);
  await client.resumeSession(handle);
  const other: FetchCatalogOptions = { ...options, cwd: "/other" };
  await client.fetchCatalog(other);
  expect(client.probes).toEqual([options, other]);
});

test("恢复失败不会缓存被拒绝的目录请求，成功重试无需额外探测", async () => {
  const client = new CatalogClient();
  client.nextFailure = new Error("load failed");
  await expect(client.resumeSession(handle)).rejects.toThrow("load failed");
  await client.fetchCatalog(options);
  client.nextFailure = null;
  await client.resumeSession(handle);
  await client.fetchCatalog(options);
  expect(client.probes).toEqual([options]);
});
