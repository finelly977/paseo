import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import initSqlJs, { type Database } from "sql.js";
import type { MigrationNotice } from "../../types.js";
import type { ConductorSettings } from "./project-config.js";

const MINIMUM_SCHEMA_VERSION = 112;
const require = createRequire(import.meta.url);
const sqlite = initSqlJs({
  locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
});

export interface ConductorRepoRecord {
  id: string;
  rootPath: string;
  name: string | null;
  hidden: boolean;
  databaseSettings: ConductorSettings;
  notices: MigrationNotice[];
}

export interface ConductorWorkspaceRecord {
  id: string;
  repoId: string;
  branch: string | null;
  state: string;
  path: string | null;
  archiveCommit: string | null;
}

export interface ConductorCatalog {
  repos: ConductorRepoRecord[];
  workspaces: ConductorWorkspaceRecord[];
}

export class UnsupportedConductorDatabaseError extends Error {}

export async function readConductorCatalog(databasePath: string): Promise<ConductorCatalog> {
  const walPath = `${databasePath}-wal`;
  if (existsSync(walPath) && statSync(walPath).size > 0) {
    throw new UnsupportedConductorDatabaseError(
      "Conductor has pending database changes. Quit Conductor before migrating.",
    );
  }
  const SQL = await sqlite;
  const database = new SQL.Database(readFileSync(databasePath));
  try {
    const versionRow = queryRows(database, "PRAGMA user_version")[0];
    const version = numericColumn(versionRow, "user_version");
    if (version < MINIMUM_SCHEMA_VERSION) {
      throw new UnsupportedConductorDatabaseError(
        `Unsupported Conductor database schema ${version}; expected ${MINIMUM_SCHEMA_VERSION} or newer.`,
      );
    }

    const repoColumns = tableColumns(database, "repos");
    requireColumns("repos", repoColumns, ["id", "root_path", "name", "is_hidden"]);
    const workspaceColumns = tableColumns(database, "workspaces");
    requireColumns("workspaces", workspaceColumns, [
      "id",
      "repo_id",
      "branch",
      "state",
      "path",
      "archive_commit",
    ]);

    const optionalRepoColumns = [
      "setup_script",
      "archive_script",
      "run_scripts_json",
      "metadata_prompts_json",
    ].filter((column) => repoColumns.has(column));
    const selectedRepoColumns = ["id", "root_path", "name", "is_hidden", ...optionalRepoColumns];
    const repoRows = queryRows(database, `SELECT ${selectedRepoColumns.join(", ")} FROM repos`);
    const workspaceRows = queryRows(
      database,
      "SELECT id, repo_id, branch, state, path, archive_commit FROM workspaces",
    );

    return {
      repos: repoRows.map(parseRepo),
      workspaces: workspaceRows.map(parseWorkspace),
    };
  } finally {
    database.close();
  }
}

function queryRows(database: Database, sql: string): Record<string, unknown>[] {
  const result = database.exec(sql)[0];
  if (!result) return [];
  return result.values.map((values) =>
    Object.fromEntries(result.columns.map((column, index) => [column, values[index] ?? null])),
  );
}

function tableColumns(database: Database, table: string): Set<string> {
  const rows = queryRows(database, `PRAGMA table_info(${table})`);
  if (rows.length === 0) throw new UnsupportedConductorDatabaseError(`Missing ${table} table.`);
  return new Set(rows.map((row) => stringColumn(row, "name")));
}

function requireColumns(table: string, actual: Set<string>, required: string[]): void {
  const missing = required.filter((column) => !actual.has(column));
  if (missing.length > 0) {
    throw new UnsupportedConductorDatabaseError(
      `Unsupported ${table} schema; missing columns: ${missing.join(", ")}.`,
    );
  }
}

function parseRepo(value: unknown): ConductorRepoRecord {
  const row = record(value);
  const id = stringColumn(row, "id");
  const notices: MigrationNotice[] = [];
  const scripts = parseRecordJson(row.run_scripts_json, id, "run_scripts_json", notices);
  const prompts = parseRecordJson(row.metadata_prompts_json, id, "metadata_prompts_json", notices);
  const setup = optionalConfigString(row.setup_script, id, "setup_script", notices);
  const archive = optionalConfigString(row.archive_script, id, "archive_script", notices);
  return {
    id,
    rootPath: stringColumn(row, "root_path"),
    name: optionalString(row.name),
    hidden: row.is_hidden === 1 || row.is_hidden === true,
    databaseSettings: {
      ...(setup || archive || scripts
        ? {
            scripts: {
              ...(setup ? { setup } : {}),
              ...(archive ? { archive } : {}),
              ...(scripts ? { run: scripts } : {}),
            },
          }
        : {}),
      ...(prompts ? { prompts } : {}),
    },
    notices,
  };
}

function parseWorkspace(value: unknown): ConductorWorkspaceRecord {
  const row = record(value);
  return {
    id: stringColumn(row, "id"),
    repoId: stringColumn(row, "repo_id"),
    branch: optionalString(row.branch),
    state: stringColumn(row, "state"),
    path: optionalString(row.path),
    archiveCommit: optionalString(row.archive_commit),
  };
}

function parseRecordJson(
  value: unknown,
  repoId: string,
  column: string,
  notices: MigrationNotice[],
): Record<string, unknown> | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    notices.push(malformedDatabaseSetting(repoId, column));
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Report below with the same stable notice as a non-object JSON value.
  }
  notices.push(malformedDatabaseSetting(repoId, column));
  return null;
}

function optionalConfigString(
  value: unknown,
  repoId: string,
  column: string,
  notices: MigrationNotice[],
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    notices.push(malformedDatabaseSetting(repoId, column));
    return null;
  }
  return value.trim().length > 0 ? value : null;
}

function malformedDatabaseSetting(repoId: string, column: string): MigrationNotice {
  return {
    code: "malformed-database-setting",
    level: "warning",
    message: `Skipped malformed ${column} for project ${repoId}.`,
  };
}

function numericColumn(value: unknown, key: string): number {
  const column = record(value)[key];
  if (typeof column !== "number") throw new UnsupportedConductorDatabaseError(`Invalid ${key}.`);
  return column;
}

function stringColumn(value: unknown, key: string): string {
  const column = record(value)[key];
  if (typeof column !== "string") throw new UnsupportedConductorDatabaseError(`Invalid ${key}.`);
  return column;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UnsupportedConductorDatabaseError("Conductor database returned an invalid row.");
  }
  return value as Record<string, unknown>;
}
