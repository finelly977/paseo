import type { MigrationOutput } from "./types.js";

export function createStreamingOutput(streams: {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}): MigrationOutput {
  return (event) => {
    const stream = event.level === "error" ? streams.stderr : streams.stdout;
    stream.write(`${event.level.toUpperCase()}: ${event.message}\n`);
  };
}
