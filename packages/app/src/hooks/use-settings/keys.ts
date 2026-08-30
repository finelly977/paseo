/** Storage keys live here so `storage` and `migrations` can share them without importing each other. */

export const APP_SETTINGS_KEY = "@paseo:app-settings";
export const LEGACY_SETTINGS_KEY = "@paseo:settings";

/**
 * 已执行迁移的标记独立于设置主体保存。设置主体会保留较新版本写入的字段，而迁移标记
 * 继续使用标识列表，新增迁移时只增加列表项，不必改变设置结构。
 */
export const SETTINGS_MIGRATIONS_KEY = "@paseo:settings-migrations";
