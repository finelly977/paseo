import type { PluginComposerPillContribution } from "@getpaseo/plugin";
import type { InstalledPlugin } from "../types";

const CONTRIBUTION_ID = /^[a-z][a-z0-9-]*$/;

export interface RegisteredPluginComposerPill {
  installation: InstalledPlugin;
  contribution: PluginComposerPillContribution;
}

class PluginComposerPillStore {
  private entries: RegisteredPluginComposerPill[] = [];
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly RegisteredPluginComposerPill[] => this.entries;

  add(installation: InstalledPlugin, input: PluginComposerPillContribution): () => void {
    const contribution = validateContribution(input);
    const duplicate = this.entries.some(
      (entry) =>
        entry.installation === installation &&
        entry.contribution.workspaceId === contribution.workspaceId &&
        entry.contribution.agentId === contribution.agentId &&
        entry.contribution.id === contribution.id,
    );
    if (duplicate) {
      throw new Error(`输入框上下文标签重复：${contribution.id}`);
    }
    const entry = { installation, contribution };
    this.entries = [...this.entries, entry];
    this.publish();
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.entries = this.entries.filter((candidate) => candidate !== entry);
      this.publish();
    };
  }

  removeInstallation(installation: InstalledPlugin): void {
    const next = this.entries.filter((entry) => entry.installation !== installation);
    if (next.length === this.entries.length) return;
    this.entries = next;
    this.publish();
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }
}

function validateContribution(
  contribution: PluginComposerPillContribution,
): PluginComposerPillContribution {
  const id = contribution.id.trim();
  const title = contribution.title.trim();
  const workspaceId = contribution.workspaceId.trim();
  const agentId = contribution.agentId.trim();
  if (!CONTRIBUTION_ID.test(id)) throw new Error(`输入框上下文标签标识无效：${contribution.id}`);
  if (!title) throw new Error(`输入框上下文标签 ${id} 缺少标题`);
  if (!workspaceId) throw new Error(`输入框上下文标签 ${id} 缺少工作区`);
  if (!agentId) throw new Error(`输入框上下文标签 ${id} 缺少会话`);
  if (typeof contribution.Component !== "function") {
    throw new Error(`输入框上下文标签 ${id} 没有提供有效组件`);
  }
  if (typeof contribution.onPress !== "function") {
    throw new Error(`输入框上下文标签 ${id} 缺少点击回调`);
  }
  return { ...contribution, id, title, workspaceId, agentId };
}

export const pluginComposerPillStore = new PluginComposerPillStore();
