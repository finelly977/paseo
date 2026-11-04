import { beforeEach, describe, expect, it } from "vitest";
import { isActiveCreateFlowForDraft, useCreateFlowStore } from "./create-flow-store";

describe("create-flow-store", () => {
  beforeEach(() => {
    useCreateFlowStore.setState({ pendingByDraftId: {} });
  });

  it("同一草稿只允许一个实际创建请求，不依赖组件是否已经重新渲染", () => {
    const attempt = {
      draftId: "draft-1",
      serverId: "server-1",
      agentId: null,
      clientMessageId: "msg-1",
      text: "创建会话",
      timestamp: 1000,
    };
    const store = useCreateFlowStore.getState();

    expect(store.beginRequest(attempt)).toBe(true);
    expect(store.beginRequest(attempt)).toBe(false);
    expect(store.beginRequest({ ...attempt, clientMessageId: "msg-2" })).toBe(false);
    expect(useCreateFlowStore.getState().pendingByDraftId["draft-1"].clientMessageId).toBe("msg-1");
  });

  it("跨页面交接的首条消息只领取一次，且保留预留工作区标识", () => {
    const prepared = {
      draftId: "draft-1",
      serverId: "server-1",
      workspaceId: "workspace-1",
      agentId: null,
      clientMessageId: "msg-1",
      text: "准备发送",
      timestamp: 1000,
    };
    const store = useCreateFlowStore.getState();

    expect(store.setPending(prepared)).toBe(true);
    expect(useCreateFlowStore.getState().pendingByDraftId["draft-1"].requestStarted).toBe(false);
    const { workspaceId: _workspaceId, ...request } = prepared;
    expect(store.beginRequest(request)).toBe(true);
    expect(store.beginRequest(request)).toBe(false);
    expect(store.setPending({ ...prepared, clientMessageId: "msg-2" })).toBe(false);
    expect(useCreateFlowStore.getState().pendingByDraftId["draft-1"]).toEqual({
      ...prepared,
      lifecycle: "active",
      requestStarted: true,
    });
  });

  it("创建失败后新尝试可领取，创建成功后不能再次领取", () => {
    const attempt = {
      draftId: "draft-1",
      serverId: "server-1",
      agentId: null,
      clientMessageId: "msg-1",
      text: "创建会话",
      timestamp: 1000,
    };
    const store = useCreateFlowStore.getState();

    expect(store.beginRequest(attempt)).toBe(true);
    store.markLifecycle({ draftId: "draft-1", lifecycle: "abandoned" });
    expect(store.beginRequest({ ...attempt, clientMessageId: "msg-2" })).toBe(true);
    store.updateAgentId({ draftId: "draft-1", agentId: "agent-1" });
    store.markLifecycle({ draftId: "draft-1", lifecycle: "sent" });
    expect(store.beginRequest({ ...attempt, clientMessageId: "msg-2" })).toBe(false);
    expect(store.beginRequest({ ...attempt, clientMessageId: "msg-3" })).toBe(false);
    expect(useCreateFlowStore.getState().pendingByDraftId["draft-1"].agentId).toBe("agent-1");
  });

  it("不同草稿即使提示词完全相同也各自创建，不按内容误去重", () => {
    const attempt = {
      draftId: "draft-1",
      serverId: "server-1",
      agentId: null,
      clientMessageId: "msg-1",
      text: "相同提示词",
      timestamp: 1000,
    };
    const store = useCreateFlowStore.getState();

    expect(store.beginRequest(attempt)).toBe(true);
    expect(store.beginRequest({ ...attempt, draftId: "draft-2", clientMessageId: "msg-2" })).toBe(
      true,
    );
  });

  it("tracks lifecycle transitions explicitly", () => {
    const store = useCreateFlowStore.getState();
    store.setPending({
      draftId: "draft-1",
      serverId: "server-1",
      agentId: null,
      clientMessageId: "msg-1",
      text: "hello",
      timestamp: Date.now(),
      images: [],
    });

    expect(useCreateFlowStore.getState().pendingByDraftId["draft-1"]?.lifecycle).toBe("active");

    useCreateFlowStore.getState().markLifecycle({ draftId: "draft-1", lifecycle: "abandoned" });
    expect(useCreateFlowStore.getState().pendingByDraftId["draft-1"]?.lifecycle).toBe("abandoned");
  });

  it("rekeys draft id idempotently", () => {
    useCreateFlowStore.getState().setPending({
      draftId: "draft-a",
      serverId: "server-1",
      agentId: null,
      clientMessageId: "msg-1",
      text: "hello",
      timestamp: Date.now(),
      images: [],
    });

    useCreateFlowStore.getState().rekeyDraft({
      fromDraftId: "draft-a",
      toDraftId: "draft-b",
    });
    useCreateFlowStore.getState().rekeyDraft({
      fromDraftId: "draft-a",
      toDraftId: "draft-b",
    });

    expect(useCreateFlowStore.getState().pendingByDraftId["draft-b"]?.draftId).toBe("draft-b");
  });

  it("supports multiple pending attempts", () => {
    useCreateFlowStore.getState().setPending({
      draftId: "draft-1",
      serverId: "server-1",
      agentId: null,
      clientMessageId: "msg-1",
      text: "one",
      timestamp: Date.now(),
    });
    useCreateFlowStore.getState().setPending({
      draftId: "draft-2",
      serverId: "server-1",
      agentId: null,
      clientMessageId: "msg-2",
      text: "two",
      timestamp: Date.now(),
    });

    const state = useCreateFlowStore.getState();
    expect(Object.keys(state.pendingByDraftId).sort()).toEqual(["draft-1", "draft-2"]);

    useCreateFlowStore.getState().clear({ draftId: "draft-1" });
    expect(useCreateFlowStore.getState().pendingByDraftId["draft-1"]).toBeUndefined();
  });

  it("clears pending handoff state by agent", () => {
    useCreateFlowStore.getState().setPending({
      draftId: "draft-1",
      serverId: "server-1",
      agentId: null,
      clientMessageId: "msg-1",
      text: "hello",
      timestamp: Date.now(),
    });
    useCreateFlowStore.getState().updateAgentId({ draftId: "draft-1", agentId: "agent-1" });
    useCreateFlowStore.getState().markLifecycle({ draftId: "draft-1", lifecycle: "sent" });

    useCreateFlowStore.getState().clearByAgent({ serverId: "server-1", agentId: "agent-1" });

    expect(useCreateFlowStore.getState().pendingByDraftId["draft-1"]).toBeUndefined();
  });

  it("matches only active pending create flows for a draft and server", () => {
    useCreateFlowStore.getState().setPending({
      draftId: "draft-1",
      serverId: "server-1",
      agentId: null,
      clientMessageId: "msg-1",
      text: "hello",
      timestamp: Date.now(),
    });
    const pending = useCreateFlowStore.getState().pendingByDraftId["draft-1"];

    expect(
      isActiveCreateFlowForDraft({
        pending,
        serverId: "server-1",
        draftId: " draft-1 ",
      }),
    ).toBe(true);
    expect(
      isActiveCreateFlowForDraft({
        pending,
        serverId: "server-2",
        draftId: "draft-1",
      }),
    ).toBe(false);

    useCreateFlowStore.getState().markLifecycle({ draftId: "draft-1", lifecycle: "sent" });
    expect(
      isActiveCreateFlowForDraft({
        pending: useCreateFlowStore.getState().pendingByDraftId["draft-1"],
        serverId: "server-1",
        draftId: "draft-1",
      }),
    ).toBe(false);
  });
});
