import type { CheckoutCommitReference } from "@getpaseo/protocol/messages";
import type { ClassifiedCheckoutCommit } from "@/git/use-commits-query";

export const COMMIT_GRAPH_ROW_HEIGHT = 22;
export const COMMIT_GRAPH_LANE_WIDTH = 11;

export type CommitGraphColorRole =
  | "current"
  | "remote"
  | "base"
  | "lane-1"
  | "lane-2"
  | "lane-3"
  | "lane-4"
  | "lane-5";

export interface CommitGraphLane {
  id: string;
  color: CommitGraphColorRole;
}

export interface CommitGraphViewModel {
  commit: ClassifiedCheckoutCommit;
  inputLanes: CommitGraphLane[];
  outputLanes: CommitGraphLane[];
  kind: "head" | "node";
}

const LANE_COLORS: CommitGraphColorRole[] = ["lane-1", "lane-2", "lane-3", "lane-4", "lane-5"];

function cloneLanes(lanes: CommitGraphLane[]): CommitGraphLane[] {
  return lanes.map((lane) => ({ ...lane }));
}

function normalizeRefName(value: string): string {
  return value
    .replace(/^refs\/(heads|remotes|tags)\//, "")
    .replace(/^origin\//, "")
    .replace(/^tag:\s*/, "");
}

function findReferenceRole(
  reference: CheckoutCommitReference,
  currentRef: string | null,
  upstreamRef: string | null,
  baseRef: string | null,
): CommitGraphColorRole | undefined {
  if (reference.id === currentRef || reference.kind === "head") {
    return "current";
  }
  if (reference.id === upstreamRef) {
    return "remote";
  }
  if (baseRef && normalizeRefName(reference.id) === normalizeRefName(baseRef)) {
    return "base";
  }
  return undefined;
}

function buildReferenceColorMap({
  commits,
  currentRef,
  upstreamRef,
  baseRef,
}: {
  commits: ClassifiedCheckoutCommit[];
  currentRef: string | null;
  upstreamRef: string | null;
  baseRef: string | null;
}): Map<string, CommitGraphColorRole> {
  const colors = new Map<string, CommitGraphColorRole>();
  for (const commit of commits) {
    for (const reference of commit.references) {
      const role = findReferenceRole(reference, currentRef, upstreamRef, baseRef);
      if (role) {
        colors.set(reference.id, role);
      }
    }
  }
  return colors;
}

function getCommitReferenceColor(
  commit: ClassifiedCheckoutCommit,
  referenceColors: Map<string, CommitGraphColorRole>,
): CommitGraphColorRole | undefined {
  for (const reference of commit.references) {
    const color = referenceColors.get(reference.id);
    if (color) {
      return color;
    }
  }
  return undefined;
}

export function buildCommitGraphViewModels({
  commits,
  headSha,
  currentRef,
  upstreamRef,
  baseRef,
}: {
  commits: ClassifiedCheckoutCommit[];
  headSha: string | null;
  currentRef: string | null;
  upstreamRef: string | null;
  baseRef: string | null;
}): CommitGraphViewModel[] {
  const referenceColors = buildReferenceColorMap({ commits, currentRef, upstreamRef, baseRef });
  const commitsBySha = new Map(commits.map((commit) => [commit.sha, commit]));
  const viewModels: CommitGraphViewModel[] = [];
  let colorIndex = -1;

  for (const commit of commits) {
    const previousOutputLanes = viewModels.at(-1)?.outputLanes ?? [];
    const inputLanes = cloneLanes(previousOutputLanes);
    const outputLanes: CommitGraphLane[] = [];
    let firstParentAdded = false;

    if (commit.parentShas.length > 0) {
      for (const lane of inputLanes) {
        if (lane.id !== commit.sha) {
          outputLanes.push({ ...lane });
          continue;
        }
        if (firstParentAdded) {
          continue;
        }
        outputLanes.push({
          id: commit.parentShas[0],
          color: getCommitReferenceColor(commit, referenceColors) ?? lane.color,
        });
        firstParentAdded = true;
      }
    }

    for (let index = firstParentAdded ? 1 : 0; index < commit.parentShas.length; index += 1) {
      let color: CommitGraphColorRole | undefined;
      if (index === 0) {
        color = getCommitReferenceColor(commit, referenceColors);
      } else {
        const parent = commitsBySha.get(commit.parentShas[index]);
        color = parent ? getCommitReferenceColor(parent, referenceColors) : undefined;
      }
      if (!color) {
        colorIndex = (colorIndex + 1) % LANE_COLORS.length;
        color = LANE_COLORS[colorIndex];
      }
      outputLanes.push({ id: commit.parentShas[index], color });
    }

    viewModels.push({
      commit,
      inputLanes,
      outputLanes,
      kind: commit.sha === headSha ? "head" : "node",
    });
  }

  return viewModels;
}

export function getCommitGraphNodeIndex(viewModel: CommitGraphViewModel): number {
  const inputIndex = viewModel.inputLanes.findIndex((lane) => lane.id === viewModel.commit.sha);
  return inputIndex === -1 ? viewModel.inputLanes.length : inputIndex;
}

export function getCommitGraphWidth(viewModel: CommitGraphViewModel): number {
  return (
    COMMIT_GRAPH_LANE_WIDTH *
    (Math.max(viewModel.inputLanes.length, viewModel.outputLanes.length, 1) + 1)
  );
}
