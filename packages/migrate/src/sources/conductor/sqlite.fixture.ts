import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Database, SqlJsStatic } from "sql.js";

const require = createRequire(import.meta.url);
const initSqlJs = require("sql.js") as (options?: {
  locateFile?: (file: string) => string;
}) => Promise<SqlJsStatic>;
const sqlite = initSqlJs({
  locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
});

export async function openFixtureDatabase(databasePath?: string): Promise<Database> {
  const SQL = await sqlite;
  return new SQL.Database(databasePath ? readFileSync(databasePath) : undefined);
}

export function saveFixtureDatabase(databasePath: string, database: Database): void {
  writeFileSync(databasePath, database.export());
  database.close();
}
