import { afterEach, describe, expect, it } from "vitest";
import type { AttachmentMetadata, AttachmentStore } from "@/attachments/types";
import { __setAttachmentStoreForTests } from "@/attachments/store";
import { mergeResolvedProviderUserImages, resolveProviderUserImage } from "./provider-user-image";

function createStore(saved: AttachmentMetadata[]): AttachmentStore {
  return {
    storageType: "desktop-file",
    async save(input) {
      if (input.source.kind !== "file_uri") {
        throw new Error("预期收到提供方图片文件地址");
      }
      const metadata: AttachmentMetadata = {
        id: input.id ?? "missing-id",
        mimeType: input.mimeType ?? "image/jpeg",
        storageType: "desktop-file",
        storageKey: `C:/attachments/${input.id}.png`,
        createdAt: 1,
      };
      saved.push(metadata);
      return metadata;
    },
    async encodeBase64() {
      return "";
    },
    async resolvePreviewUrl() {
      return "file:///preview.png";
    },
    async delete() {},
    async garbageCollect() {},
  };
}

describe("提供方用户图片恢复", () => {
  afterEach(() => {
    __setAttachmentStoreForTests(null);
  });

  it("为同一历史源生成稳定标识，并在下次恢复时重新复制", async () => {
    const saved: AttachmentMetadata[] = [];
    __setAttachmentStoreForTests(createStore(saved));

    const image = { path: "C:/paseo-attachments/source.png", mimeType: "image/png" };
    const first = await resolveProviderUserImage(image);
    const second = await resolveProviderUserImage(image);

    expect(first.id).toMatch(/^provider_preview_/);
    expect(second.id).toBe(first.id);
    expect(saved.map((entry) => entry.id)).toEqual([first.id, second.id]);
  });

  it("用重新复制的元数据替换已经失效的同标识缓存", () => {
    const stale: AttachmentMetadata = {
      id: "provider_preview_same",
      mimeType: "image/png",
      storageType: "desktop-file",
      storageKey: "C:/attachments/provider_preview_same.png",
      createdAt: 1,
    };
    const restored = { ...stale, byteSize: 128, createdAt: 2 };

    expect(mergeResolvedProviderUserImages([stale], [restored])).toEqual([restored]);
  });
});
