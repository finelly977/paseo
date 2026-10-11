import { describe, expect, it } from "vitest";
import { parseSendDelayMinutes } from "./scheduled-send-model";
describe("定时发送分钟数", () => {
  it("接受 1 分钟至 7 天的整数", () => {
    expect(parseSendDelayMinutes("1")).toBe(1);
    expect(parseSendDelayMinutes(" 15 ")).toBe(15);
    expect(parseSendDelayMinutes("10080")).toBe(10080);
  });
  it("拒绝空值、负数、小数和隐式数字转换", () => {
    for (const value of ["", "0", "-1", "1.5", "1e2", "0x10", "Infinity", "10081"])
      expect(parseSendDelayMinutes(value)).toBeNull();
  });
});
