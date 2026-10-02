import type { StoredAgentRecord } from "../packages/server/src/server/agent/agent-storage.js";

export interface SessionTitleMigration {
  agentId: string;
  provider: string;
  sessionId: string;
  title: string;
  status: "pending" | "conflict";
}

export function planSessionTitleMigration(records: StoredAgentRecord[]): SessionTitleMigration[] {
  const plan: SessionTitleMigration[] = [];
  for (const record of records) {
    if (record.internal || !record.persistence || record.titleSync?.migrated) continue;
    const title = record.titleSync ? record.titleSync.legacyTitle : record.title;
    if (!title?.trim()) continue;
    plan.push({
      agentId: record.id,
      provider: record.provider,
      sessionId: record.persistence.sessionId,
      title: title.trim(),
      status: "pending",
    });
  }
  const titlesBySession = new Map<string, Set<string>>();
  for (const row of plan) {
    const key = JSON.stringify([row.provider, row.sessionId]);
    const titles = titlesBySession.get(key) ?? new Set<string>();
    titles.add(row.title);
    titlesBySession.set(key, titles);
  }
  for (const row of plan) {
    const titles = titlesBySession.get(JSON.stringify([row.provider, row.sessionId]));
    if (titles && titles.size > 1) row.status = "conflict";
  }
  const seen = new Set<string>();
  return plan.filter((row) => {
    if (row.status === "conflict") return true;
    const key = JSON.stringify([row.provider, row.sessionId]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
