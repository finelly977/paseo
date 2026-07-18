import os from "node:os";
import path from "node:path";
import type { MigrationSource } from "../../types.js";
import { readConductorCatalog } from "./database.js";
import { inspectCatalog } from "./inspect.js";

export function defaultConductorDatabasePath(): string {
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "com.conductor.app",
    "conductor.db",
  );
}

export function createConductorSource(input: {
  databasePath?: string;
  platform?: NodeJS.Platform;
}): MigrationSource {
  return {
    id: "conductor",
    async inspect() {
      const platform = input.platform ?? process.platform;
      if (!input.databasePath && platform !== "darwin") {
        return {
          projects: [],
          skippedSettings: [
            {
              code: "unsupported-platform",
              level: "error",
              message:
                "Automatic Conductor discovery is available only on macOS; use --database for recovery.",
            },
          ],
        };
      }
      return inspectCatalog(
        await readConductorCatalog(input.databasePath ?? defaultConductorDatabasePath()),
      );
    },
  };
}
