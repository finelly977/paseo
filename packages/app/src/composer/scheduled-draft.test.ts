import { describe, expect, it } from "vitest";
import type { ScheduledAgentMessageSummary } from "@getpaseo/protocol/messages";
import type { AttachmentMetadata } from "@/attachments/types";
import { prepareScheduledDraft, appendRestoredScheduledText } from "./scheduled-draft";
import { splitComposerAttachmentsForSubmit } from "./attachments/submit";
import { UserComposerAttachmentSchema } from "@/stores/draft-store/state";

const image: AttachmentMetadata = {
  id: "image",
  mimeType: "image/png",
  storageType: "web-indexeddb",
  storageKey: "image",
  createdAt: 0,
};
const message: ScheduledAgentMessageSummary = {
  id: "test-message",
  agentId: "agent",
  clientMessageId: "client",
  text: "定时正文",
  imageCount: 1,
  attachmentCount: 1,
  sendAt: "2026-10-12T00:00:00Z",
  createdAt: "2026-10-12T00:00:00Z",
  updatedAt: "2026-10-12T00:00:00Z",
  status: "waiting",
  error: null,
  restore: {
    images: [{ path: "/host/image.png", mimeType: "image/png" }],
    attachments: [{ type: "text", text: "完整上下文", mimeType: "text/plain", title: "引用" }],
  },
};
describe("定时消息恢复", () => {
  it("下载图片并保留完整附件，恢复后可以持久保存和再次发送", async () => {
    const restored = await prepareScheduledDraft(message, async (value) => {
      expect(value).toEqual({ path: "/host/image.png", mimeType: "image/png" });
      return image;
    });
    expect(restored.text).toBe(message.text);
    expect(restored.attachments.map((a) => UserComposerAttachmentSchema.parse(a))).toEqual(
      restored.attachments,
    );
    expect(splitComposerAttachmentsForSubmit(restored.attachments)).toEqual({
      images: [image],
      attachments: message.restore?.attachments,
    });
  });
  it("图片读取失败明确报错，不交付缺少图片的草稿", async () => {
    await expect(
      prepareScheduledDraft(message, async () => {
        throw new Error("图片读取失败");
      }),
    ).rejects.toThrow("图片读取失败");
  });
  it("旧主机没有完整附件时明确要求更新，不能静默丢弃附件", async () => {
    await expect(
      prepareScheduledDraft({ ...message, restore: undefined }, async () => image),
    ).rejects.toThrow("请更新主机");
  });
  it("恢复定时正文时保留输入框已有的新草稿", () => {
    expect(appendRestoredScheduledText("新草稿", "定时正文")).toBe("新草稿\n\n定时正文");
    expect(appendRestoredScheduledText("", "定时正文")).toBe("定时正文");
    expect(appendRestoredScheduledText("新草稿", "")).toBe("新草稿");
  });
});
