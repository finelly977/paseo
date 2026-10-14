import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  projectTimelineRows,
  selectProjectedTimelinePage,
  selectProjectedTimelineTailByConversationLimit,
} from "./timeline-projection";
import type { AgentTimelineRow } from "./agent-timeline-store-types";

const TIMELINE_FILE = join(
  homedir(),
  ".paseo/agent-timelines/agent-OWRjNjRiMmEtZWEzMy00NTY4LTk4OGUtZDI3OTE1N2RkZTAx.json",
);
const REPORT_FILE = join(process.cwd(), ".repro-paging.json");

function loadRows(): AgentTimelineRow[] {
  const parsed = JSON.parse(readFileSync(TIMELINE_FILE, "utf8")) as { rows: AgentTimelineRow[] };
  return parsed.rows;
}

function describePage(page: {
  startSeq: number | null;
  endSeq: number | null;
  hasOlder: boolean;
  entries: ReadonlyArray<{ item: { type: string }; seqStart: number; seqEnd: number }>;
}) {
  return {
    startSeq: page.startSeq,
    endSeq: page.endSeq,
    hasOlder: page.hasOlder,
    entries: page.entries.length,
    kinds: [...new Set(page.entries.map((entry) => entry.item.type))].join("/"),
    first: page.entries[0] ? `${page.entries[0].seqStart}-${page.entries[0].seqEnd}` : null,
    last: page.entries.at(-1)
      ? `${page.entries.at(-1)!.seqStart}-${page.entries.at(-1)!.seqEnd}`
      : null,
  };
}

describe("repro: imported session older paging", () => {
  it("pages backward through the real imported timeline", () => {
    const rows = loadRows();
    const bounds = { minSeq: rows[0]!.seq, maxSeq: rows[rows.length - 1]!.seq };
    const projected = projectTimelineRows({ rows, mode: "projected" });
    const report: Record<string, unknown> = {
      rows: rows.length,
      bounds,
      projected: projected.length,
      projectedKinds: projected.reduce<Record<string, number>>((acc, entry) => {
        acc[entry.item.type] = (acc[entry.item.type] ?? 0) + 1;
        return acc;
      }, {}),
      userSeqs: projected
        .filter((entry) => entry.item.type === "user_message")
        .map((entry) => entry.seqStart),
    };

    for (const limit of [40, 200]) {
      const tail = selectProjectedTimelineTailByConversationLimit({
        rows,
        bounds,
        conversationLimit: 50,
        itemLimit: limit,
      });
      const pages: unknown[] = [];
      let cursorSeq = tail.startSeq;
      let stalledAt: number | null = null;
      for (let index = 0; index < 80 && cursorSeq !== null; index += 1) {
        const page = selectProjectedTimelinePage({
          rows,
          bounds,
          direction: "before",
          cursorSeq,
          limit,
        });
        pages.push({ i: index, cursorSeq, ...describePage(page) });
        if (!page.hasOlder) {
          if (page.startSeq !== null && page.startSeq > bounds.minSeq) stalledAt = index;
          break;
        }
        if (page.startSeq === null || page.startSeq >= cursorSeq) {
          stalledAt = index;
          break;
        }
        cursorSeq = page.startSeq;
      }
      report[`limit=${limit}`] = {
        tail: describePage(tail),
        pageCount: pages.length,
        stalledAt,
        reachedSeq1: (pages.at(-1) as { startSeq?: number | null })?.startSeq === bounds.minSeq,
        pages,
      };
    }

    writeFileSync(REPORT_FILE, JSON.stringify(report, null, 1));
    expect(rows.length).toBeGreaterThan(0);
  });
});
