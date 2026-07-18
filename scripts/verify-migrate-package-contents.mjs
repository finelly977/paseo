import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const packDirectory = mkdtempSync(path.join(os.tmpdir(), "paseo-migrate-pack-"));
try {
  const output = execFileSync(npm, ["pack", "--json", "--pack-destination", packDirectory], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [manifest] = JSON.parse(output);
  const files = new Set(manifest?.files?.map((file) => file.path));
  const required = [
    "dist/cli.js",
    "fixtures/conductor/conductor.db",
    "fixtures/conductor/current/.conductor/settings.local.toml",
    "fixtures/conductor/current/.conductor/settings.toml",
    "fixtures/conductor/legacy/conductor.json",
  ];
  const missing = required.filter((file) => !files.has(file));
  if (missing.length > 0) {
    throw new Error(`Published migrator is missing: ${missing.join(", ")}`);
  }
  if (
    typeof manifest.filename !== "string" ||
    !existsSync(path.join(packDirectory, manifest.filename))
  ) {
    throw new Error("npm pack did not create the migrator tarball.");
  }
  process.stdout.write(
    `Verified published migrator tarball contents (${manifest.files.length} files).\n`,
  );
} finally {
  rmSync(packDirectory, { recursive: true, force: true });
}
