import { afterEach, expect, test } from "vitest";
import {
  HubRelationshipHarness,
  SetupFailingArchiveWatchFiles,
} from "./test-utils/relationship-harness.js";

let relationship: HubRelationshipHarness | null = null;

afterEach(async () => {
  await relationship?.close();
  relationship = null;
});

async function launchRelationship(): Promise<HubRelationshipHarness> {
  const launched = await HubRelationshipHarness.start();
  await launched.beginConnect().result;
  launched.connectLatestSocket();
  relationship = launched;
  return launched;
}

test("Hub retries one durable daemon execution across concurrency and reconstruction", async () => {
  const hub = await launchRelationship();

  const created = await hub.createOwnedConcurrently();
  const update = await hub.ownedUpdate(created.first.agentId);
  const stream = await hub.ownedStream(created.first.agentId);
  const reconstructed = await hub.reconstructAndReplay();

  expect(created.duplicate.agentId).toBe(created.first.agentId);
  expect(update).toMatchObject({
    executionId: "execution-1",
    agentId: created.first.agentId,
    agent: { id: created.first.agentId },
  });
  expect(stream).toMatchObject({ executionId: "execution-1", agentId: created.first.agentId });
  expect(reconstructed.replay.agent.id).toBe(created.first.agentId);
  expect(reconstructed.durableAgentCount).toBe(1);
});

test("Hub denies trusted steering and browser dispatch", async () => {
  const hub = await launchRelationship();
  const localAgentId = await hub.createUnrelatedLocalAgent();

  const steeringDenial = await hub.deniedSteering(localAgentId);
  const browserDenial = await hub.deniedBrowserDispatch();

  expect(steeringDenial).toEqual({
    requestId: "denied-steer",
    requestType: "send_agent_message_request",
    error: "Session is not authorized for send_agent_message_request",
    code: "access_denied",
  });
  expect(browserDenial).toEqual({
    requestId: "browser-1",
    requestType: "browser.automation.execute.response",
    error: "Session is not authorized for browser.automation.execute.response",
    code: "access_denied",
  });
  expect(hub.observedAgentIds()).not.toContain(localAgentId);
  expect(hub.observedTrustedLifecycleMessages()).toEqual([]);
});

test("Hub sockets reject trusted hello and capabilities", async () => {
  const hub = await launchRelationship();

  expect(hub.probeTrustedHello()).toBe(4002);
});

test("Hub sockets reject trusted binary frames", async () => {
  const hub = await launchRelationship();

  expect(hub.probeBinaryFrame()).toBe(4002);
});

test("Hub does not receive trusted broadcasts", async () => {
  const hub = await launchRelationship();

  const trustedBroadcasts = await hub.trustedBroadcastCount();
  const trustedStatus = await hub.trustedDaemonStatus();

  expect(trustedBroadcasts).toBe(0);
  expect(trustedStatus).toMatchObject({ pid: process.pid, relay: { enabled: false } });
  expect(hub.observedTrustedLifecycleMessages()).toEqual([]);
});

test("Hub reconnects without retaining trusted session state", async () => {
  const hub = await launchRelationship();
  const created = await hub.createOwnedConcurrently();

  const reconnected = await hub.reconnectAndRetry();

  expect(reconnected).toMatchObject({
    executionId: "execution-1",
    agentId: created.first.agentId,
  });
  expect(hub.observedTrustedLifecycleMessages()).toEqual([]);
});

test("Hub create forwards worktree and auto-archive through the existing create path", async () => {
  const hub = await launchRelationship();
  hub.beginOwnedCreate("worktree-create", "execution-worktree", {
    worktree: { mode: "branch-off", newBranch: "hub-created-worktree", base: "main" },
    autoArchive: true,
    prompt: "sleep 30",
    modeId: "always-ask",
  });
  const worktreeCreated = await hub.ownedCreateResult("worktree-create");
  const worktreeCwd = hub.latestCreatedCwd();
  const permission = await hub.ownedPermissionRequest(worktreeCreated.payload.agentId!);
  const duringRun = await hub.worktreeState(worktreeCwd!);
  const archiveCompletion = hub.waitForOwnedArchiveCompletion(worktreeCreated.payload.agentId!);
  await hub.allowOwnedPermission(worktreeCreated.payload.agentId!, permission.id);
  await hub.ownedTurnCompletion(worktreeCreated.payload.agentId!);
  const archive = await archiveCompletion;
  const afterArchive = await hub.worktreeState(worktreeCwd!);

  expect(worktreeCreated).toMatchObject({
    type: "hub.execution.agent.create.response",
    payload: { success: true, agent: { cwd: worktreeCwd } },
  });
  expect(worktreeCwd).not.toBe(hub.repoRoot());
  expect(duringRun).toEqual({ exists: true, listed: true });
  expect(afterArchive).toEqual({ exists: false, listed: false });
  expect(archive).toEqual({
    agentArchivedAt: expect.any(String),
    workspaceArchivedAt: expect.any(String),
  });
});

test("a sibling workspace keeps an archived execution's worktree directory alive", async () => {
  const created = await hub.ownedCreateResult("sibling-create");
  const targetWorkspaceId = created.payload.agent?.workspaceId;
  const worktreeCwd = hub.latestCreatedCwd()!;
  await hub.ownedRunningUpdate(created.payload.agentId!);
  const siblingWorkspaceId = await hub.createSiblingWorkspace(worktreeCwd);

  const response = await hub.archiveExecution("execution-sibling", "archive-sibling");

  expect(response).toMatchObject({ success: true, error: null });
  expect(targetWorkspaceId).toEqual(expect.any(String));
  expect(await hub.archivedWorkspaceAt(targetWorkspaceId!)).toEqual(expect.any(String));
  expect(await hub.archivedWorkspaceAt(siblingWorkspaceId)).toBeNull();
  expect(await hub.worktreeState(worktreeCwd)).toEqual({ exists: true, listed: true });
  expect(await hub.ownedAgentArchivedAt(created.payload.agentId!)).toEqual(expect.any(String));
});

test("archiving a second same-slug execution leaves the first worktree intact", async () => {
  const hub = await launchRelationship();
  const worktree = {
    mode: "branch-off" as const,
    newBranch: "hub-reused-worktree",
    base: "main",
  };
  hub.beginOwnedCreate("original-worktree-create", "execution-original-worktree", {
    worktree,
    prompt: "respond with exactly: original complete",
  });
  const original = await hub.ownedCreateResult("original-worktree-create");
  const worktreeCwd = hub.latestCreatedCwd()!;
  const originalWorkspaceId = original.payload.agent?.workspaceId;
  await hub.ownedTurnCompletion(original.payload.agentId!);

  hub.beginOwnedCreate("reused-worktree-create", "execution-reused-worktree", {
    worktree,
    prompt: "sleep 30",
  });
  const reused = await hub.ownedCreateResult("reused-worktree-create");
  const secondWorktreeCwd = hub.latestCreatedCwd()!;
  const reusedWorkspaceId = reused.payload.agent?.workspaceId;
  await hub.ownedRunningUpdate(reused.payload.agentId!);

  const response = await hub.archiveExecution(
    "execution-reused-worktree",
    "archive-reused-worktree",
  );

  expect(response).toMatchObject({ success: true, error: null });
  expect(reusedWorkspaceId).toEqual(expect.any(String));
  expect(reusedWorkspaceId).not.toBe(originalWorkspaceId);
  expect(hub.pathsReferToSameLocation(reused.payload.agent!.cwd, worktreeCwd)).toBe(false);
  expect(hub.pathsReferToSameLocation(reused.payload.agent!.cwd, secondWorktreeCwd)).toBe(true);
  expect(await hub.worktreeState(worktreeCwd)).toEqual({ exists: true, listed: true });
  expect(await hub.worktreeState(secondWorktreeCwd)).toEqual({ exists: false, listed: false });
  expect(await hub.agentRemainsAvailable(original.payload.agentId!)).toBe(true);
  expect(await hub.ownedAgentArchivedAt(reused.payload.agentId!)).toEqual(expect.any(String));
  expect(await hub.ownedWorkspaceArchivedAt(reused.payload.agentId!)).toEqual(expect.any(String));
  expect(await hub.ownedWorkspaceArchivedAt(original.payload.agentId!)).toBeNull();
});

test("Hub resolves persisted execution ownership after daemon restart", async () => {
  const hub = await launchRelationship();
  hub.beginOwnedCreate("restart-create", "execution-restart", {
    worktree: { mode: "branch-off", newBranch: "hub-restart-worktree", base: "main" },
    prompt: "sleep 30",
  });
  const created = await hub.ownedCreateResult("restart-create");
  const workspaceId = created.payload.agent?.workspaceId;
  const worktreeCwd = hub.latestCreatedCwd()!;
  await hub.ownedRunningUpdate(created.payload.agentId!);

  await hub.restartDaemon();
  await hub.socketDialed();
  hub.connectLatestSocket();
  const response = await hub.archiveExecution("execution-restart", "archive-after-restart");

  expect(response).toMatchObject({ success: true, error: null });
  expect(await hub.ownedAgentArchivedAt(created.payload.agentId!)).toEqual(expect.any(String));
  expect(workspaceId).toEqual(expect.any(String));
  expect(await hub.archivedWorkspaceAt(workspaceId!)).toEqual(expect.any(String));
  expect(await hub.worktreeState(worktreeCwd)).toEqual({ exists: false, listed: false });
}, 20_000);

test("archive observation closes its first watcher when the second watcher cannot start", async () => {
  const watchFiles = new SetupFailingArchiveWatchFiles(2);
  const hub = await HubRelationshipHarness.start(watchFiles);
  relationship = hub;
  await hub.beginConnect().result;
  hub.connectLatestSocket();
  hub.beginOwnedCreate("watch-setup-create", "watch-setup-execution");
  const created = await hub.ownedCreateResult("watch-setup-create");

  await expect(hub.waitForOwnedArchiveCompletion(created.payload.agentId!)).rejects.toThrow(
    "Cannot watch",
  );

  expect(watchFiles.activeDirectories()).toEqual([]);
});
