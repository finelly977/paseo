import { expect, test } from "vitest";
import { runConversationRewind } from "./rewind-operation";
import { restoreComposerDraftIfEmpty } from "./composer-restore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("服务端确认后立即回填，历史读取未结束也可完成撤回交互", async () => {
  const request = deferred<void>();
  const history = deferred<void>();
  const events: string[] = [];
  const task = runConversationRewind({
    rewind: () => {
      events.push("请求");
      return request.promise;
    },
    apply: () => {
      events.push("回填");
    },
    refreshTimeline: () => {
      events.push("刷新");
      return history.promise;
    },
    onRefreshError: (error) => {
      throw error;
    },
  });
  expect(events).toEqual(["请求"]);
  request.resolve();
  await task;
  expect(events).toEqual(["请求", "回填", "刷新"]);
  history.resolve();
});

test("撤回失败不改写输入框，也不启动后续历史刷新", async () => {
  const failure = new Error("原生撤回失败");
  const events: string[] = [];
  await expect(
    runConversationRewind({
      rewind: async () => {
        throw failure;
      },
      apply: () => {
        events.push("回填");
      },
      refreshTimeline: async () => {
        events.push("刷新");
      },
      onRefreshError: (error) => {
        throw error;
      },
    }),
  ).rejects.toBe(failure);
  expect(events).toEqual([]);
});

test.each([false, true])(
  "历史刷新失败单独报告，保留已回填的正文（同步异常=%s）",
  async (synchronous) => {
    const failure = new Error("历史读取失败");
    const reported = deferred<unknown>();
    let draft = "";
    await runConversationRewind({
      rewind: async () => undefined,
      apply: () => {
        draft = "撤回的消息";
      },
      refreshTimeline: () => {
        if (synchronous) throw failure;
        return Promise.reject(failure);
      },
      onRefreshError: (error) => reported.resolve(error),
    });
    expect(await reported.promise).toBe(failure);
    expect(draft).toBe("撤回的消息");
  },
);

test("等待撤回确认时输入的新草稿不会被回填覆盖", async () => {
  const request = deferred<void>();
  let draft = "";
  const task = runConversationRewind({
    rewind: () => request.promise,
    apply: () => {
      draft = restoreComposerDraftIfEmpty({
        currentText: draft,
        currentAttachments: [],
        rewoundText: "旧消息",
        rewoundAttachments: [],
      }).text;
    },
    refreshTimeline: async () => undefined,
    onRefreshError: (error) => {
      throw error;
    },
  });
  draft = "保留新草稿";
  request.resolve();
  await task;
  expect(draft).toBe("保留新草稿");
});
