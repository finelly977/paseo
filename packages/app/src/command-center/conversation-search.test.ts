import { describe, expect, it } from "vitest";
import { mergeConversationMatches, searchConversationSources } from "./conversation-search";
import type { CommandCenterAgentResult } from "./results";

function row(id: string, run: () => void): CommandCenterAgentResult {
  const time = new Date("2026-10-18T00:00:00Z");
  return {
    kind: "agent",
    id: `agent:host:${id}`,
    title: id,
    subtitle: "原副标题",
    run,
    agent: {
      id,
      serverId: "host",
      serverLabel: "本机",
      title: id,
      status: "idle",
      cwd: "E:\\paseo",
      provider: "codex",
      createdAt: time,
      lastActivityAt: time,
      archivedAt: null,
      labels: {},
    },
  };
}

describe("跨主机会话正文搜索", () => {
  it("相同会话标识按主机隔离，失败主机不会抹去其他主机的结果", async () => {
    const result = await searchConversationSources(
      [
        {
          serverId: "a",
          label: "本机",
          agentIds: ["same"],
          supported: true,
          client: { searchConversations: async () => [{ agentId: "same", snippet: "本机正文" }] },
        },
        {
          serverId: "b",
          label: "远程",
          agentIds: ["same"],
          supported: true,
          client: { searchConversations: async () => [{ agentId: "same", snippet: "远程正文" }] },
        },
        {
          serverId: "old",
          label: "旧主机",
          agentIds: ["x"],
          supported: false,
          client: {
            searchConversations: async () => {
              throw new Error("不应该调用不支持的接口");
            },
          },
        },
      ],
      "正文",
    );
    expect([...result.snippets.entries()]).toEqual([
      ["a:same", "本机正文"],
      ["b:same", "远程正文"],
    ]);
    expect(result.error).toBe("旧主机：请更新主机后使用会话正文搜索");
  });
  it("未连接的主机显示明确错误而不是假装没匹配", async () => {
    const result = await searchConversationSources(
      [{ serverId: "a", label: "本机", agentIds: ["one"], supported: true, client: null }],
      "正文",
    );
    expect([...result.snippets]).toEqual([]);
    expect(result.error).toBe("本机：主机未连接，无法搜索会话正文");
  });
  it("标题命中排在正文命中前，不重复会话，并保留原会话打开动作", () => {
    const opened: string[] = [];
    const title = row("title", () => opened.push("title"));
    const body = row("body", () => opened.push("body"));
    const result = mergeConversationMatches(
      [title],
      [body, title],
      new Map([
        ["host:title", "重复命中"],
        ["host:body", "历史部署记录"],
      ]),
    );
    expect(result.map((entry) => entry.id)).toEqual([title.id, body.id]);
    expect(result[1].subtitle).toBe("本机 · 历史部署记录");
    result[1].run();
    expect(opened).toEqual(["body"]);
  });
});
