#!/usr/bin/env node
import { createRequire } from "node:module";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { migrate } from "./migrate.js";
import { createStreamingOutput } from "./output.js";
import { connectPaseo } from "./paseo.js";
import { createMigrationSource } from "./sources/index.js";
import type { PaseoMigrationPort } from "./types.js";

interface CliOptions {
  sourceId: string;
  host?: string;
  databasePath?: string;
  yes: boolean;
  dryRun: boolean;
}

interface CliIo {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export async function main(
  argv = process.argv.slice(2),
  io: CliIo = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  const output = createStreamingOutput({ stdout: io.stdout, stderr: io.stderr });
  try {
    const options = parseArgs(argv);
    if (!options.dryRun && !options.yes && !(await confirmMigration(options.sourceId, io))) {
      output({ level: "info", message: "Migration cancelled." });
      return 0;
    }
    const source = createMigrationSource({
      sourceId: options.sourceId,
      databasePath: options.databasePath,
    });
    const connection = options.dryRun
      ? null
      : await connectPaseo({ host: options.host, version: packageVersion() });
    try {
      const result = await migrate({
        source,
        paseo: connection ?? dryRunPaseoPort,
        dryRun: options.dryRun,
        output,
      });
      return result.notices.some((notice) => notice.level === "error") ? 1 : 0;
    } finally {
      await connection?.close();
    }
  } catch (error) {
    output({ level: "error", message: error instanceof Error ? error.message : String(error) });
    return 1;
  }
}

function parseArgs(argv: string[]): CliOptions {
  const sourceId = argv[0];
  if (!sourceId || sourceId.startsWith("-")) {
    throw new Error(
      "Usage: paseo-migrate <source> [--host <connection>] [--database <path>] [--yes] [--dry-run]",
    );
  }
  const options: CliOptions = { sourceId, yes: false, dryRun: false };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--yes") options.yes = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--host") options.host = requiredValue(argv, ++index, "--host");
    else if (argument === "--database") {
      options.databasePath = requiredValue(argv, ++index, "--database");
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

function requiredValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

async function confirmMigration(sourceId: string, io: CliIo): Promise<boolean> {
  const prompt = createInterface({ input: io.stdin, output: io.stdout });
  try {
    const answer = await prompt.question(
      `Import ${sourceId} projects into Paseo? Source data will not be changed. [y/N] `,
    );
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    prompt.close();
  }
}

function packageVersion(): string {
  const require = createRequire(import.meta.url);
  const manifest = require("../package.json") as { version?: unknown };
  if (typeof manifest.version !== "string") throw new Error("Unable to resolve migrator version.");
  return manifest.version;
}

const dryRunPaseoPort: PaseoMigrationPort = {
  addProject: async () => undefined,
  openCheckout: async () => undefined,
  readProjectConfig: async () => ({ config: null, revision: null }),
  writeProjectConfig: async () => undefined,
  ensureCheckout: async () => ({ path: "", created: false }),
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
