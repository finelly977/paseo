import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { AgentProfile } from "@getpaseo/protocol/messages";
import { describe, expect, it } from "vitest";
import { buildAgentProfileSummaryTags, resolveAgentProfileDisplayName } from "./profile-summary";

const ENTRIES: ProviderSnapshotEntry[] = [
  {
    provider: "codex",
    label: "Codex",
    status: "ready",
    enabled: true,
    models: [
      {
        provider: "codex",
        id: "gpt-6-astra",
        label: "GPT-6 Astra",
        isDefault: true,
      },
    ],
  },
];

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "profile-1",
    name: "",
    provider: "codex",
    model: "gpt-6-astra",
    ...overrides,
  };
}

describe("Agent 配置显示名称", () => {
  it("优先显示用户设置的名称", () => {
    expect(
      resolveAgentProfileDisplayName({
        profile: profile({ name: "  代码审查  " }),
        entries: ENTRIES,
      }),
    ).toBe("代码审查");
  });

  it("名称留空时使用模型目录中的友好名称", () => {
    expect(resolveAgentProfileDisplayName({ profile: profile(), entries: ENTRIES })).toBe(
      "GPT-6 Astra",
    );
  });

  it("模型目录不可用时回退到模型 ID", () => {
    expect(resolveAgentProfileDisplayName({ profile: profile(), entries: undefined })).toBe(
      "gpt-6-astra",
    );
  });

  it("自动名称已经使用模型时不在摘要中重复模型", () => {
    const tags = buildAgentProfileSummaryTags({
      profile: profile({ modeId: "read-only" }),
      entries: ENTRIES,
      formatFeatureCount: (count) => `${count}`,
    });

    expect(tags.map((tag) => tag.id)).toEqual(["provider", "mode"]);
  });
});
