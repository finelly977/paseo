import { afterEach, expect, test } from "vitest";
import {
  HubRelationshipHarness,
  SetupFailingArchiveWatchFiles,
} from "./test-utils/relationship-harness.js";

let relationship: HubRelationshipHarness | null = null;
const HUB_INTEGRATION_TIMEOUT_MS = 30_000;

afterEach(async () => {
  await relationship?.close();
  relationship = null;
}, HUB_INTEGRATION_TIMEOUT_MS);

async function launchRelationship(): Promise<HubRelationshipHarness> {
  const launched = await HubRelationshipHarness.start();
  await launched.beginConnect().result;
  launched.connectLatestSocket();
  relationship = launched;
  return launched;
}

test(
  "Hub retries one durable daemon execution across concurrency and reconstruction",
  async () => {
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
  },
  HUB_INTEGRATION_TIMEOUT_MS,
);

test(
  "Hub session applies its scoped authorization to ordinary protocol messages",
  async () => {
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
    expect(hub.observedTrustedLifecycleMessages()).toEqual(["server_info"]);
    expect(hub.serverInfoPermissions()).toEqual([["hub.execute"]]);
  },
  HUB_INTEGRATION_TIMEOUT_MS,
);

test(
  "Hub completes the standard hello before rejecting a second hello",
  async () => {
    const hub = await launchRelationship();

    expect(hub.serverInfoPermissions()).toEqual([["hub.execute"]]);
    expect(hub.probeTrustedHello()).toBe(4002);
  },
  HUB_INTEGRATION_TIMEOUT_MS,
);

test(
  "legacy Hub wire behavior still enters the common Session bootstrap",
  async () => {
    const launched = await HubRelationshipHarness.start();
    await launched.beginConnect().result;
    launched.connectLatestLegacySocket();
    relationship = launched;

    expect(launched.observedTrustedLifecycleMessages()).toEqual(["server_info"]);
    expect(launched.serverInfoPermissions()).toEqual([["hub.execute"]]);
  },
  HUB_INTEGRATION_TIMEOUT_MS,
);

test(
  "Hub binary frames require workspace write permission",
  async () => {
    const hub = await launchRelationship();

    expect(hub.probeBinaryFrame()).toBeNull();
    expect(hub.latestStatusError()).toBe("Session is not authorized for binary frames");
  },
  HUB_INTEGRATION_TIMEOUT_MS,
);

test(
  "Hub receives standard server info but not broadcasts outside its scope",
  async () => {
    const hub = await launchRelationship();

    const trustedBroadcasts = await hub.trustedBroadcastCount();
    const trustedStatus = await hub.trustedDaemonStatus();

    expect(trustedBroadcasts).toBe(0);
    expect(trustedStatus).toMatchObject({ pid: process.pid, relay: { enabled: false } });
    expect(hub.observedTrustedLifecycleMessages()).toEqual(["server_info"]);
  },
  HUB_INTEGRATION_TIMEOUT_MS,
);

test(
  "Hub reconnects through the standard resumable session bootstrap",
  async () => {
    const hub = await launchRelationship();
    const created = await hub.createOwnedConcurrently();

    const reconnected = await hub.reconnectAndRetry();

    expect(reconnected).toMatchObject({
      executionId: "execution-1",
      agentId: created.first.agentId,
    });
    expect(hub.observedTrustedLifecycleMessages()).toEqual(["server_info", "server_info"]);
    expect(hub.serverInfoPermissions()).toEqual([["hub.execute"], ["hub.execute"]]);
  },
  HUB_INTEGRATION_TIMEOUT_MS,
);

test(
  "Hub create forwards worktree and auto-archive through the existing create path",
  async () => {
    const hub = await launchRelationship();
    hub.beginOwnedCreate("worktree-create", "execution-worktree", {
      worktree: { mode: "branch-off", newBranch: "hub-created-worktree", base: "main" },
      autoArchive: true,
      prompt: "sleep 30",
      modeId: "always-ask",
    });
    const worktreeCreated = await hub.ownedCreateResult("worktree-create");
    const worktreeCwd = hub.latestCreatedCwd();
    const agentId = worktreeCreated.payload.agentId;
    if (!agentId || !worktreeCwd) throw new Error("Hub worktree creation did not return ownership");
    const permission = await hub.ownedPermissionRequest(agentId);
    const duringRun = await hub.worktreeState(worktreeCwd);
    const archiveCompletion = hub.waitForOwnedArchiveCompletion(agentId);
    await hub.allowOwnedPermission(agentId, permission.id);
    await hub.ownedTurnCompletion(agentId);
    const archive = await archiveCompletion;
    const afterArchive = await hub.worktreeState(worktreeCwd);

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
  },
  HUB_INTEGRATION_TIMEOUT_MS,
);

test(
  "archive observation closes its first watcher when the second watcher cannot start",
  async () => {
    const watchFiles = new SetupFailingArchiveWatchFiles(2);
    const hub = await HubRelationshipHarness.start(watchFiles);
    relationship = hub;
    await hub.beginConnect().result;
    hub.connectLatestSocket();
    hub.beginOwnedCreate("watch-setup-create", "watch-setup-execution");
    const created = await hub.ownedCreateResult("watch-setup-create");
    const agentId = created.payload.agentId;
    if (!agentId) throw new Error("Hub create did not return an agent identifier");

    await expect(hub.waitForOwnedArchiveCompletion(agentId)).rejects.toThrow("Cannot watch");

    expect(watchFiles.activeDirectories()).toEqual([]);
  },
  HUB_INTEGRATION_TIMEOUT_MS,
);
