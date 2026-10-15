type CommitTimeUnit = "second" | "minute" | "hour" | "day" | "week" | "month" | "year";

interface CommitTimeRange {
  maximum: number;
  unit: CommitTimeUnit;
  divisor: number;
}

interface CommitRelativeTimeInput {
  date: Date;
  now: Date;
}

type CommitRelativeTime =
  | { kind: "now" }
  | { kind: "relative"; value: number; unit: CommitTimeUnit; direction: "past" | "future" };

const ranges: readonly CommitTimeRange[] = [
  { maximum: 60, unit: "second", divisor: 1 },
  { maximum: 3_600, unit: "minute", divisor: 60 },
  { maximum: 86_400, unit: "hour", divisor: 3_600 },
  { maximum: 604_800, unit: "day", divisor: 86_400 },
  { maximum: 2_592_000, unit: "week", divisor: 604_800 },
  { maximum: 31_536_000, unit: "month", divisor: 2_592_000 },
  { maximum: Number.POSITIVE_INFINITY, unit: "year", divisor: 31_536_000 },
];

export function resolveCommitRelativeTime({
  date,
  now,
}: CommitRelativeTimeInput): CommitRelativeTime {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  if (!Number.isFinite(seconds)) throw new RangeError("提交时间或当前时间无效");
  const absoluteSeconds = Math.abs(seconds);
  if (absoluteSeconds < 30) return { kind: "now" };
  const range = ranges.find((entry) => absoluteSeconds < entry.maximum);
  if (!range) throw new RangeError("无法确定提交时间的相对单位");
  return {
    kind: "relative",
    value: Math.max(1, Math.floor(absoluteSeconds / range.divisor)),
    unit: range.unit,
    direction: seconds < 0 ? "past" : "future",
  };
}
