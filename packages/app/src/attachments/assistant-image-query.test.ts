import { afterEach, describe, expect, it } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { createLocalFileAttachmentStore } from "./local-file-attachment-store";
import { createTestAttachmentFileSystem } from "./test-attachment-file-system";
import { __setAttachmentStoreForTests } from "./store";
import { garbageCollectAttachments } from "./service";
import {
  assistantFileImageQueryOptions,
  assistantDataImageQueryOptions,
  collectAssistantImageAttachmentIds,
} from "./assistant-image-query";
import { parseImageDataUrl } from "./utils";

function setup() {
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false } },
  });
  const files = createTestAttachmentFileSystem();
  __setAttachmentStoreForTests(
    createLocalFileAttachmentStore({
      storageType: "native-file",
      baseDirectoryName: "images",
      fileSystem: files,
      resolvePreviewUrl: async (attachment) => `file://${attachment.storageKey}`,
    }),
  );
  let reads = 0;
  const client: Pick<DaemonClient, "readFile"> = {
    async readFile(cwd, imagePath) {
      reads += 1;
      return {
        path: `${cwd}/${imagePath}`,
        kind: "image",
        mime: "image/png",
        bytes: new Uint8Array([1, 2, 3]),
        size: 3,
        modifiedAt: "2026-10-20T00:00:00.000Z",
      };
    },
  };
  return { queries, files, client, readCount: () => reads };
}

describe("助手历史图片预览缓存", () => {
  afterEach(() => __setAttachmentStoreForTests(null));

  it("附件清理保留查询拥有的预览，查询释放后允许回收", async () => {
    const { queries, files, client } = setup();
    const options = assistantFileImageQueryOptions({
      serverId: "host",
      client,
      target: { cwd: "/repo", path: "image.png" },
    });
    const attachment = await queries.fetchQuery(options);
    const ids = new Set<string>();
    collectAssistantImageAttachmentIds(queries, ids);
    await garbageCollectAttachments({ referencedIds: ids });
    expect(files.files.get(`file://${attachment.storageKey}`)).toEqual(new Uint8Array([1, 2, 3]));
    queries.clear();
    const releasedIds = new Set<string>();
    collectAssistantImageAttachmentIds(queries, releasedIds);
    await garbageCollectAttachments({ referencedIds: releasedIds });
    expect(files.files.size).toBe(0);
  });

  it("重新打开时重读所属主机，重建已经被系统清理的本地副本", async () => {
    const { queries, files, client, readCount } = setup();
    const options = assistantFileImageQueryOptions({
      serverId: "host",
      client,
      target: { cwd: "/repo", path: "image.png" },
    });
    const original = await queries.fetchQuery(options);
    await garbageCollectAttachments({ referencedIds: new Set() });
    expect(files.files.size).toBe(0);
    const observer = new QueryObserver(queries, options);
    const done = new Promise<void>((resolve, reject) => {
      const unsubscribe = observer.subscribe((result) => {
        if (result.isFetching) return;
        unsubscribe();
        if (result.isError) reject(result.error);
        else resolve();
      });
    });
    await done;
    expect(readCount()).toBe(2);
    expect(files.files.get(`file://${original.storageKey}`)).toEqual(new Uint8Array([1, 2, 3]));
    queries.clear();
  });

  it("不同主机的同名图片不共享副本标识", async () => {
    const { queries, client } = setup();
    const target = { cwd: "/repo", path: "image.png" };
    const a = await queries.fetchQuery(
      assistantFileImageQueryOptions({ serverId: "a", client, target }),
    );
    const b = await queries.fetchQuery(
      assistantFileImageQueryOptions({ serverId: "b", client, target }),
    );
    expect(a.id).not.toBe(b.id);
    queries.clear();
  });

  it("同样长度的不同内嵌图片不互相覆盖", () => {
    const first = "data:image/png;base64,YWJj";
    const second = "data:image/png;base64,ZGVm";
    const a = assistantDataImageQueryOptions({
      source: first,
      dataImage: parseImageDataUrl(first),
    });
    const b = assistantDataImageQueryOptions({
      source: second,
      dataImage: parseImageDataUrl(second),
    });
    expect(a.meta).not.toEqual(b.meta);
  });

  it("读取尚未结束时也保留预览标识，防止刚写入的图片被回收", async () => {
    const { queries, client } = setup();
    let finishRead: () => void = () => {
      throw new Error("尚未开始读取");
    };
    const wait = new Promise<void>((resolve) => {
      finishRead = resolve;
    });
    const delayedClient: Pick<DaemonClient, "readFile"> = {
      async readFile(cwd, path) {
        await wait;
        return client.readFile(cwd, path);
      },
    };
    const pending = queries.fetchQuery(
      assistantFileImageQueryOptions({
        serverId: "host",
        client: delayedClient,
        target: { cwd: "/repo", path: "image.png" },
      }),
    );
    const ids = new Set<string>();
    collectAssistantImageAttachmentIds(queries, ids);
    expect(ids.size).toBe(1);
    finishRead();
    const attachment = await pending;
    expect([...ids]).toEqual([attachment.id]);
    queries.clear();
  });

  it("原图缺失时明确报错，恢复原图后可以重新读取", async () => {
    const { queries, client, files } = setup();
    let available = false;
    const missingClient: Pick<DaemonClient, "readFile"> = {
      async readFile(cwd, path) {
        if (!available) throw new Error("原始图片文件不存在");
        return client.readFile(cwd, path);
      },
    };
    const options = assistantFileImageQueryOptions({
      serverId: "host",
      client: missingClient,
      target: { cwd: "/repo", path: "image.png" },
    });
    await expect(queries.fetchQuery(options)).rejects.toThrow("原始图片文件不存在");
    expect(files.files.size).toBe(0);
    available = true;
    const attachment = await queries.fetchQuery(options);
    expect(files.files.get(`file://${attachment.storageKey}`)).toEqual(new Uint8Array([1, 2, 3]));
    queries.clear();
  });
});
