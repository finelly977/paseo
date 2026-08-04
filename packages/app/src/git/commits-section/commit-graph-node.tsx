import type { ReactNode } from "react";
import Svg, { Circle, Path } from "react-native-svg";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import {
  COMMIT_GRAPH_LANE_WIDTH,
  COMMIT_GRAPH_ROW_HEIGHT,
  getCommitGraphNodeIndex,
  type CommitGraphColorRole,
  type CommitGraphLane,
  type CommitGraphViewModel,
} from "./graph-model";

const CURVE_RADIUS = 5;
const CIRCLE_RADIUS = 4;
const CIRCLE_STROKE_WIDTH = 2;
const GRAPH_COLOR_ROLES: CommitGraphColorRole[] = [
  "current",
  "remote",
  "base",
  "lane-1",
  "lane-2",
  "lane-3",
  "lane-4",
  "lane-5",
];

const ThemedCircle = withUnistyles(Circle);
const ThemedPath = withUnistyles(Path);

interface CommitGraphNodeProps {
  viewModel: CommitGraphViewModel;
  width: number;
  selected: boolean;
}

function resolveGraphColor(theme: Theme, role: CommitGraphColorRole): string {
  switch (role) {
    case "current":
      return theme.colors.accentBright;
    case "remote":
      return theme.colors.statusMerged;
    case "base":
      return theme.colors.statusWarning;
    case "lane-1":
      return theme.colors.terminal.yellow;
    case "lane-2":
      return theme.colors.terminal.magenta;
    case "lane-3":
      return theme.colors.terminal.brightYellow;
    case "lane-4":
      return theme.colors.terminal.cyan;
    case "lane-5":
      return theme.colors.terminal.brightMagenta;
  }
}

const lineColorMappings = Object.fromEntries(
  GRAPH_COLOR_ROLES.map((role) => [
    role,
    (theme: Theme) => ({ stroke: resolveGraphColor(theme, role) }),
  ]),
) as Record<CommitGraphColorRole, (theme: Theme) => { stroke: string }>;

const innerCircleMappings = Object.fromEntries(
  GRAPH_COLOR_ROLES.map((role) => [
    role,
    (theme: Theme) => ({ fill: resolveGraphColor(theme, role) }),
  ]),
) as Record<CommitGraphColorRole, (theme: Theme) => { fill: string }>;

function createNodeCircleMappings(selected: boolean) {
  return Object.fromEntries(
    GRAPH_COLOR_ROLES.map((role) => [
      role,
      (theme: Theme) => ({
        fill: selected ? theme.colors.surface2 : theme.colors.surface0,
        stroke: resolveGraphColor(theme, role),
      }),
    ]),
  ) as Record<CommitGraphColorRole, (theme: Theme) => { fill: string; stroke: string }>;
}

const nodeCircleMappings = {
  default: createNodeCircleMappings(false),
  selected: createNodeCircleMappings(true),
};

function findLastLaneIndex(lanes: CommitGraphLane[], id: string): number {
  for (let index = lanes.length - 1; index >= 0; index -= 1) {
    if (lanes[index].id === id) {
      return index;
    }
  }
  return -1;
}

function renderCommitMarker({
  kind,
  hasMultipleParents,
  centerX,
  centerY,
  color,
  selected,
}: {
  kind: CommitGraphViewModel["kind"];
  hasMultipleParents: boolean;
  centerX: number;
  centerY: number;
  color: CommitGraphColorRole;
  selected: boolean;
}): ReactNode {
  const nodeMapping = nodeCircleMappings[selected ? "selected" : "default"][color];
  if (kind === "head") {
    return (
      <>
        <ThemedCircle
          cx={centerX}
          cy={centerY}
          r={CIRCLE_RADIUS + 3}
          strokeWidth={CIRCLE_STROKE_WIDTH}
          uniProps={nodeMapping}
        />
        <ThemedCircle cx={centerX} cy={centerY} r={2} uniProps={innerCircleMappings[color]} />
      </>
    );
  }
  if (hasMultipleParents) {
    return (
      <>
        <ThemedCircle
          cx={centerX}
          cy={centerY}
          r={CIRCLE_RADIUS + 2}
          strokeWidth={CIRCLE_STROKE_WIDTH}
          uniProps={nodeMapping}
        />
        <ThemedCircle
          cx={centerX}
          cy={centerY}
          r={CIRCLE_RADIUS - 1}
          uniProps={innerCircleMappings[color]}
        />
      </>
    );
  }
  return (
    <ThemedCircle
      cx={centerX}
      cy={centerY}
      r={CIRCLE_RADIUS + 1}
      strokeWidth={CIRCLE_STROKE_WIDTH}
      uniProps={nodeMapping}
    />
  );
}

export function CommitGraphNode({ viewModel, width, selected }: CommitGraphNodeProps) {
  const { commit, inputLanes, outputLanes } = viewModel;
  const inputIndex = inputLanes.findIndex((lane) => lane.id === commit.sha);
  const circleIndex = getCommitGraphNodeIndex(viewModel);
  const circleColor =
    outputLanes[circleIndex]?.color ?? inputLanes[circleIndex]?.color ?? "current";
  const paths: Array<{ key: string; d: string; color: CommitGraphColorRole }> = [];
  let outputLaneIndex = 0;

  for (let index = 0; index < inputLanes.length; index += 1) {
    const lane = inputLanes[index];
    if (lane.id === commit.sha) {
      if (index !== circleIndex) {
        paths.push({
          key: `current-${index}`,
          color: lane.color,
          d: `M ${COMMIT_GRAPH_LANE_WIDTH * (index + 1)} 0 A ${COMMIT_GRAPH_LANE_WIDTH} ${COMMIT_GRAPH_LANE_WIDTH} 0 0 1 ${COMMIT_GRAPH_LANE_WIDTH * index} ${COMMIT_GRAPH_LANE_WIDTH} H ${COMMIT_GRAPH_LANE_WIDTH * (circleIndex + 1)}`,
        });
      } else {
        outputLaneIndex += 1;
      }
      continue;
    }

    if (outputLaneIndex < outputLanes.length && lane.id === outputLanes[outputLaneIndex].id) {
      if (index === outputLaneIndex) {
        paths.push({
          key: `vertical-${index}`,
          color: lane.color,
          d: `M ${COMMIT_GRAPH_LANE_WIDTH * (index + 1)} 0 V ${COMMIT_GRAPH_ROW_HEIGHT}`,
        });
      } else {
        paths.push({
          key: `shift-${index}-${outputLaneIndex}`,
          color: lane.color,
          d: `M ${COMMIT_GRAPH_LANE_WIDTH * (index + 1)} 0 V 6 A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 1 ${COMMIT_GRAPH_LANE_WIDTH * (index + 1) - CURVE_RADIUS} ${COMMIT_GRAPH_ROW_HEIGHT / 2} H ${COMMIT_GRAPH_LANE_WIDTH * (outputLaneIndex + 1) + CURVE_RADIUS} A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 0 ${COMMIT_GRAPH_LANE_WIDTH * (outputLaneIndex + 1)} ${COMMIT_GRAPH_ROW_HEIGHT / 2 + CURVE_RADIUS} V ${COMMIT_GRAPH_ROW_HEIGHT}`,
        });
      }
      outputLaneIndex += 1;
    }
  }

  for (let index = 1; index < commit.parentShas.length; index += 1) {
    const parentOutputIndex = findLastLaneIndex(outputLanes, commit.parentShas[index]);
    if (parentOutputIndex === -1) {
      continue;
    }
    paths.push({
      key: `parent-${index}`,
      color: outputLanes[parentOutputIndex].color,
      d: `M ${COMMIT_GRAPH_LANE_WIDTH * parentOutputIndex} ${COMMIT_GRAPH_ROW_HEIGHT / 2} A ${COMMIT_GRAPH_LANE_WIDTH} ${COMMIT_GRAPH_LANE_WIDTH} 0 0 1 ${COMMIT_GRAPH_LANE_WIDTH * (parentOutputIndex + 1)} ${COMMIT_GRAPH_ROW_HEIGHT} M ${COMMIT_GRAPH_LANE_WIDTH * parentOutputIndex} ${COMMIT_GRAPH_ROW_HEIGHT / 2} H ${COMMIT_GRAPH_LANE_WIDTH * (circleIndex + 1)}`,
    });
  }

  if (inputIndex !== -1) {
    paths.push({
      key: "into-node",
      color: inputLanes[inputIndex].color,
      d: `M ${COMMIT_GRAPH_LANE_WIDTH * (circleIndex + 1)} 0 V ${COMMIT_GRAPH_ROW_HEIGHT / 2}`,
    });
  }
  if (commit.parentShas.length > 0) {
    paths.push({
      key: "from-node",
      color: circleColor,
      d: `M ${COMMIT_GRAPH_LANE_WIDTH * (circleIndex + 1)} ${COMMIT_GRAPH_ROW_HEIGHT / 2} V ${COMMIT_GRAPH_ROW_HEIGHT}`,
    });
  }

  const centerX = COMMIT_GRAPH_LANE_WIDTH * (circleIndex + 1);
  const centerY = COMMIT_GRAPH_ROW_HEIGHT / 2;
  return (
    <Svg width={width} height={COMMIT_GRAPH_ROW_HEIGHT} testID={`commit-graph-${commit.shortSha}`}>
      {paths.map((path) => (
        <ThemedPath
          key={path.key}
          d={path.d}
          fill="none"
          strokeWidth={1}
          strokeLinecap="round"
          uniProps={lineColorMappings[path.color]}
        />
      ))}
      {renderCommitMarker({
        kind: viewModel.kind,
        hasMultipleParents: commit.parentShas.length > 1,
        centerX,
        centerY,
        color: circleColor,
        selected,
      })}
    </Svg>
  );
}

function buildPlaceholderPaths(lanes: CommitGraphLane[]) {
  const occurrences = new Map<string, number>();
  return lanes.map((lane) => {
    const occurrence = occurrences.get(lane.id) ?? 0;
    occurrences.set(lane.id, occurrence + 1);
    return { lane, key: `${lane.id}-${occurrence}` };
  });
}

export function CommitGraphPlaceholder({
  lanes,
  width,
}: {
  lanes: CommitGraphLane[];
  width: number;
}) {
  const paths = buildPlaceholderPaths(lanes);
  return (
    <Svg width={width} height={COMMIT_GRAPH_ROW_HEIGHT}>
      {paths.map(({ lane, key }, index) => (
        <ThemedPath
          key={key}
          d={`M ${COMMIT_GRAPH_LANE_WIDTH * (index + 1)} 0 V ${COMMIT_GRAPH_ROW_HEIGHT}`}
          fill="none"
          strokeWidth={1}
          strokeLinecap="round"
          uniProps={lineColorMappings[lane.color]}
        />
      ))}
    </Svg>
  );
}
