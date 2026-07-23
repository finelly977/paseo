import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { pickAttentionAgent } from "@/utils/agent-attention";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import {
  buildHostWorkspaceOpenRoute,
  buildHostWorkspaceRoute,
  decodeWorkspaceIdFromPathSegment,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";
import {
  normalizeWorkspaceOpaqueId,
  resolveWorkspaceMapKeyByIdentity,
} from "@/utils/workspace-identity";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { prepareWorkspaceTab, type PrepareWorkspaceTabDeps } from "@/utils/prepare-workspace-tab";

export interface RouteSelectionInput {
  pathname: string;
  params: {
    serverId?: string | string[];
    workspaceId?: string | string[];
  };
}

export interface NavigateToWorkspaceInput {
  serverId: string;
  workspaceId: string;
  target?: WorkspaceTabTarget;
  pin?: boolean;
}

export interface NavigateToWorkspaceDeps extends PrepareWorkspaceTabDeps {
  getSessionWorkspaces: (serverId: string) => Map<string, WorkspaceDescriptor> | null | undefined;
  getSessionAgents: (serverId: string) => Iterable<Agent>;
  getOpenWorkspaceTabTargets: (workspaceKey: string) => readonly WorkspaceTabTarget[];
  rememberLastWorkspace: (selection: ActiveWorkspaceSelection) => void;
  navigateToRoute: (route: string) => void;
}

export interface NavigateToLastWorkspaceDeps extends NavigateToWorkspaceDeps {
  getLastWorkspaceSelection: () => ActiveWorkspaceSelection | null;
}

function getParamValue(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const firstValue = value[0];
    return typeof firstValue === "string" ? firstValue.trim() : "";
  }
  return "";
}

function parseWorkspaceSelectionFromRouteParams(params: {
  serverId?: string | string[];
  workspaceId?: string | string[];
}): ActiveWorkspaceSelection | null {
  const serverId = getParamValue(params.serverId);
  const workspaceValue = getParamValue(params.workspaceId);
  const workspaceId = workspaceValue ? decodeWorkspaceIdFromPathSegment(workspaceValue) : null;
  if (!serverId || !workspaceId) {
    return null;
  }
  return { serverId, workspaceId };
}

function pickMostRecentWorkspaceAgentId(input: {
  workspaceAgents: Agent[];
  allAgents: Agent[];
}): string | null {
  const agentsById = new Map(input.allAgents.map((agent) => [agent.id, agent]));
  const candidates = input.workspaceAgents
    .filter((agent) => !agent.archivedAt)
    .filter((agent) => {
      const parent = agent.parentAgentId ? agentsById.get(agent.parentAgentId) : undefined;
      return isWorkspaceRootAgent(agent, parent);
    })
    .sort((left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime());
  return candidates[0]?.id ?? null;
}

export function parseActiveWorkspaceSelection(
  input: RouteSelectionInput,
): ActiveWorkspaceSelection | null {
  const routeSelection = parseHostWorkspaceRouteFromPathname(input.pathname);
  if (routeSelection) {
    return routeSelection;
  }

  if (input.pathname !== "/" && input.pathname !== "") {
    return null;
  }

  return parseWorkspaceSelectionFromRouteParams(input.params);
}

export function navigateToWorkspace(
  input: NavigateToWorkspaceInput,
  deps: NavigateToWorkspaceDeps,
): string {
  const workspaces = deps.getSessionWorkspaces(input.serverId);
  const resolvedWorkspaceId = resolveWorkspaceMapKeyByIdentity({
    workspaces,
    workspaceId: input.workspaceId,
  });
  if (input.target) {
    if (resolvedWorkspaceId || input.target.kind !== "agent") {
      prepareWorkspaceTab({ ...input, target: input.target }, deps);
    }
  } else {
    const allAgents = resolvedWorkspaceId ? Array.from(deps.getSessionAgents(input.serverId)) : [];
    const workspaceAgents = resolvedWorkspaceId
      ? allAgents.filter(
          (agent) => normalizeWorkspaceOpaqueId(agent.workspaceId) === resolvedWorkspaceId,
        )
      : [];
    const attentionAgentId = pickAttentionAgent(workspaceAgents);
    if (attentionAgentId && resolvedWorkspaceId) {
      deps.openTabFocused(`${input.serverId}:${resolvedWorkspaceId}`, {
        kind: "agent",
        agentId: attentionAgentId,
      });
    } else if (resolvedWorkspaceId) {
      const workspaceKey = `${input.serverId}:${resolvedWorkspaceId}`;
      const hasOpenConversationTab = deps
        .getOpenWorkspaceTabTargets(workspaceKey)
        .some((target) => target.kind === "agent" || target.kind === "draft");
      if (!hasOpenConversationTab) {
        const mostRecentAgentId = pickMostRecentWorkspaceAgentId({ workspaceAgents, allAgents });
        if (mostRecentAgentId) {
          deps.openTabFocused(workspaceKey, { kind: "agent", agentId: mostRecentAgentId });
        }
      }
    }
  }

  const route =
    input.target?.kind === "agent" && !resolvedWorkspaceId
      ? buildHostWorkspaceOpenRoute(
          input.serverId,
          input.workspaceId,
          `agent:${input.target.agentId}`,
        )
      : buildHostWorkspaceRoute(input.serverId, input.workspaceId);
  deps.rememberLastWorkspace({ serverId: input.serverId, workspaceId: input.workspaceId });
  deps.navigateToRoute(route);
  return route;
}

export function navigateToLastWorkspace(deps: NavigateToLastWorkspaceDeps): boolean {
  const selection = deps.getLastWorkspaceSelection();
  if (!selection) {
    return false;
  }
  navigateToWorkspace(selection, deps);
  return true;
}
