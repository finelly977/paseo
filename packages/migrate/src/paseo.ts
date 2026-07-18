import { connectHostAutomation } from "@getpaseo/client/node";
import type { PaseoMigrationPort } from "./types.js";

export async function connectPaseo(input: {
  host?: string;
  version: string;
}): Promise<PaseoMigrationPort & { close(): Promise<void> }> {
  return connectHostAutomation({ appVersion: input.version, host: input.host });
}
