import { expect, test } from "vitest";
import { isMaxEffort } from "./max-effort";

test("最高档依据模型实际支持的最后一档，不按 Max 文案猜测", () => {
  const options = [{ id: "low" }, { id: "max" }, { id: "ultra" }];
  expect(isMaxEffort(options, "ultra")).toBe(true);
  expect(isMaxEffort(options, "max")).toBe(false);
  expect(isMaxEffort(options, "unknown")).toBe(false);
  expect(isMaxEffort(options, undefined)).toBe(false);
  expect(isMaxEffort([{ id: "default" }], "default")).toBe(false);
  expect(isMaxEffort(undefined, "ultra")).toBe(false);
});
