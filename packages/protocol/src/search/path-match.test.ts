import { describe, expect, it } from "vitest";

import { scorePathMatch } from "./path-match.js";

describe("scorePathMatch", () => {
  it("matches a literal fragment anywhere in the complete path", () => {
    expect(
      scorePathMatch("skills/", "something/something-else/skills/paseo-advisor/SKILL.md"),
    ).not.toBeNull();
  });

  it("fuzzy-matches spaced text against a compact path", () => {
    expect(scorePathMatch("blank page editor", "blankpage/editor")).toEqual({
      tier: 0,
      offset: 0,
    });
  });

  it("keeps the original path offset for compact matches", () => {
    expect(scorePathMatch("blank page editor", "projects/blankpage/editor")).toEqual({
      tier: 4,
      offset: 9,
    });
  });
});
