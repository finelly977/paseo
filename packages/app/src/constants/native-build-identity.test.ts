import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, test } from "vitest";

const configPath = fileURLToPath(new URL("../../app.config.js", import.meta.url));
const compiledConfig = transformSync(readFileSync(configPath, "utf8"), {
  format: "cjs",
}).code;

function loadConfig(env: Record<string, string> = {}) {
  const module = { exports: {} };
  runInNewContext(compiledConfig, {
    module,
    exports: module.exports,
    require: createRequire(configPath),
    __dirname: path.dirname(configPath),
    process: { env },
  });
  return (
    module.exports as {
      default: {
        expo: {
          owner?: string;
          updates: { enabled?: boolean; url?: string };
          extra: { eas?: { projectId: string } };
          android: { package: string };
          ios: { bundleIdentifier: string };
        };
      };
    }
  ).default.expo;
}

describe("二开移动构建归属", () => {
  test("默认不绑定外部热更新项目，保留安装身份", () => {
    const config = loadConfig();
    expect(config.updates).toEqual({ enabled: false });
    expect(config.owner).toBeUndefined();
    expect(config.extra.eas).toBeUndefined();
    expect(config.android.package).toBe("sh.paseo");
    expect(config.ios.bundleIdentifier).toBe("sh.paseo");
  });

  test("仅显式配置自己的完整项目后启用热更新", () => {
    const config = loadConfig({ PASEO_EAS_PROJECT_ID: "fork-project", PASEO_EAS_OWNER: "fork" });
    expect(config.updates).toEqual({ url: "https://u.expo.dev/fork-project" });
    expect(config.owner).toBe("fork");
    expect(config.extra.eas).toEqual({ projectId: "fork-project" });
  });

  test.each(["PASEO_LOCAL_APK", "PASEO_FDROID_BUILD"])("%s 构建始终禁用热更新", (flag) => {
    expect(
      loadConfig({ PASEO_EAS_PROJECT_ID: "fork-project", PASEO_EAS_OWNER: "fork", [flag]: "1" })
        .updates,
    ).toEqual({ enabled: false });
  });

  test.each(["PASEO_EAS_PROJECT_ID", "PASEO_EAS_OWNER"])(
    "只配置 %s 时明确拒绝不完整的项目归属",
    (key) => {
      expect(() => loadConfig({ [key]: "incomplete" })).toThrow(
        "PASEO_EAS_PROJECT_ID and PASEO_EAS_OWNER must be configured together",
      );
    },
  );
});
