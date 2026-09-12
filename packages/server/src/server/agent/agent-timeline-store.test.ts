import { describe, expect, it } from "vitest";
import { InMemoryAgentTimelineStore } from "./agent-timeline-store.js";

describe("InMemoryAgentTimelineStore", () => {
  it("根据权威消息或客户端标识解析原生标识，不按正文猜测", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent-1");
    store.append(
      "agent-1",
      {
        type: "user_message",
        text: "继续",
        messageId: "message-1",
        clientMessageId: "client-1",
      },
      { providerMessageId: "native-1" },
    );
    store.append(
      "agent-1",
      {
        type: "user_message",
        text: "继续",
        messageId: "message-2",
        clientMessageId: "client-2",
      },
      { providerMessageId: "native-2" },
    );

    expect(store.resolveProviderMessageId("agent-1", "message-1")).toBe("native-1");
    expect(store.resolveProviderMessageId("agent-1", "client-1")).toBe("native-1");
    expect(store.resolveProviderMessageId("agent-1", "message-2")).toBe("native-2");
  });

  it("标识映射只在目标会话内查找", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent-1");
    store.initialize("agent-2");
    store.append(
      "agent-1",
      { type: "user_message", text: "相同输入", messageId: "client-1" },
      { providerMessageId: "native-1" },
    );
    store.append(
      "agent-2",
      { type: "user_message", text: "相同输入", messageId: "client-1" },
      { providerMessageId: "native-2" },
    );

    expect(store.resolveProviderMessageId("agent-1", "client-1")).toBe("native-1");
    expect(store.resolveProviderMessageId("agent-2", "client-1")).toBe("native-2");
  });

  it("直接使用原生标识的旧消息和未确认消息不被替换成其他目标", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent-1", {
      items: [
        {
          type: "user_message",
          text: "旧消息",
          messageId: "native-1",
          clientMessageId: "client-1",
        },
        { type: "user_message", text: "待确认", messageId: "pending", clientMessageId: "pending" },
      ],
    });

    expect(store.resolveProviderMessageId("agent-1", "client-1")).toBe("native-1");
    expect(store.resolveProviderMessageId("agent-1", "native-1")).toBe("native-1");
    expect(store.resolveProviderMessageId("agent-1", "pending")).toBe("pending");
    expect(store.resolveProviderMessageId("agent-1", "unknown")).toBe("unknown");
  });

  it("returns a bounded reset window when an after cursor is behind retained history", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent-1", {
      epoch: "epoch-1",
      nextSeq: 8,
      rows: [
        {
          seq: 5,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: { type: "assistant_message", text: "five" },
        },
        {
          seq: 6,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: { type: "assistant_message", text: "six" },
        },
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven" },
        },
      ],
    });

    const result = store.fetch("agent-1", {
      direction: "after",
      cursor: { epoch: "epoch-1", seq: 1 },
      limit: 1,
    });

    expect(result).toEqual({
      epoch: "epoch-1",
      direction: "after",
      reset: true,
      staleCursor: false,
      gap: true,
      window: { minSeq: 5, maxSeq: 7, nextSeq: 8 },
      hasOlder: true,
      hasNewer: false,
      rows: [
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven" },
        },
      ],
    });
  });
});
