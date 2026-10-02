import { expect, test } from "vitest";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { NativeTitleAgentClient } from "../test-utils/native-title-agent-client.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("原生改名同步多个客户端，原生失败保留旧名，重新打开读取原生名称", async () => {
  const provider = new NativeTitleAgentClient();
  const daemon = await createTestPaseoDaemon({
    agentClients: { codex: provider },
    mcpEnabled: false,
  });
  const options = { url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.2.2" };
  const first = new DaemonClient({ ...options, clientId: "title-reconnect" });
  const second = new DaemonClient(options);
  const reopened = new DaemonClient({ ...options, clientId: "title-reconnect" });
  try {
    await first.connect();
    await first.fetchAgents({ subscribe: { subscriptionId: "first" } });
    const agent = await first.createAgent({
      provider: "codex",
      cwd: daemon.paseoHome,
      model: "gpt-5.4-mini",
      modeId: "auto",
    });
    if (!agent.workspaceId) throw new Error("测试会话缺少工作区");
    await first.setWorkspaceTitle(agent.workspaceId, "独立工作区名称");
    await second.connect();
    await second.fetchAgents({ subscribe: { subscriptionId: "second" } });
    const changed = second.waitForAgentUpsert(agent.id, (value) => value.title === "用户新名称");
    await first.updateAgent(agent.id, { name: "用户新名称" });
    const renamed = await changed;
    expect(renamed.title).toBe("用户新名称");
    expect(renamed.availableModes).toEqual(agent.availableModes);
    expect(renamed.features).toEqual(agent.features);
    const native = await first.getNativeSessionTitle(agent.id);
    expect(native.title).toBe("用户新名称");
    provider.failRename = true;
    await expect(first.updateAgent(agent.id, { name: "失败名称" })).rejects.toThrow("原生改名失败");
    expect((await first.fetchAgent(agent.id))?.agent.title).toBe("用户新名称");
    provider.failRename = false;
    if (!native.sessionId) throw new Error("测试会话缺少原生标识");
    provider.native.set(native.sessionId, { title: "原生客户端改名", cwd: daemon.paseoHome });
    await first.close();
    await reopened.connect();
    const synchronized = second.waitForAgentUpsert(
      agent.id,
      (value) => value.title === "原生客户端改名",
    );
    await reopened.fetchAgents({ subscribe: { subscriptionId: "reopened" } });
    expect((await synchronized).title).toBe("原生客户端改名");
    const workspace = (await reopened.fetchWorkspaces()).entries.find(
      (entry) => entry.id === agent.workspaceId,
    );
    expect(workspace?.title).toBe("独立工作区名称");

    const record = await daemon.daemon.agentStorage.get(agent.id);
    if (!record) throw new Error("测试会话丢失");
    await daemon.daemon.agentStorage.upsert({
      ...record,
      title: "待迁移旧名",
      titleSync: undefined,
    });
    const script = fileURLToPath(
      new URL("../../../../../scripts/migrate-session-titles.mts", import.meta.url),
    );
    const previewPath = path.join(daemon.paseoHome, "preview.json");
    const appliedPath = path.join(daemon.paseoHome, "applied.json");
    const args = [
      "--import",
      "tsx",
      script,
      "--home",
      daemon.paseoHome,
      "--host",
      `127.0.0.1:${daemon.port}`,
    ];
    const execute = promisify(execFile);
    await execute(process.execPath, [...args, "--report", previewPath], { windowsHide: true });
    expect((await reopened.getNativeSessionTitle(agent.id)).title).toBe("原生客户端改名");
    const preview = JSON.parse(await readFile(previewPath, "utf8"));
    expect(preview.rows[0]).toMatchObject({
      title: "待迁移旧名",
      previousNativeTitle: "原生客户端改名",
      status: "ready",
    });
    await execute(process.execPath, [...args, "--report", appliedPath, "--apply"], {
      windowsHide: true,
    });
    expect((await reopened.getNativeSessionTitle(agent.id)).title).toBe("待迁移旧名");
    expect(JSON.parse(await readFile(appliedPath, "utf8")).rows[0].status).toBe("applied");
  } finally {
    await Promise.all([first.close(), second.close(), reopened.close()]);
    await daemon.close();
  }
}, 30_000);
