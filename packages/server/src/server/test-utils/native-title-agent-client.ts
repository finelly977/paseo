import type {
  AgentClient,
  AgentSession,
  AgentSessionConfig,
  AgentPersistenceHandle,
  ImportableProviderSession,
} from "../agent/agent-sdk-types.js";
import { createTestAgentClient } from "./fake-agent-client.js";
import { wrapSessionProvider } from "../agent/provider-registry.js";

export class NativeTitleAgentClient implements AgentClient {
  readonly provider = "codex";
  private readonly inner = createTestAgentClient("codex");
  readonly capabilities = { ...this.inner.capabilities, supportsSessionRename: true };
  readonly native = new Map<string, { title: string; cwd: string }>();
  failRename = false;
  listCount = 0;

  private wrap(session: AgentSession, cwd: string): AgentSession {
    if (!session.id) throw new Error("测试会话缺少原生标识");
    const id = session.id;
    if (!this.native.has(id)) this.native.set(id, { title: "原生旧名", cwd });
    return {
      ...wrapSessionProvider("codex", session),
      capabilities: this.capabilities,
      getSessionTitle: async () => this.getNativeSessionTitle({ provider: "codex", sessionId: id }),
      renameSessionTitle: async (title) => {
        if (this.failRename) throw new Error("原生改名失败");
        this.native.set(id, { title, cwd });
      },
    };
  }
  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    return this.wrap(await this.inner.createSession(config), config.cwd);
  }
  async resumeSession(
    handle: AgentPersistenceHandle,
    config?: Partial<AgentSessionConfig>,
  ): Promise<AgentSession> {
    if (!config?.cwd) throw new Error("测试恢复缺少工作目录");
    return this.wrap(await this.inner.resumeSession(handle, config), config.cwd);
  }
  async getNativeSessionTitle(handle: AgentPersistenceHandle): Promise<string | null> {
    const entry = this.native.get(handle.sessionId);
    if (!entry) throw new Error("原生会话不存在");
    return entry.title;
  }
  async listImportableSessions(): Promise<ImportableProviderSession[]> {
    this.listCount += 1;
    return Array.from(this.native, ([providerHandleId, value]) => ({
      providerHandleId,
      cwd: value.cwd,
      title: value.title,
      firstPromptPreview: null,
      lastPromptPreview: null,
      lastActivityAt: new Date(0),
    }));
  }
  fetchCatalog: AgentClient["fetchCatalog"] = (options) => this.inner.fetchCatalog(options);
  isAvailable: AgentClient["isAvailable"] = () => this.inner.isAvailable();
}
