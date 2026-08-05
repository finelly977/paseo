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
const TRANSPARENT = "transparent";
interface CommitGraphNodeProps {
  viewModel: CommitGraphViewModel;
  width: number;
  selected: boolean;
  hovered: boolean;
  expanded: boolean;
}

interface CommitGraphPalette {
  colors: Record<CommitGraphColorRole, string>;
  rowBackground: string;
  selectedBackground: string;
  hoveredBackground: string;
}

function resolveGraphColor(theme: Theme, role: CommitGraphColorRole): string {
  switch (role) {
    case "current":
      return theme.colorScheme === "dark" ? "#59a4f9" : "#0063d3";
    case "remote":
      return theme.colorScheme === "dark" ? "#b180d7" : "#652d90";
    case "base":
      return "#ea5c00";
    case "lane-1":
      return "#ffb000";
    case "lane-2":
      return "#dc267f";
    case "lane-3":
      return "#994f00";
    case "lane-4":
      return "#40b0a6";
    case "lane-5":
      return "#b66dff";
  }
}

const graphPaletteMapping = (theme: Theme): { palette: CommitGraphPalette } => ({
  palette: {
    colors: {
      current: resolveGraphColor(theme, "current"),
      remote: resolveGraphColor(theme, "remote"),
      base: resolveGraphColor(theme, "base"),
      "lane-1": resolveGraphColor(theme, "lane-1"),
      "lane-2": resolveGraphColor(theme, "lane-2"),
      "lane-3": resolveGraphColor(theme, "lane-3"),
      "lane-4": resolveGraphColor(theme, "lane-4"),
      "lane-5": resolveGraphColor(theme, "lane-5"),
    },
    rowBackground: theme.colors.surface0,
    selectedBackground: theme.colors.surface2,
    hoveredBackground: theme.colors.surfaceSidebarHover,
  },
});

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
  palette,
  rowBackground,
  hovered,
}: {
  kind: CommitGraphViewModel["kind"];
  hasMultipleParents: boolean;
  centerX: number;
  centerY: number;
  color: CommitGraphColorRole;
  palette: CommitGraphPalette;
  rowBackground: string;
  hovered: boolean;
}): ReactNode {
  const nodeColor = palette.colors[color];
  const outerStroke = rowBackground === palette.rowBackground ? rowBackground : TRANSPARENT;
  if (kind === "head") {
    return (
      <>
        <Circle
          cx={centerX}
          cy={centerY}
          r={CIRCLE_RADIUS + 3}
          fill={nodeColor}
          stroke={outerStroke}
          strokeWidth={CIRCLE_STROKE_WIDTH}
        />
        <Circle
          cx={centerX}
          cy={centerY}
          r={CIRCLE_STROKE_WIDTH}
          fill={hovered ? palette.hoveredBackground : palette.rowBackground}
          stroke={rowBackground}
          strokeWidth={CIRCLE_RADIUS}
        />
      </>
    );
  }
  if (hasMultipleParents) {
    return (
      <>
        <Circle
          cx={centerX}
          cy={centerY}
          r={CIRCLE_RADIUS + 2}
          fill={nodeColor}
          stroke={outerStroke}
          strokeWidth={CIRCLE_STROKE_WIDTH}
        />
        <Circle
          cx={centerX}
          cy={centerY}
          r={CIRCLE_RADIUS - 1}
          fill={nodeColor}
          stroke={rowBackground}
          strokeWidth={CIRCLE_STROKE_WIDTH}
        />
      </>
    );
  }
  return (
    <Circle
      cx={centerX}
      cy={centerY}
      r={CIRCLE_RADIUS + 1}
      fill={nodeColor}
      stroke={outerStroke}
      strokeWidth={CIRCLE_STROKE_WIDTH}
    />
  );
}

function CommitGraphNodeBase({
  viewModel,
  width,
  selected,
  hovered,
  expanded,
  palette,
}: CommitGraphNodeProps & { palette: CommitGraphPalette }) {
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
  let rowBackground = palette.rowBackground;
  if (hovered) {
    rowBackground = palette.hoveredBackground;
  }
  if (selected) {
    rowBackground = palette.selectedBackground;
  }
  return (
    <Svg width={width} height={COMMIT_GRAPH_ROW_HEIGHT} testID={`commit-graph-${commit.shortSha}`}>
      {paths.map((path, index) => (
        <Path
          key={path.key}
          d={path.d}
          fill="none"
          stroke={palette.colors[path.color]}
          strokeWidth={expanded && index === paths.length - 1 ? 3 : 1}
          strokeLinecap="round"
        />
      ))}
      {renderCommitMarker({
        kind: viewModel.kind,
        hasMultipleParents: commit.parentShas.length > 1,
        centerX,
        centerY,
        color: circleColor,
        palette,
        rowBackground,
        hovered,
      })}
    </Svg>
  );
}

const ThemedCommitGraphNode = withUnistyles(CommitGraphNodeBase);

export function CommitGraphNode(props: CommitGraphNodeProps) {
  return <ThemedCommitGraphNode {...props} uniProps={graphPaletteMapping} />;
}

function buildPlaceholderPaths(lanes: CommitGraphLane[]) {
  const occurrences = new Map<string, number>();
  return lanes.map((lane) => {
    const occurrence = occurrences.get(lane.id) ?? 0;
    occurrences.set(lane.id, occurrence + 1);
    return { lane, key: `${lane.id}-${occurrence}` };
  });
}

function CommitGraphPlaceholderBase({
  lanes,
  width,
  palette,
}: {
  lanes: CommitGraphLane[];
  width: number;
  palette: CommitGraphPalette;
}) {
  const paths = buildPlaceholderPaths(lanes);
  return (
    <Svg width={width} height={COMMIT_GRAPH_ROW_HEIGHT}>
      {paths.map(({ lane, key }, index) => (
        <Path
          key={key}
          d={`M ${COMMIT_GRAPH_LANE_WIDTH * (index + 1)} 0 V ${COMMIT_GRAPH_ROW_HEIGHT}`}
          fill="none"
          stroke={palette.colors[lane.color]}
          strokeWidth={1}
          strokeLinecap="round"
        />
      ))}
    </Svg>
  );
}

const ThemedCommitGraphPlaceholder = withUnistyles(CommitGraphPlaceholderBase);

export function CommitGraphPlaceholder(props: { lanes: CommitGraphLane[]; width: number }) {
  return <ThemedCommitGraphPlaceholder {...props} uniProps={graphPaletteMapping} />;
}
