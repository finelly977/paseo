import { describe, expect, it } from "vitest";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { searchConversations } from "./conversation-search.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileAgentTimelineStore } from "./file-agent-timeline-store.js";

describe("会话正文搜索", () => {
  it("从磁盘恢复未在前端加载的历史正文，不启动智能体", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "paseo-conversation-search-"));
    try {
      const store = new FileAgentTimelineStore(directory);
      await store.bulkInsert("history", [
        {
          seq: 1,
          timestamp: "2026-01-01T00:00:00Z",
          item: { type: "user_message", text: "很早之前的部署记录 7511" },
        },
      ]);
      const reopened = new FileAgentTimelineStore(directory);
      const hits = await searchConversations({
        agentIds: ["history"],
        query: "部署 7511",
        limit: 100,
        cancelled: () => false,
        readMessages: async (id) => (await reopened.getCommittedRows(id)).map((row) => row.item),
      });
      expect(hits).toEqual([{ agentId: "history", snippet: "很早之前的部署记录 7511" }]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
  it("搜索已保存的旧正文，大小写及全角字符统一，按会话去重", async () => {
    const messages: Record<string, AgentTimelineItem[]> = {
      old: [
        { type: "user_message", text: "之前讨论过 ＡＰＩ 接入与权限" },
        { type: "assistant_message", text: "api 接入已经完成" },
      ],
      other: [
        { type: "reasoning", text: "API 接入" },
        { type: "error", message: "API 接入" },
      ],
    };
    const hits = await searchConversations({
      agentIds: ["old", "other"],
      query: "api 接入",
      readMessages: async (id) => messages[id],
      limit: 100,
      cancelled: () => false,
    });
    expect(hits).toEqual([{ agentId: "old", snippet: "api 接入已经完成" }]);
  });
  it("保留可见会话顺序、限制结果，并在过时请求取消后停止读取", async () => {
    const reads: string[] = [];
    const hits = await searchConversations({
      agentIds: ["a", "b", "c"],
      query: "正文",
      limit: 1,
      cancelled: () => false,
      readMessages: async (id) => {
        reads.push(id);
        return [{ type: "assistant_message", text: `正文 ${id}` }];
      },
    });
    expect(hits).toEqual([{ agentId: "a", snippet: "正文 a" }]);
    expect(reads.length).toBeLessThanOrEqual(2);
    const cancelledReads: string[] = [];
    expect(
      await searchConversations({
        agentIds: ["a"],
        query: "正文",
        limit: 100,
        cancelled: () => true,
        readMessages: async (id) => {
          cancelledReads.push(id);
          return [];
        },
      }),
    ).toEqual([]);
    expect(cancelledReads).toEqual([]);
  });
  it("读取历史失败会显式失败，而不是显示没有搜索结果", async () => {
    await expect(
      searchConversations({
        agentIds: ["broken"],
        query: "历史",
        limit: 100,
        cancelled: () => false,
        readMessages: () => Promise.reject(new Error("持久历史损坏")),
      }),
    ).rejects.toThrow("持久历史损坏");
  });
});
