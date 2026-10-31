import { describe, expect, test } from "vitest";
import { TIMELINE_FETCH_PAGE_SIZE } from "@/timeline/timeline-fetch-policy";
import {
  isTimelineCatchUpComplete,
  planInitialAgentTimelineSync,
  planResumeTimelineSync,
  planTimelineOlderFetch,
  shouldApplyOlderHistoryBoundary,
} from "./timeline-sync-plan";

describe("timeline sync planning", () => {
  test.each([
    { direction: "after", startSeq: null },
    { direction: "after", startSeq: 101 },
    { direction: "tail", startSeq: 81 },
    { direction: "before", startSeq: 41 },
  ] as const)(
    "$direction 页未覆盖缓存起点时，不重新打开旧历史加载入口",
    ({ direction, startSeq }) => {
      expect(
        shouldApplyOlderHistoryBoundary({
          direction,
          reset: false,
          epoch: "epoch",
          startCursor: startSeq === null ? null : { epoch: "epoch", seq: startSeq },
          currentCursor: { epoch: "epoch", startSeq: 1, endSeq: 100 },
        }),
      ).toBe(false);
    },
  );

  test.each([{ startCursor: null }, { startCursor: { epoch: "epoch", seq: 1 } }])(
    "向前读到历史起点或空页，仍正确关闭加载入口",
    ({ startCursor }) => {
      expect(
        shouldApplyOlderHistoryBoundary({
          direction: "before",
          reset: false,
          epoch: "epoch",
          startCursor,
          currentCursor: { epoch: "epoch", startSeq: 41, endSeq: 100 },
        }),
      ).toBe(true);
    },
  );

  test("新时间线代际仍以服务端报告的历史边界为准", () => {
    expect(
      shouldApplyOlderHistoryBoundary({
        direction: "after",
        reset: true,
        epoch: "new",
        startCursor: { epoch: "new", seq: 81 },
        currentCursor: { epoch: "old", startSeq: 1, endSeq: 100 },
      }),
    ).toBe(true);
  });

  test("initial open without an authoritative cursor loads a bounded tail page", () => {
    const plan = planInitialAgentTimelineSync({
      cursor: undefined,
      hasAuthoritativeHistory: false,
      conversationLimit: 50,
    });

    expect(plan).toEqual({
      direction: "tail",
      limit: TIMELINE_FETCH_PAGE_SIZE,
      conversationLimit: 50,
      projection: "projected",
    });
  });

  test("initial open with an authoritative cursor catches up after the cursor", () => {
    const plan = planInitialAgentTimelineSync({
      cursor: { epoch: "epoch-1", startSeq: 1, endSeq: 42 },
      hasAuthoritativeHistory: true,
    });

    expect(plan).toEqual({
      direction: "after",
      cursor: { epoch: "epoch-1", seq: 42 },
      limit: TIMELINE_FETCH_PAGE_SIZE,
      projection: "projected",
    });
  });

  test("resume with a cursor catches up after the cursor", () => {
    const plan = planResumeTimelineSync({
      cursor: { epoch: "epoch-1", startSeq: 1, endSeq: 100 },
    });

    expect(plan).toEqual({
      direction: "after",
      cursor: { epoch: "epoch-1", seq: 100 },
      limit: TIMELINE_FETCH_PAGE_SIZE,
      projection: "projected",
    });
  });

  test("resume without a cursor loads a bounded tail page", () => {
    const plan = planResumeTimelineSync({ cursor: undefined });

    expect(plan).toEqual({
      direction: "tail",
      limit: TIMELINE_FETCH_PAGE_SIZE,
      projection: "projected",
    });
  });

  test("older history loads one bounded page before the start cursor", () => {
    const plan = planTimelineOlderFetch({ epoch: "epoch-1", seq: 25 });

    expect(plan).toEqual({
      direction: "before",
      cursor: { epoch: "epoch-1", seq: 25 },
      limit: TIMELINE_FETCH_PAGE_SIZE,
      projection: "projected",
    });
  });

  test("catch-up finishes when the daemon reports no newer rows", () => {
    expect(isTimelineCatchUpComplete({ direction: "after", hasNewer: false, error: null })).toBe(
      true,
    );
  });
});
