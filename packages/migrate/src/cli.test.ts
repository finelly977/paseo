import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { main } from "./cli.js";

test("cancels an apply unless the user confirms", async () => {
  const terminal = createTerminal("no\n");

  const exitCode = await main(["conductor"], terminal.io);

  expect(exitCode).toBe(0);
  expect(terminal.stdout()).toContain("Import conductor projects into Paseo?");
  expect(terminal.stdout()).toContain("Migration cancelled.");
  expect(terminal.stderr()).toBe("");
});

test("confirmation continues into source validation and returns a failure exit", async () => {
  const terminal = createTerminal("yes\n");

  const exitCode = await main(["unknown-source"], terminal.io);

  expect(exitCode).toBe(1);
  expect(terminal.stdout()).toContain("Import unknown-source projects into Paseo?");
  expect(terminal.stderr()).toContain("Unsupported migration source: unknown-source");
});

test("dry-run prints project actions, notices, and a final summary without prompting", async () => {
  const terminal = createTerminal("");
  const databasePath = fileURLToPath(
    new URL("../fixtures/conductor/conductor.db", import.meta.url),
  );

  const exitCode = await main(["conductor", "--database", databasePath, "--dry-run"], terminal.io);

  expect(exitCode).toBe(0);
  expect(terminal.stdout()).toContain("Dry-run plan:");
  expect(terminal.stdout()).toContain("Skipped hidden project");
  expect(terminal.stdout()).toContain("Dry-run summary:");
  expect(terminal.stdout()).not.toContain("Import conductor projects into Paseo?");
  expect(terminal.stderr()).toBe("");
});

function createTerminal(input: string): {
  io: {
    stdin: NodeJS.ReadableStream;
    stdout: Writable;
    stderr: Writable;
  };
  stdout(): string;
  stderr(): string;
} {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdin: Readable.from([input]),
      stdout: new Writable({
        write: (chunk, _encoding, done) => ((stdout += chunk.toString()), done()),
      }),
      stderr: new Writable({
        write: (chunk, _encoding, done) => ((stderr += chunk.toString()), done()),
      }),
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}
