import { useEffect, useMemo, useReducer, useState } from "react";
import { useShallow } from "zustand/shallow";
import { useSessionStore } from "@/stores/session-store";
import type { CommandCenterAgentResult } from "./results";
import {
  searchConversationSources,
  type ConversationSearchMatches,
  type ConversationSearchSource,
} from "./conversation-search";

interface SearchState extends ConversationSearchMatches {
  key: string;
  loading: boolean;
}
const EMPTY: SearchState = { key: "", snippets: new Map(), error: null, loading: false };

export function useConversationSearch(
  enabled: boolean,
  query: string,
  rows: readonly CommandCenterAgentResult[],
) {
  const clients = useSessionStore(
    useShallow((state) =>
      Object.fromEntries(
        Object.entries(state.sessions).map(([id, session]) => [id, session.client]),
      ),
    ),
  );
  const capabilities = useSessionStore(
    useShallow((state) =>
      Object.fromEntries(
        Object.entries(state.sessions).map(([id, session]) => [
          id,
          session.serverInfo?.features?.conversationSearch === true,
        ]),
      ),
    ),
  );
  const sourcesKey = JSON.stringify(
    rows.map((row) => [row.agent.serverId, row.agent.id, row.agent.serverLabel]),
  );
  const sources = useMemo(() => {
    const grouped = new Map<string, ConversationSearchSource>();
    const entries: string[][] = JSON.parse(sourcesKey);
    for (const [serverId, agentId, label] of entries) {
      const existing = grouped.get(serverId);
      if (existing) existing.agentIds.push(agentId);
      else
        grouped.set(serverId, {
          serverId,
          label,
          agentIds: [agentId],
          supported: capabilities[serverId] === true,
          client: clients[serverId] ?? null,
        });
    }
    return [...grouped.values()];
  }, [clients, capabilities, sourcesKey]);
  const [state, setState] = useState<SearchState>(EMPTY);
  const [retryRevision, retry] = useReducer((n: number) => n + 1, 0);
  const key = enabled && query.trim() ? `${query}\0${sourcesKey}\0${retryRevision}` : "";
  useEffect(() => {
    if (!key) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    setState({ ...EMPTY, key, loading: true });
    const timer = setTimeout(async () => {
      try {
        const result = await searchConversationSources(sources, query);
        if (!cancelled) setState({ ...result, key, loading: false });
      } catch (error) {
        console.error("[会话正文搜索] 请求未完成", error);
        if (!cancelled)
          setState({
            ...EMPTY,
            key,
            error: error instanceof Error ? error.message : String(error),
          });
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, query, sources]);
  return { ...(state.key === key ? state : EMPTY), retry };
}
