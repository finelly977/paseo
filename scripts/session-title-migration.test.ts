import { expect, test } from "vitest";
import { parseStoredAgentRecord } from "../packages/server/src/server/agent/agent-storage.js";
import { planSessionTitleMigration } from "./session-title-migration.mjs";

function record(id: string, title: string) {
  return parseStoredAgentRecord({
    id,
    title,
    provider: "codex",
    cwd: "/repo",
    workspaceId: "workspace",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    persistence: { provider: "codex", sessionId: "native" },
  });
}

test("迁移保留的会话旧名，不采用工作区名称，并跳过已迁移记录", () => {
  const a = record("a", "原生最新名");
  a.titleSync = { source: "native", legacyTitle: "Paseo 原名", migrated: false };
  const b = record("b", "已迁移");
  b.titleSync = { source: "native", legacyTitle: "不再使用", migrated: true };
  expect(planSessionTitleMigration([a, b])).toEqual([
    {
      agentId: "a",
      provider: "codex",
      sessionId: "native",
      title: "Paseo 原名",
      status: "pending",
    },
  ]);
});

test("同一原生会话存在不同 Paseo 名称时明确标记冲突", () => {
  expect(
    planSessionTitleMigration([record("a", "名称一"), record("b", "名称二")]).map(
      (row) => row.status,
    ),
  ).toEqual(["conflict", "conflict"]);
});
