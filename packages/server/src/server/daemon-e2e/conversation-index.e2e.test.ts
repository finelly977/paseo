import { expect, test } from "vitest";
import { createDaemonTestContext } from "../test-utils/index.js";

test("索引版本相同的补页不重复传输索引，新增对话后重新返回完整索引", async () => {
  const ctx = await createDaemonTestContext();
  try {
    const agent = await ctx.client.createAgent({
      provider: "codex",
      cwd: ctx.daemon.paseoHome,
      modeId: "full-access",
    });
    const manager = ctx.daemon.daemon.agentManager;
    await manager.appendTimelineItem(agent.id, { type: "user_message", text: "第一轮" });
    await manager.appendTimelineItem(agent.id, { type: "assistant_message", text: "回答" });
    const first = await ctx.client.fetchAgentTimeline(agent.id, { direction: "tail", limit: 1 });
    expect(first.conversationIndex).toHaveLength(1);
    expect(first.conversationIndexVersion).toEqual(expect.any(String));
    const known = first.conversationIndexVersion;
    const unchanged = await ctx.client.fetchAgentTimeline(agent.id, {
      direction: "tail",
      limit: 1,
      conversationIndexVersion: known,
    });
    expect(unchanged.conversationIndex).toBeUndefined();
    expect(unchanged.conversationIndexVersion).toBe(known);
    expect(unchanged.entries).toEqual(first.entries);
    await manager.appendTimelineItem(agent.id, { type: "user_message", text: "第二轮" });
    const changed = await ctx.client.fetchAgentTimeline(agent.id, {
      conversationIndexVersion: known,
    });
    expect(changed.conversationIndexVersion).not.toBe(known);
    expect(changed.conversationIndex?.map((entry) => entry.text)).toEqual(["第一轮", "第二轮"]);
    const withoutCache = await ctx.client.fetchAgentTimeline(agent.id);
    expect(withoutCache.conversationIndex).toEqual(changed.conversationIndex);
  } finally {
    await ctx.cleanup();
  }
});
