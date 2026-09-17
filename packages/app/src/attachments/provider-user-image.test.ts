import { afterEach, describe, expect, it } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AttachmentMetadata, AttachmentStore } from "@/attachments/types";
import { __setAttachmentStoreForTests } from "@/attachments/store";
import { mergeResolvedProviderUserImages, resolveProviderUserImage } from "./provider-user-image";

function createStore(saved: AttachmentMetadata[]): AttachmentStore {
  return {
    storageType: "desktop-file",
    async save(input) {
      if (input.source.kind !== "bytes") {
        throw new Error("预期收到从远程主机读取的图片字节");
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

function createClient(reads: Array<{ cwd: string; path: string }>): Pick<DaemonClient, "readFile"> {
  return {
    async readFile(cwd, path) {
      reads.push({ cwd, path });
      return {
        bytes: new Uint8Array([1, 2, 3, 4]),
        mime: "image/png",
        size: 4,
        path,
        kind: "image",
        modifiedAt: "2026-09-17T00:00:00.000Z",
      };
    },
  };
}

describe("提供方用户图片恢复", () => {
  afterEach(() => {
    __setAttachmentStoreForTests(null);
  });

  it("为同一历史源生成稳定标识，并在下次恢复时重新复制", async () => {
    const saved: AttachmentMetadata[] = [];
    __setAttachmentStoreForTests(createStore(saved));
    const reads: Array<{ cwd: string; path: string }> = [];
    const client = createClient(reads);

    const image = {
      path: "/home/ubuntu/.paseo/paseo-attachments/source.png",
      mimeType: "image/png",
    };
    const first = await resolveProviderUserImage({ image, serverId: "ubuntu", client });
    const second = await resolveProviderUserImage({ image, serverId: "ubuntu", client });

    expect(first.id).toMatch(/^provider_preview_/);
    expect(second.id).toBe(first.id);
    expect(saved.map((entry) => entry.id)).toEqual([first.id, second.id]);
    expect(reads).toEqual([
      { cwd: image.path, path: "." },
      { cwd: image.path, path: "." },
    ]);
  });

  it("同一路径在不同远程主机上分别读取，不复用其他主机的图片", async () => {
    const saved: AttachmentMetadata[] = [];
    __setAttachmentStoreForTests(createStore(saved));
    const firstHostReads: Array<{ cwd: string; path: string }> = [];
    const secondHostReads: Array<{ cwd: string; path: string }> = [];
    const image = { path: "/home/ubuntu/.paseo/paseo-attachments/source.png" };

    await Promise.all([
      resolveProviderUserImage({
        image,
        serverId: "ubuntu-a",
        client: createClient(firstHostReads),
      }),
      resolveProviderUserImage({
        image,
        serverId: "ubuntu-b",
        client: createClient(secondHostReads),
      }),
    ]);

    expect(firstHostReads).toEqual([{ cwd: image.path, path: "." }]);
    expect(secondHostReads).toEqual([{ cwd: image.path, path: "." }]);
    expect(saved[0]?.id).not.toBe(saved[1]?.id);
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
