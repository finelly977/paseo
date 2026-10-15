import { expect, test } from "vitest";
import { resolveCommitRelativeTime } from "./relative-time";

const now = new Date("2026-10-16T00:00:00.000Z");

test.each([0, 5, 29, -29])("相差 %s 秒显示刚刚", (seconds) => {
  expect(
    resolveCommitRelativeTime({ date: new Date(now.getTime() + seconds * 1000), now }),
  ).toEqual({ kind: "now" });
});

test.each([
  [30, "second", 30],
  [59, "second", 59],
  [60, "minute", 1],
  [3_599, "minute", 59],
  [3_600, "hour", 1],
  [86_400, "day", 1],
  [604_800, "week", 1],
  [2_592_000, "month", 1],
  [31_536_000, "year", 1],
  [94_608_000, "year", 3],
])("相差 %s 秒选择 %s，保留过去与未来语义", (seconds, unit, value) => {
  for (const direction of ["past", "future"] as const) {
    const offset = direction === "past" ? -seconds : seconds;
    expect(
      resolveCommitRelativeTime({ date: new Date(now.getTime() + offset * 1000), now }),
    ).toEqual({ kind: "relative", unit, value, direction });
  }
});

test("非法提交时间明确报错，不显示伪造时间", () => {
  expect(() => resolveCommitRelativeTime({ date: new Date(Number.NaN), now })).toThrow(RangeError);
  expect(() => resolveCommitRelativeTime({ date: now, now: new Date(Number.NaN) })).toThrow(
    RangeError,
  );
});
