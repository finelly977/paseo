import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduledAgentMessages } from "./scheduled-agent-messages.js";
import type { ScheduledAgentMessageRecord } from "@getpaseo/protocol/messages";

const agentId = "c605de73-a4b6-4097-b5b3-4b819521d37d";
const directories: string[] = [];
const services: ScheduledAgentMessages[] = [];
async function setup() {
  const home = await mkdtemp(join(tmpdir(), "paseo-timed-message-"));
  directories.push(home);
  let time = new Date("2026-10-11T12:00:00.000Z");
  const canSend = vi.fn(async () => true);
  const deliver = vi.fn(async (_message: ScheduledAgentMessageRecord) => undefined);
  const options = {
    paseoHome: home,
    logger: pino({ level: "silent" }),
    canSend,
    deliver,
    now: () => time,
  };
  const service = new ScheduledAgentMessages(options);
  services.push(service);
  await service.start();
  return {
    home,
    service,
    options,
    canSend,
    deliver,
    advance: (ms: number) => {
      time = new Date(time.getTime() + ms);
    },
  };
}
afterEach(async () => {
  for (const service of services) await service.stop();
  services.length = 0;
  for (const dir of directories) await rm(dir, { recursive: true, force: true });
  directories.length = 0;
});
describe("普通定时消息", () => {
  it("取消与到期并发时不会继续派发，重复立即发送被拒绝", async () => {
    const t = await setup();
    const a = await t.service.create({
      agentId,
      clientMessageId: "cancel-race",
      text: "取消",
      delayMinutes: 1,
    });
    t.advance(60000);
    await Promise.all([t.service.cancel(agentId, a.id), t.service.tick()]);
    expect(t.deliver).not.toHaveBeenCalled();
    const b = await t.service.create({
      agentId,
      clientMessageId: "send-race",
      text: "发送",
      delayMinutes: 1,
    });
    const first = t.service.sendNow(agentId, b.id);
    await expect(t.service.sendNow(agentId, b.id)).rejects.toThrow("重复操作");
    await first;
    expect(t.deliver).toHaveBeenCalledOnce();
  });
  it("同一会话的两个立即发送请求不会并发启动回合", async () => {
    const t = await setup();
    const a = await t.service.create({
      agentId,
      clientMessageId: "first",
      text: "第一条",
      delayMinutes: 1,
    });
    const b = await t.service.create({
      agentId,
      clientMessageId: "second",
      text: "第二条",
      delayMinutes: 1,
    });
    let release: () => void = () => {
      throw new Error("派发尚未开始");
    };
    t.deliver.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = t.service.sendNow(agentId, a.id);
    await vi.waitFor(() => expect(t.deliver).toHaveBeenCalledOnce());
    expect((await t.service.sendNow(agentId, b.id)).status).toBe("waiting");
    release();
    await first;
    await t.service.tick();
    expect(t.deliver).toHaveBeenCalledTimes(2);
  });
  it("到期前不发，到期后只发一次，并保存真实图片", async () => {
    const t = await setup();
    const image = { data: "aW1hZ2U=", mimeType: "image/png" };
    const result = await t.service.create({
      agentId,
      clientMessageId: "one",
      text: "正文",
      delayMinutes: 2,
      images: [image],
    });
    await t.service.tick();
    expect(t.deliver).not.toHaveBeenCalled();
    t.advance(120000);
    await t.service.tick();
    await t.service.tick();
    expect(t.deliver).toHaveBeenCalledOnce();
    const record = t.deliver.mock.calls[0][0];
    expect(record.text).toBe("正文");
    expect((await readFile(record.images[0].path)).toString("base64")).toBe(image.data);
    expect(record.images[0].path.startsWith(t.home)).toBe(true);
    expect(await t.service.list(agentId)).toEqual([]);
    expect(
      JSON.parse(await readFile(join(t.home, "scheduled-messages", `${result.id}.json`), "utf8"))
        .status,
    ).toBe("sent");
  });
  it("智能体忙时等待，不中断，恢复空闲后发送", async () => {
    const t = await setup();
    t.canSend.mockResolvedValue(false);
    await t.service.create({ agentId, clientMessageId: "one", text: "正文", delayMinutes: 1 });
    t.advance(60000);
    await t.service.tick();
    expect(t.deliver).not.toHaveBeenCalled();
    expect((await t.service.list(agentId))[0].status).toBe("waiting");
    t.canSend.mockResolvedValue(true);
    await t.service.tick();
    expect(t.deliver).toHaveBeenCalledOnce();
  });
  it("重启保留待发送消息，逾期立即送出而非跳到下一周期", async () => {
    const t = await setup();
    await t.service.create({ agentId, clientMessageId: "one", text: "正文", delayMinutes: 1 });
    await t.service.stop();
    t.advance(180000);
    const restored = new ScheduledAgentMessages(t.options);
    services.push(restored);
    await restored.start();
    await restored.tick();
    expect(t.deliver).toHaveBeenCalledOnce();
  });
  it("取消后不发，立即发送会等待空闲而不是打断", async () => {
    const t = await setup();
    const a = await t.service.create({
      agentId,
      clientMessageId: "one",
      text: "取消",
      delayMinutes: 1,
    });
    await t.service.cancel(agentId, a.id);
    const b = await t.service.create({
      agentId,
      clientMessageId: "two",
      text: "立即",
      delayMinutes: 5,
    });
    t.canSend.mockResolvedValue(false);
    expect((await t.service.sendNow(agentId, b.id)).status).toBe("waiting");
    t.canSend.mockResolvedValue(true);
    await t.service.tick();
    expect(t.deliver).toHaveBeenCalledOnce();
    expect(t.deliver.mock.calls[0][0].text).toBe("立即");
    t.advance(360000);
    await t.service.tick();
    expect(t.deliver).toHaveBeenCalledOnce();
  });
  it("失败保留消息和错误，手动重试使用新的派发标识", async () => {
    const t = await setup();
    const a = await t.service.create({
      agentId,
      clientMessageId: "one",
      text: "失败",
      delayMinutes: 1,
    });
    t.deliver.mockRejectedValueOnce(new Error("连接失败"));
    t.advance(60000);
    await t.service.tick();
    expect((await t.service.list(agentId))[0]).toMatchObject({
      status: "failed",
      error: "连接失败",
    });
    await t.service.sendNow(agentId, a.id);
    expect(t.deliver.mock.calls[1][0].clientMessageId).not.toBe("one");
  });
  it("发送中重启显示明确错误，不盲目重复送达", async () => {
    const t = await setup();
    const a = await t.service.create({
      agentId,
      clientMessageId: "one",
      text: "正文",
      delayMinutes: 1,
    });
    await t.service.stop();
    const path = join(t.home, "scheduled-messages", `${a.id}.json`);
    const record = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...record, status: "sending" }));
    const restored = new ScheduledAgentMessages(t.options);
    services.push(restored);
    await restored.start();
    t.advance(120000);
    await restored.tick();
    expect((await restored.list(agentId))[0]).toMatchObject({
      status: "failed",
      error: expect.stringContaining("重启"),
    });
    expect(t.deliver).not.toHaveBeenCalled();
  });
  it("重复创建请求去重，不同内容不能复用同一标识", async () => {
    const t = await setup();
    const input = { agentId, clientMessageId: "one", text: "正文", delayMinutes: 1 };
    const [a, b] = await Promise.all([t.service.create(input), t.service.create(input)]);
    expect(a.id).toBe(b.id);
    await expect(t.service.create({ ...input, text: "另一条" })).rejects.toThrow("不同内容");
    expect(await t.service.list(agentId)).toHaveLength(1);
  });
  it("空消息和非法分钟数被明确拒绝，附件单独发送允许", async () => {
    const t = await setup();
    await expect(
      t.service.create({ agentId, clientMessageId: "one", text: "", delayMinutes: 1 }),
    ).rejects.toThrow("消息");
    await expect(
      t.service.create({ agentId, clientMessageId: "one", text: "正文", delayMinutes: 0 }),
    ).rejects.toThrow();
    await expect(
      t.service.create({ agentId, clientMessageId: "one", text: "正文", delayMinutes: 1.5 }),
    ).rejects.toThrow();
    expect(
      (
        await t.service.create({
          agentId,
          clientMessageId: "image",
          text: "",
          delayMinutes: 1,
          images: [{ data: "aW1hZ2U=", mimeType: "image/png" }],
        })
      ).imageCount,
    ).toBe(1);
  });
});
