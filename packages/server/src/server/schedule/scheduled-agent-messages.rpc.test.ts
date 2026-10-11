import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";

describe("定时消息主机接口", () => {
  it("提供方拒绝启动时保留失败项，不误标为已发送", async () => {
    const agentClients = createTestAgentClients();
    const createSession = agentClients.codex.createSession.bind(agentClients.codex);
    agentClients.codex.createSession = async (...args) => {
      const session = await createSession(...args);
      session.startTurn = async () => {
        throw new Error("模型拒绝接收消息");
      };
      return session;
    };
    const host = await createTestPaseoDaemon({ agentClients, mcpEnabled: false });
    const client = new DaemonClient({ url: `ws://127.0.0.1:${host.port}/ws` });
    try {
      await client.connect();
      await client.fetchAgents();
      const agent = await client.createAgent({ provider: "codex", cwd: host.paseoHome });
      const message = await client.scheduleAgentMessage({
        agentId: agent.id,
        clientMessageId: "failed-start",
        text: "拒绝启动",
        delayMinutes: 5,
      });
      expect(await client.sendScheduledAgentMessageNow(agent.id, message.id)).toMatchObject({
        status: "failed",
        error: expect.stringContaining("模型拒绝接收消息"),
      });
      expect(await client.listScheduledAgentMessages(agent.id)).toHaveLength(1);
    } finally {
      await client.close();
      await host.close();
    }
  }, 30000);
  it("保存、取消和立即发送沿用真实接口，图片进入权威用户时间线", async () => {
    const host = await createTestPaseoDaemon({ mcpEnabled: false });
    const client = new DaemonClient({ url: `ws://127.0.0.1:${host.port}/ws` });
    const image = {
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=",
      mimeType: "image/png",
    };
    try {
      await client.connect();
      await client.fetchAgents();
      const agent = await client.createAgent({ provider: "codex", cwd: host.paseoHome });
      const message = await client.scheduleAgentMessage({
        agentId: agent.id,
        clientMessageId: "scheduled-image",
        text: "定时图片",
        delayMinutes: 5,
        images: [image],
      });
      expect(message).toMatchObject({ status: "waiting", imageCount: 1 });
      expect(await client.listScheduledAgentMessages(agent.id)).toHaveLength(1);
      const saved = JSON.parse(
        await readFile(join(host.paseoHome, "scheduled-messages", `${message.id}.json`), "utf8"),
      );
      expect((await readFile(saved.images[0].path)).toString("base64")).toBe(image.data);

      const cancelled = await client.scheduleAgentMessage({
        agentId: agent.id,
        clientMessageId: "cancelled",
        text: "取消",
        delayMinutes: 1,
      });
      expect((await client.cancelScheduledAgentMessage(agent.id, cancelled.id)).status).toBe(
        "cancelled",
      );
      expect((await client.sendScheduledAgentMessageNow(agent.id, message.id)).status).toBe("sent");
      expect(await client.listScheduledAgentMessages(agent.id)).toEqual([]);
      const timeline = await client.fetchAgentTimeline(agent.id);
      const users = timeline.entries.filter((entry) => entry.item.type === "user_message");
      expect(users).toHaveLength(1);
      expect(users[0].item).toMatchObject({
        type: "user_message",
        text: "定时图片",
        clientMessageId: "scheduled-image",
        images: [{ path: saved.images[0].path, mimeType: "image/png" }],
      });
      await expect(client.sendScheduledAgentMessageNow(agent.id, message.id)).rejects.toThrow(
        "消息已发送或取消",
      );
    } finally {
      await client.close();
      await host.close();
    }
  }, 30000);
});
