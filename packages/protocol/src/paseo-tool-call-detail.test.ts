import { describe, expect, it } from "vitest";

import { buildPaseoToolDetailSections } from "./paseo-tool-call-detail.js";

describe("Paseo tool-call detail presentation", () => {
  it.each(["mcp__paseo__create_agent", "paseo.create_agent", "paseo_remote.create_agent"])(
    "shares one create-agent mapping for %s",
    (toolName) => {
      expect(
        buildPaseoToolDetailSections(
          toolName,
          {
            workspaceId: "wks_123",
            provider: "codex/gpt-5.4",
            title: "Greeter",
            initialPrompt: "Say hello back.\nDo nothing else.",
            notifyOnFinish: true,
          },
          { agentId: "agt_123", status: "idle" },
        ),
      ).toEqual([
        {
          kind: "prose",
          title: "提示词",
          text: "Say hello back.\nDo nothing else.",
        },
        {
          kind: "fields",
          title: "详情",
          fields: [
            { key: "title", label: "标题", value: "Greeter" },
            { key: "provider", label: "智能体提供方", value: "codex/gpt-5.4" },
            { key: "workspaceId", label: "工作区", value: "wks_123" },
            { key: "notifyOnFinish", label: "完成时通知", value: "是" },
          ],
        },
        {
          kind: "fields",
          title: "结果",
          fields: [
            { key: "agentId", label: "智能体", value: "agt_123" },
            { key: "status", label: "状态", value: "idle" },
          ],
        },
      ]);
    },
  );

  it("formats schedule cadence and nested settings without JSON syntax", () => {
    const sections = buildPaseoToolDetailSections(
      "mcp__paseo__create_schedule",
      {
        prompt: "Say hello back.",
        cron: "0 9 * * 1",
        timezone: "Europe/Berlin",
        provider: "codex/gpt-5.4",
        maxRuns: 1,
      },
      {
        id: "sch_123",
        status: "active",
        nextRunAt: "2026-09-07T09:00:00.000Z",
        target: { type: "new-agent", mode: "read-only" },
      },
    );

    expect(sections?.slice(0, 2)).toMatchObject([
      { kind: "prose", title: "提示词", text: "Say hello back." },
      {
        kind: "fields",
        title: "详情",
        fields: [
          { key: "cron", label: "计划表达式", value: "0 9 * * 1" },
          { key: "timezone", label: "时区", value: "Europe/Berlin" },
          { key: "provider", label: "智能体提供方", value: "codex/gpt-5.4" },
          { key: "maxRuns", label: "最大运行次数", value: "1" },
        ],
      },
    ]);
    expect(JSON.stringify(sections)).not.toContain('\\"new-agent\\"');
    expect(sections?.at(-1)).toEqual({
      kind: "fields",
      title: "结果",
      fields: [
        { key: "id", label: "标识", value: "sch_123" },
        { key: "status", label: "状态", value: "active" },
        { key: "nextRunAt", label: "下次运行", value: "2026-09-07T09:00:00.000Z" },
      ],
    });
  });

  it("unwraps MCP result envelopes instead of exposing JSON-encoded text", () => {
    expect(
      buildPaseoToolDetailSections(
        "mcp__paseo__send_agent_prompt",
        { prompt: "Say hello back." },
        {
          meta: null,
          content: [
            {
              type: "text",
              text: '{"success":true,"status":"idle","lastMessage":"Hello back."}',
            },
          ],
          structuredContent: {
            success: true,
            status: "idle",
            lastMessage: "Hello back.",
          },
        },
      )?.at(-1),
    ).toEqual({
      kind: "fields",
      title: "结果",
      fields: [
        { key: "status", label: "状态", value: "idle" },
        { key: "lastMessage", label: "最后消息", value: "Hello back." },
      ],
    });
  });

  it("uses readable fallback fields for newly added Paseo tools", () => {
    expect(
      buildPaseoToolDetailSections(
        "mcp__paseo__future_tool",
        { opaqueThing: ["one", "two"], enabled: false },
        { success: true },
      ),
    ).toEqual([
      {
        kind: "fields",
        title: "详情",
        fields: [
          { key: "enabled", label: "启用", value: "否" },
          { key: "opaqueThing", label: "opaqueThing", value: "• one\n• two" },
        ],
      },
      {
        kind: "fields",
        title: "结果",
        fields: [{ key: "success", label: "成功", value: "是" }],
      },
    ]);
  });

  it("preserves a non-JSON MCP text result instead of reporting an empty result", () => {
    expect(
      buildPaseoToolDetailSections(
        "mcp__paseo__send_agent_prompt",
        {},
        {
          content: [{ type: "text", text: "provider returned non-JSON text" }],
        },
      )?.at(-1),
    ).toEqual({
      kind: "fields",
      title: "结果",
      fields: [{ key: "value", label: "值", value: "provider returned non-JSON text" }],
    });
  });

  it("leaves non-Paseo tools alone", () => {
    expect(buildPaseoToolDetailSections("mcp__github__create_issue", {}, {})).toBeNull();
  });
});
