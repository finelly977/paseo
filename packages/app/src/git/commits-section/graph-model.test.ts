import { describe, expect, it } from "vitest";
import type { ClassifiedCheckoutCommit } from "@/git/use-commits-query";
import { buildCommitGraphViewModels, getCommitGraphNodeIndex } from "./graph-model";

function commit(
  sha: string,
  parentShas: string[],
  references: ClassifiedCheckoutCommit["references"] = [],
): ClassifiedCheckoutCommit {
  return {
    sha,
    shortSha: sha,
    subject: sha,
    authorName: "测试作者",
    authorDate: "2026-08-04T00:00:00.000Z",
    isOnRemote: false,
    isOnBase: false,
    parentShas,
    references,
    statistics: { files: 0, additions: 0, deletions: 0 },
    files: [],
  };
}

describe("buildCommitGraphViewModels", () => {
  it("在线性历史中延续同一条泳道并标记当前提交", () => {
    const commits = [commit("c", ["b"]), commit("b", ["a"]), commit("a", [])];
    const models = buildCommitGraphViewModels({
      commits,
      headSha: "c",
      currentRef: null,
      upstreamRef: null,
      baseRef: null,
    });

    expect(models.map(getCommitGraphNodeIndex)).toEqual([0, 0, 0]);
    expect(models[0]?.kind).toBe("head");
    expect(models[1]?.inputLanes).toEqual(models[0]?.outputLanes);
  });

  it("为合并提交建立第二父级泳道并在父提交处收束", () => {
    const commits = [
      commit("merge", ["main", "feature"]),
      commit("main", ["base"]),
      commit("feature", ["base"]),
      commit("base", []),
    ];
    const models = buildCommitGraphViewModels({
      commits,
      headSha: "merge",
      currentRef: null,
      upstreamRef: null,
      baseRef: null,
    });

    expect(models[0]?.outputLanes.map((lane) => lane.id)).toEqual(["main", "feature"]);
    expect(getCommitGraphNodeIndex(models[1]!)).toBe(0);
    expect(getCommitGraphNodeIndex(models[2]!)).toBe(1);
    expect(models[2]?.outputLanes.map((lane) => lane.id)).toEqual(["base", "base"]);
  });

  it("优先使用当前、远端和基础引用的语义颜色", () => {
    const current = {
      id: "refs/heads/feature",
      name: "feature",
      revision: "c",
      kind: "head" as const,
    };
    const remote = {
      id: "refs/remotes/origin/feature",
      name: "origin/feature",
      revision: "b",
      kind: "remote" as const,
    };
    const base = { id: "refs/heads/main", name: "main", revision: "a", kind: "branch" as const };
    const commits = [
      commit("c", ["b"], [current]),
      commit("b", ["a"], [remote]),
      commit("a", [], [base]),
    ];
    const models = buildCommitGraphViewModels({
      commits,
      headSha: "c",
      currentRef: current.id,
      upstreamRef: remote.id,
      baseRef: "main",
    });

    expect(models[0]?.outputLanes[0]?.color).toBe("current");
    expect(models[1]?.outputLanes[0]?.color).toBe("remote");
  });
});
