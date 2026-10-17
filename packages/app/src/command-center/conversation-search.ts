import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { CommandCenterAgentResult } from "./results";

export interface ConversationSearchSource {
  serverId: string;
  label: string;
  agentIds: string[];
  supported: boolean;
  client: Pick<DaemonClient, "searchConversations"> | null;
}

export interface ConversationSearchMatches {
  snippets: ReadonlyMap<string, string>;
  error: string | null;
}

export async function searchConversationSources(
  sources: readonly ConversationSearchSource[],
  query: string,
): Promise<ConversationSearchMatches> {
  const snippets = new Map<string, string>();
  const errors: string[] = [];
  await Promise.all(
    sources.map(async (source) => {
      if (!source.client) {
        errors.push(`${source.label}：主机未连接，无法搜索会话正文`);
        return;
      }
      // COMPAT(conversationSearch): 2026-10-18 新增，2027-04-18 后随最低主机版本移除门控。
      if (!source.supported) {
        errors.push(`${source.label}：请更新主机后使用会话正文搜索`);
        return;
      }
      try {
        const matches = await source.client.searchConversations(query, source.agentIds);
        for (const match of matches)
          snippets.set(`${source.serverId}:${match.agentId}`, match.snippet);
      } catch (error) {
        console.error(`[会话正文搜索] ${source.label}`, error);
        errors.push(`${source.label}：${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );
  return { snippets, error: errors.length ? errors.join("；") : null };
}

export function mergeConversationMatches(
  titleMatches: readonly CommandCenterAgentResult[],
  rows: readonly CommandCenterAgentResult[],
  snippets: ReadonlyMap<string, string>,
): CommandCenterAgentResult[] {
  const known = new Set(titleMatches.map((row) => row.id));
  const contentMatches = rows.flatMap((row) => {
    const snippet = snippets.get(`${row.agent.serverId}:${row.agent.id}`);
    if (known.has(row.id) || snippet === undefined) return [];
    return [{ ...row, subtitle: `${row.agent.serverLabel} · ${snippet}` }];
  });
  return [...titleMatches, ...contentMatches];
}
