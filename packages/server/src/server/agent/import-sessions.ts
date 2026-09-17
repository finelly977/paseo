import type { z } from "zod";
import type { Logger } from "pino";
import { stat } from "node:fs/promises";
import { MAX_EXPLICIT_AGENT_TITLE_CHARS } from "@getpaseo/protocol/agent-title-limits";
import type { ProviderSnapshotManager } from "./provider-snapshot-manager.js";
import type {
  AgentManager,
  ManagedAgent,
  ManagedImportableProviderSession,
} from "./agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "./agent-storage.js";
import type { AgentPersistenceHandle, AgentProvider } from "./agent-sdk-types.js";
import { ensureAgentLoaded, type AgentLoaderManager } from "./agent-loading.js";
import { unarchiveAgentState } from "./agent-prompt.js";
import { resolveCreateAgentTitles } from "./create-agent-title.js";
import { toRecentProviderSessionDescriptorPayload } from "./agent-projections.js";
import type { WorkspaceProvisioningService } from "../session/workspace-provisioning/workspace-provisioning-service.js";
import type { PersistedWorkspaceRecord } from "../workspace-registry.js";
import type {
  FetchRecentProviderSessionsRequestMessage,
  ImportAgentRequestMessageSchema,
  RecentProviderSessionDescriptorPayload,
} from "@getpaseo/protocol/messages";
import { getParentAgentIdFromLabels, PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { createRealpathAwarePathMatcher } from "../../utils/path.js";
import {
  buildConfigOverrides,
  extractTimestamps,
  toAgentPersistenceHandle,
} from "../persistence-hooks.js";

type ImportAgentRequestMessage = z.infer<typeof ImportAgentRequestMessageSchema>;

const METADATA_GENERATION_PROMPT_PREFIX =
  "Generate metadata for a coding agent based on the user prompt.";
export type ImportSessionAgentManager = AgentLoaderManager &
  Pick<
    AgentManager,
    | "archiveSnapshot"
    | "closeAgent"
    | "getTimeline"
    | "importProviderSession"
    | "listImportableSessions"
    | "notifyAgentState"
    | "unarchiveSnapshot"
  >;

const providerSessionImportMutations = new WeakMap<
  ImportSessionAgentManager,
  Map<string, Promise<unknown>>
>();

export interface NormalizedImportAgentRequest {
  provider: AgentProvider;
  providerHandleId: string;
  cwd?: string;
  workspaceId?: string;
  title?: string;
  labels?: Record<string, string>;
  requestId: string;
}

export class ImportSessionsRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ImportSessionsRequestError";
  }
}

export interface ListImportableProviderSessionsInput {
  request: FetchRecentProviderSessionsRequestMessage;
  agentManager: Pick<AgentManager, "listAgents" | "listImportableSessions">;
  agentStorage: Pick<AgentStorage, "list">;
  providerSnapshotManager: Pick<ProviderSnapshotManager, "getProviderLabel">;
}

export interface ListImportableProviderSessionsResult {
  entries: RecentProviderSessionDescriptorPayload[];
  filteredAlreadyImportedCount: number;
  titleRepairs: ImportedSessionTitleRepair[];
}

export interface ImportedSessionTitleRepair {
  agentId: string;
  workspaceId?: string;
  title: string;
  updateAgentTitle: boolean;
}

export interface ImportProviderSessionInput {
  request: NormalizedImportAgentRequest;
  workspaceProvisioning: Pick<WorkspaceProvisioningService, "runInImportWorkspace">;
  agentManager: ImportSessionAgentManager;
  agentStorage: AgentStorage;
  logger: Logger;
}

export interface ImportProviderSessionResult {
  snapshot: ManagedAgent;
  timelineSize: number;
  createdWorkspace: PersistedWorkspaceRecord | null;
}

interface ImportedProviderSession {
  snapshot: ManagedAgent;
  timelineSize: number;
}

// COMPAT(import-agent-request-v1): accept legacy {provider, sessionId} shape
// alongside the new {providerId, providerHandleId} shape. Old clients
// (< target daemon floor) send the legacy fields. Drop the fallbacks and the
// .optional() in messages.ts when the supported client floor is >= the daemon
// version that ships the new shape (target: 2026-11-08).
export function normalizeImportAgentRequest(
  msg: ImportAgentRequestMessage,
): NormalizedImportAgentRequest | { error: string } {
  const provider = msg.providerId ?? msg.provider;
  const providerHandleId = msg.providerHandleId ?? msg.sessionId;
  if (!provider || !providerHandleId) {
    return { error: "Import requires providerId and providerHandleId" };
  }
  return {
    provider: provider as AgentProvider,
    providerHandleId,
    cwd: msg.cwd,
    workspaceId: msg.workspaceId,
    ...(msg.title ? { title: msg.title } : {}),
    labels: msg.labels,
    requestId: msg.requestId,
  };
}

export async function listImportableProviderSessions(
  input: ListImportableProviderSessionsInput,
): Promise<ListImportableProviderSessionsResult> {
  const { request, agentManager, agentStorage, providerSnapshotManager } = input;
  // 未传限制表示导入页需要完整历史；带限制的请求继续保留分页/兼容行为。
  const limit = request.limit;
  const sinceTimestamp = parseRecentProviderSessionsSince(request.since);
  const providerFilter = request.providers ? new Set(request.providers) : undefined;
  const importedSessions = await collectImportedProviderSessions(
    agentManager,
    agentStorage,
    providerFilter,
  );
  const importedHandles = importedSessions.handles;

  const sessions = await agentManager.listImportableSessions({
    ...(limit === undefined ? {} : { limit: limit + importedSessions.count }),
    providerFilter,
    cwd: request.cwd,
  });
  let filteredAlreadyImportedCount = 0;
  const titleRepairs = new Map<string, ImportedSessionTitleRepair>();
  const candidatesByHandle = new Map<string, ManagedImportableProviderSession>();
  const matchesRequestCwd = request.cwd ? createRealpathAwarePathMatcher(request.cwd) : null;
  for (const session of sessions) {
    if (matchesRequestCwd && !matchesRequestCwd(session.cwd)) {
      continue;
    }
    if (sinceTimestamp !== null && session.lastActivityAt.getTime() < sinceTimestamp) {
      continue;
    }
    if (isMetadataGenerationSession(session)) {
      continue;
    }
    const providerHandleKey = toProviderSessionHandleKey(
      session.provider,
      session.providerHandleId,
    );
    const storedOwner = importedSessions.recordsByHandle.get(providerHandleKey);
    const relocated = storedOwner && (await isRelocatedProviderSession(storedOwner, session.cwd));
    if (importedHandles.has(providerHandleKey) && !relocated) {
      filteredAlreadyImportedCount += 1;
      const titleRepair = buildImportedSessionTitleRepair(
        session,
        storedOwner,
        importedSessions.rootAgentCountsByWorkspaceId,
      );
      if (titleRepair) {
        titleRepairs.set(titleRepair.agentId, titleRepair);
      }
      continue;
    }
    const existingCandidate = candidatesByHandle.get(providerHandleKey);
    if (!existingCandidate || session.lastActivityAt > existingCandidate.lastActivityAt) {
      candidatesByHandle.set(providerHandleKey, session);
    }
  }

  const sortedCandidates = Array.from(candidatesByHandle.values()).sort(
    (a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime(),
  );
  const entries = (limit === undefined ? sortedCandidates : sortedCandidates.slice(0, limit)).map(
    (descriptor) =>
      toRecentProviderSessionDescriptorPayload(descriptor, {
        providerLabel: providerSnapshotManager.getProviderLabel(descriptor.provider),
      }),
  );

  return {
    entries,
    filteredAlreadyImportedCount,
    titleRepairs: Array.from(titleRepairs.values()),
  };
}

async function isRelocatedProviderSession(
  record: StoredAgentRecord,
  cwd: string,
): Promise<boolean> {
  if (createRealpathAwarePathMatcher(cwd)(record.cwd)) {
    return false;
  }
  try {
    await stat(record.cwd);
    return false;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  // 旧目录确实消失且原生会话报告了可用的新目录，才允许恢复已有记录，不猜测目录改名。
  try {
    return (await stat(cwd)).isDirectory();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function buildImportedSessionTitleRepair(
  session: ManagedImportableProviderSession,
  storedOwner: StoredAgentRecord | undefined,
  rootAgentCountsByWorkspaceId: ReadonlyMap<string, number>,
): ImportedSessionTitleRepair | null {
  const nativeTitle = session.title?.trim().slice(0, MAX_EXPLICIT_AGENT_TITLE_CHARS);
  if (!storedOwner?.id || storedOwner.internal || !nativeTitle) {
    return null;
  }

  const currentTitle = storedOwner.title?.trim() ?? "";
  const firstPromptPreview = session.firstPromptPreview?.trim() ?? "";
  const provisionalTitle = firstPromptPreview
    ? resolveCreateAgentTitles({ initialPrompt: firstPromptPreview }).provisionalTitle
    : null;
  const updateAgentTitle =
    currentTitle !== nativeTitle &&
    (!currentTitle || currentTitle === firstPromptPreview || currentTitle === provisionalTitle);
  const workspaceId = storedOwner.workspaceId;
  const repairWorkspaceTitle = Boolean(
    workspaceId &&
    !getParentAgentIdFromLabels(storedOwner.labels) &&
    rootAgentCountsByWorkspaceId.get(workspaceId) === 1,
  );
  if (!updateAgentTitle && !repairWorkspaceTitle) {
    return null;
  }

  return {
    agentId: storedOwner.id,
    ...(repairWorkspaceTitle && workspaceId ? { workspaceId } : {}),
    title: nativeTitle,
    updateAgentTitle,
  };
}

export async function importProviderSession(
  input: ImportProviderSessionInput,
): Promise<ImportProviderSessionResult> {
  const cwd = input.request.cwd;
  if (!cwd) {
    throw new Error("Import requires cwd from the selected provider session");
  }
  const key = await resolveProviderSessionImportMutationKey(input);
  return serializeProviderSessionImport(input.agentManager, key, async () => {
    const placement = await input.workspaceProvisioning.runInImportWorkspace(
      {
        cwd,
        requestedWorkspaceId: input.request.workspaceId,
        ...(input.request.title ? { title: input.request.title } : {}),
      },
      (workspace) => importProviderSessionNow(input, cwd, workspace.workspaceId),
    );
    return { ...placement.value, createdWorkspace: placement.createdWorkspace };
  });
}

async function importProviderSessionNow(
  input: ImportProviderSessionInput,
  cwd: string,
  workspaceId: string,
): Promise<ImportedProviderSession> {
  const { provider, providerHandleId, labels } = input.request;

  const matchingRecords = (await input.agentStorage.list()).filter((record) =>
    recordMatchesProviderHandle(record, { provider, providerHandleId }),
  );
  const activeRecord = matchingRecords.find((record) => !record.archivedAt);
  const existingRecord = activeRecord ?? matchingRecords[0];
  if (existingRecord && (await isRelocatedProviderSession(existingRecord, cwd))) {
    return restoreRelocatedProviderSession(input, existingRecord, cwd, workspaceId);
  }
  if (activeRecord) {
    throw new Error(`Provider session is already imported: ${providerHandleId}`);
  }
  const archivedRecord = matchingRecords.find((record) => record.archivedAt);
  if (archivedRecord?.persistence && archivedRecord.archivedAt) {
    if (!createRealpathAwarePathMatcher(cwd)(archivedRecord.cwd)) {
      throw new Error(`Provider session cwd does not match import cwd: ${providerHandleId}`);
    }
    const requestedParentAgentId = getParentAgentIdFromLabels(input.request.labels);
    const labelPatch: Record<string, string | null> = { ...input.request.labels };
    if (
      Object.hasOwn(archivedRecord.labels, PARENT_AGENT_ID_LABEL) ||
      Object.hasOwn(input.request.labels ?? {}, PARENT_AGENT_ID_LABEL)
    ) {
      labelPatch[PARENT_AGENT_ID_LABEL] = requestedParentAgentId;
    }
    await unarchiveAgentState(input.agentStorage, input.agentManager, archivedRecord.id, {
      workspaceId,
      ...(input.request.title ? { title: input.request.title } : {}),
      labels: Object.keys(labelPatch).length > 0 ? labelPatch : undefined,
    });
    try {
      const snapshot = await ensureAgentLoaded(archivedRecord.id, {
        agentManager: input.agentManager,
        agentStorage: input.agentStorage,
        logger: input.logger,
      });
      return {
        snapshot,
        timelineSize: input.agentManager.getTimeline(snapshot.id).length,
      };
    } catch (error) {
      await rollbackArchivedImport(input, archivedRecord, archivedRecord.archivedAt);
      throw error;
    }
  }

  const snapshot = await input.agentManager.importProviderSession({
    provider,
    providerHandleId,
    cwd,
    workspaceId,
    ...(input.request.title ? { title: input.request.title } : {}),
    labels,
  });
  await unarchiveAgentState(input.agentStorage, input.agentManager, snapshot.id);

  return {
    snapshot,
    timelineSize: input.agentManager.getTimeline(snapshot.id).length,
  };
}

async function restoreRelocatedProviderSession(
  input: ImportProviderSessionInput,
  record: StoredAgentRecord,
  cwd: string,
  workspaceId: string,
): Promise<ImportedProviderSession> {
  const { agentManager, agentStorage } = input;
  const sessions = await agentManager.listImportableSessions({
    providerFilter: new Set([input.request.provider]),
  });
  const matchesCwd = createRealpathAwarePathMatcher(cwd);
  const nativeSession = sessions.find(
    (session) => recordMatchesProviderHandle(record, session) && matchesCwd(session.cwd),
  );
  if (!nativeSession) {
    throw new Error("原生会话尚未确认新的工作目录，不能迁移已导入会话。");
  }
  const persistence = toAgentPersistenceHandle(
    agentManager.getRegisteredProviderIds(),
    record.persistence,
  );
  if (!persistence) {
    throw new Error("该会话没有可恢复的原生记录，不能迁移工作目录。");
  }
  // 不为了恢复目录而中断会话或替换仍被使用的运行时。
  if (agentManager.getAgent(record.id)) {
    throw new Error("请先释放原会话的运行时，再从新目录重新导入。");
  }
  try {
    const snapshot = await agentManager.resumeAgentFromPersistence(
      persistence,
      { ...buildConfigOverrides(record), cwd, title: record.title, internal: record.internal },
      record.id,
      { ...extractTimestamps(record), workspaceId },
    );
    await agentManager.hydrateTimelineFromProvider(record.id);
    await agentStorage.applySnapshot(snapshot);
    await unarchiveAgentState(agentStorage, agentManager, record.id);
    agentManager.notifyAgentState(record.id);
    return { snapshot, timelineSize: agentManager.getTimeline(record.id).length };
  } catch (error) {
    const failures: unknown[] = [error];
    try {
      if (agentManager.getAgent(record.id)) {
        await agentManager.closeAgent(record.id);
      }
    } catch (closeError) {
      failures.push(closeError);
    }
    try {
      await agentStorage.upsert(record);
    } catch (restoreError) {
      failures.push(restoreError);
    }
    if (failures.length > 1) {
      const restoreFailure = new AggregateError(
        failures,
        "会话目录恢复失败，且未能完整恢复原记录",
        {
          cause: error,
        },
      );
      throw restoreFailure;
    }
    throw error;
  }
}

async function serializeProviderSessionImport<T>(
  agentManager: ImportSessionAgentManager,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  let mutations = providerSessionImportMutations.get(agentManager);
  if (!mutations) {
    mutations = new Map();
    providerSessionImportMutations.set(agentManager, mutations);
  }

  const previous = mutations.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  mutations.set(key, next);
  try {
    return await next;
  } finally {
    if (mutations.get(key) === next) {
      mutations.delete(key);
    }
  }
}

async function resolveProviderSessionImportMutationKey(
  input: ImportProviderSessionInput,
): Promise<string> {
  const identity = {
    provider: input.request.provider,
    providerHandleId: input.request.providerHandleId,
  };
  const matchingRecord = (await input.agentStorage.list()).find((record) =>
    recordMatchesProviderHandle(record, identity),
  );
  return matchingRecord
    ? `agent\0${matchingRecord.id}`
    : `handle\0${toProviderSessionHandleKey(identity.provider, identity.providerHandleId)}`;
}

async function rollbackArchivedImport(
  input: ImportProviderSessionInput,
  archivedRecord: StoredAgentRecord,
  archivedAt: string,
): Promise<void> {
  try {
    if (input.agentManager.getAgent(archivedRecord.id)) {
      await input.agentManager.closeAgent(archivedRecord.id);
    }
    await input.agentManager.archiveSnapshot(archivedRecord.id, archivedAt);
  } catch (error) {
    input.logger.error(
      { err: error, agentId: archivedRecord.id },
      "Failed to re-archive provider session after import failure",
    );
  }

  try {
    await input.agentStorage.upsert(archivedRecord);
  } catch (error) {
    input.logger.error(
      { err: error, agentId: archivedRecord.id },
      "Failed to restore archived agent record after import failure",
    );
  }
}

function recordMatchesProviderHandle(
  record: StoredAgentRecord,
  identity: { provider: string; providerHandleId: string },
): boolean {
  const persistedProvider =
    record.persistence?.provider ?? record.runtimeInfo?.provider ?? record.provider;
  return (
    persistedProvider === identity.provider &&
    (record.persistence?.sessionId === identity.providerHandleId ||
      record.persistence?.nativeHandle === identity.providerHandleId ||
      record.runtimeInfo?.sessionId === identity.providerHandleId)
  );
}

function parseRecentProviderSessionsSince(since: string | undefined): number | null {
  if (!since) {
    return null;
  }
  const timestamp = Date.parse(since);
  if (Number.isNaN(timestamp)) {
    throw new ImportSessionsRequestError("invalid_since", "Invalid recent provider sessions since");
  }
  return timestamp;
}

async function collectImportedProviderSessions(
  agentManager: Pick<AgentManager, "listAgents">,
  agentStorage: Pick<AgentStorage, "list">,
  providerFilter: Set<string> | undefined,
): Promise<{
  handles: Set<string>;
  count: number;
  recordsByHandle: Map<string, StoredAgentRecord>;
  rootAgentCountsByWorkspaceId: Map<string, number>;
}> {
  const handles = new Set<string>();
  const sessions = new Set<string>();
  const records = await agentStorage.list();
  const storedRecordsById = new Map(records.map((record) => [record.id, record]));
  const recordsByHandle = new Map<string, StoredAgentRecord>();
  const rootAgentIdsByWorkspaceId = new Map<string, Set<string>>();

  const collect = (
    provider: AgentProvider | StoredAgentRecord["provider"] | string,
    persistence: AgentPersistenceHandle | null | undefined,
  ) => {
    if (!persistence || (providerFilter && !providerFilter.has(provider))) return;
    sessions.add(toProviderSessionHandleKey(provider, persistence.sessionId));
    collectProviderSessionHandleKeys(handles, provider, persistence);
  };

  for (const agent of agentManager.listAgents()) {
    if (storedRecordsById.get(agent.id)?.archivedAt) {
      continue;
    }
    collect(agent.provider, agent.persistence);
  }

  for (const record of records) {
    if (record.archivedAt) {
      continue;
    }
    collect(record.provider, record.persistence);
    if (record.runtimeInfo?.sessionId) {
      const runtimeHandleKey = toProviderSessionHandleKey(
        record.provider,
        record.runtimeInfo.sessionId,
      );
      sessions.add(runtimeHandleKey);
      handles.add(runtimeHandleKey);
      recordsByHandle.set(runtimeHandleKey, record);
    }
    for (const key of getProviderSessionHandleKeys(record.provider, record.persistence)) {
      recordsByHandle.set(key, record);
    }
    if (record.workspaceId && !record.internal && !getParentAgentIdFromLabels(record.labels)) {
      const agentIds = rootAgentIdsByWorkspaceId.get(record.workspaceId) ?? new Set<string>();
      agentIds.add(record.id);
      rootAgentIdsByWorkspaceId.set(record.workspaceId, agentIds);
    }
  }

  return {
    handles,
    count: sessions.size,
    recordsByHandle,
    rootAgentCountsByWorkspaceId: new Map(
      Array.from(rootAgentIdsByWorkspaceId, ([workspaceId, agentIds]) => [
        workspaceId,
        agentIds.size,
      ]),
    ),
  };
}

function toProviderSessionHandleKey(provider: string, providerHandleId: string): string {
  return `${provider}\0${providerHandleId}`;
}

function isMetadataGenerationSession(input: { firstPromptPreview: string | null }): boolean {
  return (
    input.firstPromptPreview?.trimStart().startsWith(METADATA_GENERATION_PROMPT_PREFIX) ?? false
  );
}

function collectProviderSessionHandleKeys(
  target: Set<string>,
  provider: AgentProvider | StoredAgentRecord["provider"] | string,
  persistence: AgentPersistenceHandle | null | undefined,
): void {
  if (!persistence) {
    return;
  }

  for (const key of getProviderSessionHandleKeys(provider, persistence)) {
    target.add(key);
  }
}

function getProviderSessionHandleKeys(
  provider: AgentProvider | StoredAgentRecord["provider"] | string,
  persistence: AgentPersistenceHandle | null | undefined,
): string[] {
  if (!persistence) {
    return [];
  }
  return [
    toProviderSessionHandleKey(provider, persistence.sessionId),
    ...(persistence.nativeHandle
      ? [toProviderSessionHandleKey(provider, persistence.nativeHandle)]
      : []),
  ];
}
