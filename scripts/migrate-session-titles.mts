import type { DaemonClient } from "../packages/client/src/daemon-client.js";
import { writeJsonFileAtomic } from "../packages/server/src/server/atomic-file.js";
import { parseArgs } from "node:util";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { connectToDaemon } from "../packages/cli/src/utils/client.js";
import { parseStoredAgentRecord } from "../packages/server/src/server/agent/agent-storage.js";
import {
  planSessionTitleMigration,
  type SessionTitleMigration,
} from "./session-title-migration.mjs";

interface MigrationRow extends Omit<SessionTitleMigration, "status"> {
  previousNativeTitle?: string | null;
  status: "pending" | "conflict" | "unsupported" | "ready" | "applied" | "failed";
  error?: string;
}

async function previewTitles(client: DaemonClient, rows: MigrationRow[]): Promise<void> {
  for (const row of rows) {
    if (row.status === "conflict") continue;
    try {
      const native = await client.getNativeSessionTitle(row.agentId);
      if (native.sessionId !== row.sessionId) throw new Error("原生会话身份已变化，拒绝迁移。");
      row.previousNativeTitle = native.title;
      row.status = native.supported ? "ready" : "unsupported";
    } catch (error) {
      row.status = "failed";
      row.error = error instanceof Error ? error.stack : String(error);
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      home: { type: "string" },
      host: { type: "string" },
      report: { type: "string" },
      apply: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
      "include-archived": { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(
      "用法：npx tsx scripts/migrate-session-titles.mts --home <PASEO_HOME> --report <报告.json> [--host <连接地址>] [--apply] [--include-archived]",
    );
    console.log(
      "默认只预览。脚本读取原生名称并保存报告，不修改工作区标题；--apply 才会逐项写入原生名称。请先更新目标守护进程。",
    );
    return;
  }
  if (!values.home || !values.report) throw new Error("必须明确提供 --home 和 --report。");
  const home = path.resolve(values.home);
  const agentRoot = path.join(home, "agents");
  const entries = await readdir(agentRoot, { recursive: true, withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filename = path.join(entry.parentPath, entry.name);
    const record = parseStoredAgentRecord(JSON.parse(await readFile(filename, "utf8")));
    if (!values["include-archived"] && record.archivedAt) continue;
    records.push(record);
  }
  const rows: MigrationRow[] = planSessionTitleMigration(records);
  const reportPath = path.resolve(values.report);
  await mkdir(path.dirname(reportPath), { recursive: true });
  // 先保留本地旧名称；首次读取原生名称可能触发 Paseo 自身的标题同步。
  const report = { home, applyRequested: values.apply, createdAt: new Date().toISOString(), rows };
  await writeFile(reportPath, JSON.stringify(report, null, 2), { encoding: "utf8", flag: "wx" });
  process.env.PASEO_HOME = home;
  const client = await connectToDaemon({ host: values.host });
  try {
    const expectedId = (await readFile(path.join(home, "server-id"), "utf8")).trim();
    if (client.getLastServerInfoMessage()?.serverId !== expectedId) {
      throw new Error("连接主机与 --home 不一致，拒绝迁移。");
    }
    if (client.getLastServerInfoMessage()?.features?.nativeSessionTitles !== true) {
      throw new Error("请先更新主机；旧版本只能修改本地别名，不能用于原生名称迁移。");
    }
    await previewTitles(client, rows);
    // 任何原生写入之前，必须把全部旧原生名称可靠保存到报告。
    await writeJsonFileAtomic(reportPath, report);
    if (values.apply) {
      for (const row of rows) {
        if (row.status !== "ready") continue;
        try {
          await client.updateAgent(row.agentId, {
            name: row.title,
            nativeTitleOnly: true,
            expectedNativeTitle: row.previousNativeTitle,
            expectedNativeSessionId: row.sessionId,
          });
          row.status = "applied";
        } catch (error) {
          row.status = "failed";
          row.error = error instanceof Error ? error.stack : String(error);
        }
        await writeJsonFileAtomic(reportPath, report);
      }
    }
    console.table(
      rows.map(({ agentId, provider, title, status }) => ({ agentId, provider, title, status })),
    );
    console.log(`报告已保存：${reportPath}`);
    if (rows.some((row) => row.status === "failed" || row.status === "conflict"))
      process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
