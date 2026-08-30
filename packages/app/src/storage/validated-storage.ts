import { z } from "zod";

export interface ValidatedStorage {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
}

async function clearInvalidValue(storage: ValidatedStorage, key: string): Promise<void> {
  try {
    await storage.removeItem(key);
  } catch (error) {
    console.error(`[持久化存储] 清理无效数据失败，键：${key}`, error);
  }
}

export async function readValidatedString<Value>(
  storage: ValidatedStorage,
  key: string,
  schema: z.ZodType<Value>,
): Promise<Value | null> {
  const raw = await storage.getItem(key);
  if (raw === null) return null;
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  console.error(`[持久化存储] 字符串数据校验失败，键：${key}`, result.error);
  await clearInvalidValue(storage, key);
  return null;
}

export async function readValidatedJson<Value>(
  storage: ValidatedStorage,
  key: string,
  schema: z.ZodType<Value>,
): Promise<Value | null> {
  const raw = await storage.getItem(key);
  if (raw === null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error) {
    console.error(`[持久化存储] JSON 解析失败，键：${key}`, error);
    await clearInvalidValue(storage, key);
    return null;
  }
  const result = schema.safeParse(decoded);
  if (result.success) return result.data;
  console.error(`[持久化存储] JSON 数据校验失败，键：${key}`, result.error);
  await clearInvalidValue(storage, key);
  return null;
}
