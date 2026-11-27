import { describe, expect, test } from "vitest";
import { sortProviderThinkingOptions } from "./thinking-options-order.js";

describe("sortProviderThinkingOptions", () => {
  test("按思考深度从浅到深排序并始终将 Max 放在 Extra high 和 Ultra code 之后", () => {
    const sorted = sortProviderThinkingOptions([
      { id: "max", label: "Max" },
      { id: "ultracode", label: "Ultra code" },
      { id: "xhigh", label: "Extra high" },
      { id: "high", label: "High" },
      { id: "medium", label: "Medium" },
      { id: "low", label: "Low" },
      { id: "minimal", label: "Minimal" },
      { id: "off", label: "Off" },
      { id: "default", label: "Default" },
    ]);

    expect(sorted.map((option) => option.id)).toEqual([
      "default",
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "ultracode",
      "max",
    ]);
  });

  test("通过 label 识别档位并将未知自定义档位保持在 Extra high 与 Ultra code/Max 之间且维持原顺序", () => {
    const sorted = sortProviderThinkingOptions([
      { id: "tier-top", label: "Maximum" },
      { id: "tier-beta", label: "Custom Beta" },
      { id: "tier-alpha", label: "Custom Alpha" },
      { id: "tier-xh", label: "Extra High" },
      { id: "tier-l", label: "Low" },
    ]);

    expect(sorted.map((option) => option.id)).toEqual([
      "tier-l",
      "tier-xh",
      "tier-beta",
      "tier-alpha",
      "tier-top",
    ]);
  });
});
