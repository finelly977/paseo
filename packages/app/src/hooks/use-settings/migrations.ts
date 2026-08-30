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
  if (applied.has(STEER_DEFAULT_MIGRATION)) {
    return settings;
  }

  const migrated: AppSettings =
    settings.sendBehavior === "interrupt" ? { ...settings, sendBehavior: "steer" } : settings;
  if (migrated !== settings) {
    const {
      compactToolCalls: _compactToolCalls,
      manageBuiltInDaemon: _manageBuiltInDaemon,
      releaseChannel: _releaseChannel,
      ...preserved
    } = stored;
    await storage.setItem(APP_SETTINGS_KEY, JSON.stringify({ ...preserved, ...migrated }));
  }

  applied.add(STEER_DEFAULT_MIGRATION);
  await storage.setItem(SETTINGS_MIGRATIONS_KEY, JSON.stringify({ applied: [...applied] }));
  return migrated;
}
