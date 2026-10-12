import type { ScheduledAgentMessageSummary } from "@getpaseo/protocol/messages";
import type { AttachmentMetadata, UserComposerAttachment } from "@/attachments/types";

export interface RestoredScheduledDraft {
  text: string;
  attachments: UserComposerAttachment[];
}

export async function prepareScheduledDraft(
  message: ScheduledAgentMessageSummary,
  resolveImage: (image: { path: string; mimeType: string }) => Promise<AttachmentMetadata>,
): Promise<RestoredScheduledDraft> {
  if (!message.restore) throw new Error("请更新主机后再取消发送，以便安全恢复正文和附件");
  // 先将所有图片存回客户端；任何下载失败都不会取消主机上的消息。
  const images = await Promise.all(message.restore.images.map(resolveImage));
  return {
    text: message.text,
    attachments: [
      ...images.map((metadata): UserComposerAttachment => ({ kind: "image", metadata })),
      ...message.restore.attachments.map(
        (attachment, index): UserComposerAttachment => ({
          kind: "restored",
          id: `${message.id}:${index}`,
          attachment,
        }),
      ),
    ],
  };
}

export function appendRestoredScheduledText(current: string, restored: string): string {
  if (!current.trim()) return restored;
  if (!restored) return current;
  return `${current}\n\n${restored}`;
}
