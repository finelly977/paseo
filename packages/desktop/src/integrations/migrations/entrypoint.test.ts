import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { resolveMigrationEntrypointFromPackage } from "./entrypoint.js";

const cleanup: string[] = [];

afterEach(() => {
  for (const directory of cleanup.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("resolves the exact bundled migrator entrypoint and package version", () => {
  const packageRoot = fixturePackage(true);

  expect(resolveMigrationEntrypointFromPackage({ packageRoot, isPackaged: true })).toEqual({
    version: "1.2.3",
    entryPath: path.join(packageRoot, "dist", "cli.js"),
    execArgv: [],
  });
});

test("uses the checked-out source entrypoint when development dist is absent", () => {
  const packageRoot = fixturePackage(false);

  expect(resolveMigrationEntrypointFromPackage({ packageRoot, isPackaged: false })).toEqual({
    version: "1.2.3",
    entryPath: path.join(packageRoot, "src", "cli.ts"),
    execArgv: ["--import", "tsx"],
  });
});

function fixturePackage(includeDist: boolean): string {
  const packageRoot = mkdtempSync(path.join(os.tmpdir(), "paseo-migration-package-"));
  cleanup.push(packageRoot);
  mkdirSync(path.join(packageRoot, "src"), { recursive: true });
  writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ version: "1.2.3" }));
  writeFileSync(path.join(packageRoot, "src", "cli.ts"), "export {};\n");
  if (includeDist) {
    mkdirSync(path.join(packageRoot, "dist"));
    writeFileSync(path.join(packageRoot, "dist", "cli.js"), "export {};\n");
  }
  return packageRoot;
}
