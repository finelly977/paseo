import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

test.skip(process.env.E2E_DESKTOP_RUNTIME !== "1", "requires the real Electron product runtime");
test.setTimeout(180_000);

const repoRoot = path.resolve(__dirname, "../../..");
let installation: Awaited<ReturnType<typeof createConductorInstallation>>;
let electronApp: ElectronApplication;

test.beforeAll(async () => {
  installation = await createConductorInstallation();
});

test.afterAll(async () => {
  await electronApp?.close();
  rmSync(installation.root, { recursive: true, force: true });
});

test("imports from the product Integrations row and renders success, failure, and eligibility", async () => {
  electronApp = await launchProduct();
  const page = await electronApp.firstWindow();
  await openIntegrations(page);

  await openMigration(page);
  await expect(
    page.getByText("Paseo will register valid repositories", { exact: false }),
  ).toBeVisible();
  await page.getByTestId("migration-confirm").click();
  await expect(page.getByTestId("migration-result")).toHaveText("Import complete.");
  await expect(page.getByTestId("migration-output")).toContainText(
    `Registered project ${installation.repo}.`,
  );
  await expect(page.getByTestId("migration-output")).toContainText("Migration summary:");

  await page.getByTestId("migration-done").click();
  writeFileSync(installation.databasePath, "not a sqlite database");
  await openMigration(page);
  await page.getByTestId("migration-confirm").click();
  await expect(page.getByTestId("migration-result")).toHaveText("Import failed.");
  await expect(page.getByTestId("migration-output")).toContainText("ERROR:");

  await page.getByTestId("migration-done").click();
  await stopMigrationHost();
  await page.getByRole("button", { name: "General", exact: true }).click();
  await page.getByRole("button", { name: "Integrations", exact: true }).click();
  const row = page.getByTestId("conductor-migration-row");
  await expect(row).toContainText("Start the Desktop-managed host before importing.");
  await expect(row.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
});

async function launchProduct(): Promise<ElectronApplication> {
  const metroPort = requiredEnvironment("E2E_METRO_PORT");
  return electron.launch({
    args: [path.join(repoRoot, "packages", "desktop", "dist", "main.js")],
    env: {
      ...process.env,
      EXPO_DEV_URL: `http://127.0.0.1:${metroPort}`,
      HOME: installation.home,
      PASEO_HOME: requiredEnvironment("E2E_PASEO_HOME"),
      PASEO_DISABLE_SINGLE_INSTANCE_LOCK: "1",
      PASEO_TEST_APP_NAME: "Paseo Migration Behavior",
    },
  });
}

async function openIntegrations(page: Page): Promise<void> {
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await expect(settings).toBeVisible({ timeout: 90_000 });
  await settings.click();
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Integrations", exact: true }).click();
  await expect(page.getByTestId("conductor-migration-row")).toBeVisible();
}

async function openMigration(page: Page): Promise<void> {
  const button = page
    .getByTestId("conductor-migration-row")
    .getByRole("button", { name: "Import", exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByTestId("migration-sheet")).toBeVisible();
}

async function createConductorInstallation(): Promise<{
  root: string;
  home: string;
  repo: string;
  databasePath: string;
}> {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "paseo-product-migration-")));
  const home = path.join(root, "home");
  const repo = path.join(root, "repo");
  mkdirSync(home, { recursive: true });
  execFileSync("git", ["init", "-b", "main", repo]);
  execFileSync("git", ["config", "user.email", "fixture@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: repo });
  writeFileSync(path.join(repo, "README.md"), "fixture\n");
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "fixture"], {
    cwd: repo,
  });

  const databaseDirectory = path.join(home, "Library", "Application Support", "com.conductor.app");
  mkdirSync(databaseDirectory, { recursive: true });
  const databasePath = path.join(databaseDirectory, "conductor.db");
  cpSync(
    path.join(repoRoot, "packages", "migrate", "fixtures", "conductor", "conductor.db"),
    databasePath,
  );
  execFileSync(
    process.execPath,
    [
      "-e",
      `const fs = require("node:fs");
const initSqlJs = require("sql.js");
(async () => {
  const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
  const databasePath = process.argv[1];
  const repo = process.argv[2];
  const database = new SQL.Database(fs.readFileSync(databasePath));
  database.run("UPDATE repos SET root_path = ? WHERE id = 'repo-current'", [repo]);
  database.run("UPDATE repos SET is_hidden = 1 WHERE id <> 'repo-current'");
  database.run("DELETE FROM workspaces");
  fs.writeFileSync(databasePath, database.export());
  database.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });`,
      databasePath,
      repo,
    ],
    { cwd: repoRoot },
  );
  return { root, home, repo: realpathSync(repo), databasePath };
}

async function stopMigrationHost(): Promise<void> {
  const pidFile = path.join(requiredEnvironment("E2E_PASEO_HOME"), "paseo.pid");
  const pid = (JSON.parse(readFileSync(pidFile, "utf8")) as { pid: number }).pid;
  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch {
      return;
    }
  }
  throw new Error(`Migration host ${pid} did not stop.`);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
