import { z } from "zod";
import { readValidatedJson } from "@/storage/validated-storage";
import { APP_SETTINGS_KEY, SETTINGS_MIGRATIONS_KEY } from "./keys";
import type { AppSettings, KeyValueStorage, PersistedAppSettings } from "./storage";

const AppliedMigrationsSchema = z.strictObject({ applied: z.array(z.string()) });

/**
 * 运行中追加消息出现前，发送行为长期默认为“中断”，而默认值会在首次读取时写入存储，
 * 因而无法区分旧默认值和用户主动选择。这里仅迁移一次；迁移后用户重新选择“中断”会保留。
 */
const STEER_DEFAULT_MIGRATION = "steer-default";

/**
 * 回复间过程折叠上线前，工具调用显示长期默认为“完整详情”并随首次读取写入存储。
 * 这里仅迁移一次到“摘要”（回复间过程折叠）；迁移后用户主动切回“完整详情”会保留。
 */
const OVERVIEW_TOOL_CALL_DEFAULT_MIGRATION = "overview-tool-call-default";

/**
 * 更新设置并返回本次应使用的结果。必须先写设置、后写迁移标记：设置写入失败时不得留下
 * 已迁移标记；标记写入失败则允许下次安全重试。
 */
export async function migrateAppSettings(
  settings: AppSettings,
  storage: KeyValueStorage,
  stored: PersistedAppSettings,
): Promise<AppSettings> {
  const migrationMarker = await readValidatedJson(
    storage,
    SETTINGS_MIGRATIONS_KEY,
    AppliedMigrationsSchema,
  );
  const applied = new Set(migrationMarker?.applied ?? []);
  const needsSteerMigration = !applied.has(STEER_DEFAULT_MIGRATION);
  const needsOverviewMigration = !applied.has(OVERVIEW_TOOL_CALL_DEFAULT_MIGRATION);
  if (!needsSteerMigration && !needsOverviewMigration) {
    return settings;
  }

  let migrated = settings;
  if (needsSteerMigration && migrated.sendBehavior === "interrupt") {
    migrated = { ...migrated, sendBehavior: "steer" };
  }
  if (needsOverviewMigration && migrated.toolCallDetailLevel === "detailed") {
    migrated = { ...migrated, toolCallDetailLevel: "overview" };
  }
  if (migrated !== settings) {
    const {
      compactToolCalls: _compactToolCalls,
      manageBuiltInDaemon: _manageBuiltInDaemon,
      releaseChannel: _releaseChannel,
      ...preserved
    } = stored;
    await storage.setItem(APP_SETTINGS_KEY, JSON.stringify({ ...preserved, ...migrated }));
  }

  if (needsSteerMigration) {
    applied.add(STEER_DEFAULT_MIGRATION);
  }
  if (needsOverviewMigration) {
    applied.add(OVERVIEW_TOOL_CALL_DEFAULT_MIGRATION);
  }
  await storage.setItem(SETTINGS_MIGRATIONS_KEY, JSON.stringify({ applied: [...applied] }));
  return migrated;
}
