import { describe, expect, it, vi } from "vitest";
import { createExplorerRefreshQueue } from "./refresh-queue";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("createExplorerRefreshQueue", () => {
  it("正在刷新时收到的新变化会在本轮结束后再次刷新", async () => {
    const firstRefresh = deferred();
    const refresh = vi
      .fn<(isCurrent: () => boolean) => Promise<void>>()
      .mockImplementationOnce(async () => await firstRefresh.promise)
      .mockResolvedValue(undefined);
    const queue = createExplorerRefreshQueue({ refresh, onError: vi.fn() });

    queue.request();
    queue.request();
    expect(refresh).toHaveBeenCalledTimes(1);

    firstRefresh.resolve();

    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });

  it("旧订阅的刷新卡住时不会阻塞新订阅", async () => {
    const stalledRefresh = deferred();
    const oldQueue = createExplorerRefreshQueue({
      refresh: async () => await stalledRefresh.promise,
      onError: vi.fn(),
    });
    const newRefresh = vi.fn(async () => {});

    oldQueue.request();
    oldQueue.dispose();
    const newQueue = createExplorerRefreshQueue({ refresh: newRefresh, onError: vi.fn() });
    newQueue.request();

    await vi.waitFor(() => expect(newRefresh).toHaveBeenCalledOnce());
    stalledRefresh.resolve();
  });

  it("释放订阅后不会继续处理已排队的刷新", async () => {
    const firstRefresh = deferred();
    const refresh = vi.fn(async () => await firstRefresh.promise);
    const queue = createExplorerRefreshQueue({ refresh, onError: vi.fn() });

    queue.request();
    queue.request();
    queue.dispose();
    firstRefresh.resolve();
    await firstRefresh.promise;
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledOnce();
  });
});
