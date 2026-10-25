import { describe, expect, it } from "vitest";
import type { ClassifiedCheckoutCommit } from "@/git/use-commits-query";
import {
  buildCommitGraphViewModels,
  getCommitGraphNodeIndex,
  resolveCommitGraphHeight,
} from "./graph-model";

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
  it("行内只保留当前分支及跟踪远端，其余引用仍完整留给预览", () => {
    const current = { id: "refs/heads/main", name: "main", revision: "c", kind: "head" as const };
    const remote = {
      id: "refs/remotes/origin/main",
      name: "origin/main",
      revision: "c",
      kind: "remote" as const,
    };
    const other = {
      id: "refs/heads/fix/old",
      name: "fix/old",
      revision: "c",
      kind: "branch" as const,
    };
    const tag = { id: "refs/tags/v0.2.5", name: "v0.2.5", revision: "c", kind: "tag" as const };
    const input = commit("c", [], [tag, other, remote, current]);
    const [model] = buildCommitGraphViewModels({
      commits: [input],
      headSha: "c",
      currentRef: current.id,
      upstreamRef: remote.id,
      baseRef: null,
    });
    expect(model.inlineReferences).toEqual([current, remote]);
    expect(model.commit.references).toEqual([tag, other, remote, current]);
  });

  it("历史分支及版本标签不挤占普通提交行", () => {
    const old = {
      id: "refs/heads/fix/history",
      name: "fix/history",
      revision: "old",
      kind: "branch" as const,
    };
    const [model] = buildCommitGraphViewModels({
      commits: [commit("old", [], [old])],
      headSha: "new",
      currentRef: "refs/heads/main",
      upstreamRef: "refs/remotes/origin/main",
      baseRef: old.id,
    });
    expect(model.inlineReferences).toEqual([]);
    expect(model.commit.references).toEqual([old]);
  });

  it("远端落后当前分支时，只在对应提交保留跟踪远端，隐藏其他远端", () => {
    const upstream = {
      id: "refs/remotes/origin/main",
      name: "origin/main",
      revision: "old",
      kind: "remote" as const,
    };
    const unrelated = { ...upstream, id: "refs/remotes/backup/main", name: "backup/main" };
    const [model] = buildCommitGraphViewModels({
      commits: [commit("old", [], [unrelated, upstream])],
      headSha: "new",
      currentRef: "refs/heads/main",
      upstreamRef: upstream.id,
      baseRef: null,
    });
    expect(model.inlineReferences).toEqual([upstream]);
    expect(model.commit.references).toEqual([unrelated, upstream]);
  });
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

describe("resolveCommitGraphHeight", () => {
  it("保留视口范围内的用户高度", () => {
    expect(resolveCommitGraphHeight(436, 900)).toBe(436);
  });

  it("限制最小高度、最大高度和视口占比", () => {
    expect(resolveCommitGraphHeight(80, 900)).toBe(140);
    expect(resolveCommitGraphHeight(900, 1600)).toBe(720);
    expect(resolveCommitGraphHeight(700, 600)).toBe(420);
  });
});
