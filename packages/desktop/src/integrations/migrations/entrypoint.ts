import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { NodeEntrypointSpec } from "../../daemon/node-entrypoint-launcher.js";
import { assertPathExists, resolvePackagedAsarPath } from "../../daemon/package-paths.js";

export interface MigrationEntrypoint extends NodeEntrypointSpec {
  version: string;
}

export function resolveMigrationEntrypoint(): MigrationEntrypoint {
  const packageRoot = app.isPackaged
    ? path.join(resolvePackagedAsarPath(), "node_modules", "@getpaseo", "migrate")
    : path.resolve(__dirname, "../../../../migrate");
  return resolveMigrationEntrypointFromPackage({ packageRoot, isPackaged: app.isPackaged });
}

export function resolveMigrationEntrypointFromPackage(input: {
  packageRoot: string;
  isPackaged: boolean;
}): MigrationEntrypoint {
  const manifestPath = path.join(input.packageRoot, "package.json");
  const version = readVersion(manifestPath);
  if (input.isPackaged) {
    return {
      version,
      entryPath: assertPathExists({
        label: "Bundled migration entrypoint",
        filePath: path.join(input.packageRoot, "dist", "cli.js"),
      }),
      execArgv: [],
    };
  }
  const distEntry = path.join(input.packageRoot, "dist", "cli.js");
  if (existsSync(distEntry)) return { version, entryPath: distEntry, execArgv: [] };
  return {
    version,
    entryPath: assertPathExists({
      label: "Migration source entrypoint",
      filePath: path.join(input.packageRoot, "src", "cli.ts"),
    }),
    execArgv: ["--import", "tsx"],
  };
}

function readVersion(manifestPath: string): string {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string" || manifest.version.trim().length === 0) {
    throw new Error("Bundled migrator has no version.");
  }
  return manifest.version.trim();
}
