import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import {
  AgentMessageScheduleRequestSchema,
  ScheduledAgentMessageRecordSchema,
  type ScheduledAgentMessageRecord,
  type ScheduledAgentMessageSummary,
} from "@getpaseo/protocol/messages";
import type { z } from "zod";
import equal from "fast-deep-equal";
import { writeJsonFileAtomic } from "../atomic-file.js";
import { materializeProviderImage } from "../agent/providers/provider-image-output.js";

type ScheduleMessageInput = Omit<
  z.infer<typeof AgentMessageScheduleRequestSchema>,
  "type" | "requestId"
>;
interface ScheduledMessagesOptions {
  paseoHome: string;
  logger: Logger;
  canSend: (agentId: string) => Promise<boolean>;
  deliver: (message: ScheduledAgentMessageRecord) => Promise<void>;
  now?: () => Date;
}

function summarize(message: ScheduledAgentMessageRecord): ScheduledAgentMessageSummary {
  const { images, attachments, ...summary } = message;
  return { ...summary, imageCount: images.length, attachmentCount: attachments.length };
}

// 定时消息是用户输入，而非计划任务系统提示；由主机持久保存，独立于页面和连接生命周期。
export class ScheduledAgentMessages {
  private readonly directory: string;
  private readonly now: () => Date;
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeTick: Promise<void> | null = null;
  private deliveringIds = new Set<string>();
  private deliveringAgentIds = new Set<string>();
  private creations = new Map<string, Promise<ScheduledAgentMessageSummary>>();
  private cachedRecords = new Map<string, ScheduledAgentMessageRecord>();
  constructor(private readonly options: ScheduledMessagesOptions) {
    this.directory = join(options.paseoHome, "scheduled-messages");
    this.now = options.now ?? (() => new Date());
  }
  async start(): Promise<void> {
    if (this.timer !== null) return;
    this.cachedRecords.clear();
    await mkdir(this.directory, { recursive: true });
    for (const message of await this.records()) {
      this.cachedRecords.set(message.id, message);
      if (message.status === "sending") {
        await this.save({
          ...message,
          status: "failed",
          error: "主机在发送过程中重启，请确认消息是否已送达后重试",
        });
      }
    }
    this.timer = setInterval(() => {
      void this.tick().catch((error) =>
        this.options.logger.error({ err: error }, "Scheduled message tick failed"),
      );
    }, 1000);
    this.timer.unref();
  }
  async stop(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.activeTick !== null) await this.activeTick;
  }
  create(input: ScheduleMessageInput): Promise<ScheduledAgentMessageSummary> {
    const key = `${input.agentId}:${input.clientMessageId}`;
    const existing = this.creations.get(key);
    if (existing) return existing;
    const pending = this.createRecord(input).finally(() => this.creations.delete(key));
    this.creations.set(key, pending);
    return pending;
  }
  private async createRecord(raw: ScheduleMessageInput): Promise<ScheduledAgentMessageSummary> {
    const input = AgentMessageScheduleRequestSchema.parse({
      ...raw,
      type: "agent.message.schedule.request",
      requestId: "scheduled-message",
    });
    if (!input.text.trim() && !input.images?.length && !input.attachments?.length)
      throw new Error("请输入消息或添加附件");
    await this.options.canSend(input.agentId);
    const now = this.now();
    const images = (input.images ?? []).map((image) => ({
      path: materializeProviderImage({ ...image, paseoHome: this.options.paseoHome }).path,
      mimeType: image.mimeType,
    }));
    const existing = (await this.records()).find(
      (message) =>
        message.agentId === input.agentId && message.clientMessageId === input.clientMessageId,
    );
    if (existing) {
      if (
        existing.text !== input.text.trim() ||
        !equal(existing.images, images) ||
        !equal(existing.attachments, input.attachments ?? [])
      )
        throw new Error("相同消息标识对应不同内容，请重新创建定时消息");
      return summarize(existing);
    }
    const record: ScheduledAgentMessageRecord = {
      id: randomUUID(),
      agentId: input.agentId,
      clientMessageId: input.clientMessageId,
      text: input.text.trim(),
      images,
      attachments: input.attachments ?? [],
      status: "waiting",
      error: null,
      sendAt: new Date(now.getTime() + input.delayMinutes * 60_000).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await this.save(record);
    return summarize(record);
  }
  async list(agentId: string): Promise<ScheduledAgentMessageSummary[]> {
    return (await this.records())
      .filter(
        (message) =>
          message.agentId === agentId && ["waiting", "sending", "failed"].includes(message.status),
      )
      .sort((a, b) => a.sendAt.localeCompare(b.sendAt))
      .map(summarize);
  }
  async cancel(agentId: string, id: string): Promise<ScheduledAgentMessageSummary> {
    if (this.deliveringIds.has(id)) throw new Error("消息正在发送，无法取消");
    this.deliveringIds.add(id);
    try {
      const message = await this.requireRecord(agentId, id);
      if (message.status === "sent") throw new Error("消息已经发送");
      return summarize(await this.save({ ...message, status: "cancelled", error: null }));
    } finally {
      this.deliveringIds.delete(id);
    }
  }
  async sendNow(agentId: string, id: string): Promise<ScheduledAgentMessageSummary> {
    if (this.deliveringIds.has(id)) throw new Error("消息正在发送，请勿重复操作");
    this.deliveringIds.add(id);
    let waiting: ScheduledAgentMessageRecord;
    try {
      const message = await this.requireRecord(agentId, id);
      if (message.status === "cancelled" || message.status === "sent")
        throw new Error("消息已发送或取消");
      waiting = await this.save({
        ...message,
        status: "waiting",
        error: null,
        sendAt: this.now().toISOString(),
        // 失败后的手动重试属于新的用户派发，不复用可能已被提供方接受的旧标识。
        clientMessageId: message.status === "failed" ? randomUUID() : message.clientMessageId,
      });
    } finally {
      this.deliveringIds.delete(id);
    }
    await this.deliver(waiting);
    return summarize(await this.requireRecord(agentId, id));
  }
  tick(): Promise<void> {
    if (this.activeTick !== null) return this.activeTick;
    const pending = this.drain().finally(() => {
      this.activeTick = null;
    });
    this.activeTick = pending;
    return pending;
  }
  private async drain(): Promise<void> {
    const due = (await this.records())
      .filter(
        (message) =>
          message.status === "waiting" && Date.parse(message.sendAt) <= this.now().getTime(),
      )
      .sort((a, b) => a.sendAt.localeCompare(b.sendAt));
    for (const message of due) await this.deliver(message);
  }
  private async deliver(message: ScheduledAgentMessageRecord): Promise<void> {
    if (this.deliveringIds.has(message.id) || this.deliveringAgentIds.has(message.agentId)) return;
    this.deliveringIds.add(message.id);
    this.deliveringAgentIds.add(message.agentId);
    try {
      const current = await this.requireRecord(message.agentId, message.id);
      if (current.status !== "waiting") return;
      if (!(await this.options.canSend(current.agentId))) return;
      await this.save({ ...current, status: "sending", error: null });
      await this.options.deliver(current);
      await this.save({ ...current, status: "sent", error: null });
    } catch (error) {
      this.options.logger.error(
        { err: error, messageId: message.id, agentId: message.agentId },
        "Scheduled message delivery failed",
      );
      await this.save({
        ...message,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.deliveringIds.delete(message.id);
      this.deliveringAgentIds.delete(message.agentId);
    }
  }
  private async requireRecord(agentId: string, id: string): Promise<ScheduledAgentMessageRecord> {
    // 标识只能来自本服务生成的 UUID，不能成为可控制的文件路径。
    const validId = ScheduledAgentMessageRecordSchema.shape.id.parse(id);
    const cached = this.cachedRecords.get(validId);
    const message =
      cached ??
      ScheduledAgentMessageRecordSchema.parse(
        JSON.parse(await readFile(join(this.directory, `${validId}.json`), "utf8")),
      );
    if (message.agentId !== agentId) throw new Error("定时消息不属于当前会话");
    return message;
  }
  private async records(): Promise<ScheduledAgentMessageRecord[]> {
    if (this.timer !== null) return [...this.cachedRecords.values()];
    await mkdir(this.directory, { recursive: true });
    const files = (await readdir(this.directory)).filter((name) => name.endsWith(".json"));
    return Promise.all(
      files.map(async (file) =>
        ScheduledAgentMessageRecordSchema.parse(
          JSON.parse(await readFile(join(this.directory, file), "utf8")),
        ),
      ),
    );
  }
  private async save(message: ScheduledAgentMessageRecord): Promise<ScheduledAgentMessageRecord> {
    const updated = ScheduledAgentMessageRecordSchema.parse({
      ...message,
      updatedAt: this.now().toISOString(),
    });
    await writeJsonFileAtomic(join(this.directory, `${updated.id}.json`), updated);
    this.cachedRecords.set(updated.id, updated);
    return updated;
  }
}
