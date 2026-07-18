import { createConductorSource } from "./conductor/index.js";
import type { MigrationSource } from "../types.js";

export function createMigrationSource(input: {
  sourceId: string;
  databasePath?: string;
}): MigrationSource {
  if (input.sourceId === "conductor") {
    return createConductorSource({ databasePath: input.databasePath });
  }
  throw new Error(`Unsupported migration source: ${input.sourceId}`);
}
