import type { AgentStorage, StoredAgentRecord } from "./agent-storage.js";

interface SessionTitlesDependencies {
  storage: AgentStorage;
  canRename(provider: string): boolean;
  renameNative(record: StoredAgentRecord, title: string): Promise<void>;
  readNative?(record: StoredAgentRecord): Promise<string | null>;
  changed(record: StoredAgentRecord): Promise<void>;
}

function sessionTitleKey(record: StoredAgentRecord): string {
  return record.persistence
    ? JSON.stringify([record.provider, record.persistence.sessionId])
    : record.id;
}

export class SessionTitles {
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: SessionTitlesDependencies) {}

  private async serial<T>(agentId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(agentId);
    // 上一次操作的调用者接收原始错误；失败不能永久阻断后续重试。
    const ready = previous
      ? previous.then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
    const next = ready.then(operation);
    this.pending.set(agentId, next);
    try {
      return await next;
    } finally {
      if (this.pending.get(agentId) === next) this.pending.delete(agentId);
    }
  }

  async rename(input: {
    agentId: string;
    title: string;
    nativeOnly?: boolean;
    expectedNativeTitle?: string | null;
    expectedSessionId?: string;
  }): Promise<void> {
    const { agentId, title, nativeOnly, expectedNativeTitle, expectedSessionId } = input;
    const scheduled = await this.deps.storage.get(agentId);
    if (!scheduled) throw new Error("会话不存在。");
    return this.serial(sessionTitleKey(scheduled), async () => {
      const normalized = title.trim();
      if (!normalized) throw new Error("会话名称不能为空。");
      const record = await this.deps.storage.get(agentId);
      if (!record) throw new Error("会话不存在。");
      if (sessionTitleKey(record) !== sessionTitleKey(scheduled))
        throw new Error("原生会话身份已变化，请重新操作。");
      if (expectedSessionId !== undefined && record.persistence?.sessionId !== expectedSessionId)
        throw new Error("原生会话身份已变化，拒绝迁移。");
      const native = this.deps.canRename(record.provider);
      if (nativeOnly && !native) throw new Error("该智能体暂不支持原生改名，未修改本地别名。");
      if (native) {
        if (!record.persistence) throw new Error("原生会话尚未建立，请先开始对话后再改名。");
        if (expectedNativeTitle !== undefined) {
          if (!this.deps.readNative) throw new Error("无法验证迁移前的原生名称。");
          const actual = await this.deps.readNative(record);
          if (actual !== expectedNativeTitle)
            throw new Error("原生名称已变化，请重新预览迁移，未覆盖新名称。");
        }
        await this.deps.renameNative(record, normalized);
      }
      const records = native
        ? (await this.deps.storage.list()).filter(
            (candidate) =>
              !candidate.internal &&
              candidate.provider === record.provider &&
              candidate.persistence?.sessionId === record.persistence?.sessionId,
          )
        : [record];
      for (const target of records) {
        const updated = await this.deps.storage.saveSessionTitle({
          agentId: target.id,
          title: normalized,
          source: native ? "native" : "local",
          migrated: native,
        });
        await this.deps.changed(updated);
      }
    });
  }

  synchronize(snapshot: StoredAgentRecord, title: string | null): Promise<void> {
    return this.serial(sessionTitleKey(snapshot), async () => {
      if (title === null || title.trim().length === 0) return;
      const current = await this.deps.storage.get(snapshot.id);
      if (!current || current.internal) return;
      if (sessionTitleKey(current) !== sessionTitleKey(snapshot)) return;
      // 列表读取期间可能已在 Paseo 改名，旧读取不得覆盖新写入。
      if (current.title !== snapshot.title || current.titleSync !== snapshot.titleSync) return;
      const native = this.deps.canRename(current.provider);
      const hasLocalAlias =
        current.titleSync?.source === "local" || (!current.titleSync && !!current.title);
      if (!native && hasLocalAlias) return;
      if (current.title === title && current.titleSync) return;
      const updated = await this.deps.storage.saveSessionTitle({
        agentId: current.id,
        title,
        source: "native",
        migrated: current.titleSync?.migrated ?? false,
      });
      await this.deps.changed(updated);
    });
  }
}
