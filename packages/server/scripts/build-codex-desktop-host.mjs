import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const sourcePath = fileURLToPath(
  new URL("../src/server/agent/providers/codex/desktop-tools-host.ts", import.meta.url),
);
const outputPath =
  process.argv[2] ??
  fileURLToPath(
    new URL(
      "../dist/server/server/agent/providers/codex/desktop-tools-host.bundle.mjs",
      import.meta.url,
    ),
  );

// 宿主由外部 Node 执行，Zod 等依赖必须随入口打包；官方 SDK 仍按运行时路径加载。
await build({
  entryPoints: [sourcePath],
  outfile: outputPath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
});
