import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ClassifiedCheckoutCommit } from "@/git/use-commits-query";

interface CommitGraphNodeProps {
  commit: ClassifiedCheckoutCommit;
  isFirst: boolean;
  isLast: boolean;
  isOnBaseLane: boolean;
  isBranchPoint: boolean;
}

export function CommitGraphNode({
  commit,
  isFirst,
  isLast,
  isOnBaseLane,
  isBranchPoint,
}: CommitGraphNodeProps) {
  const railColor = isOnBaseLane ? styles.railBase : styles.railWorkspace;
  const markerColor = isOnBaseLane ? styles.markerBase : styles.markerWorkspace;
  const lanePosition = isOnBaseLane ? styles.baseLane : styles.workspaceLane;

  return (
    <View style={styles.container}>
      {isBranchPoint ? (
        <>
          <View style={[styles.branchIncoming, styles.railWorkspace]} />
          <View style={[styles.branchConnector, styles.railWorkspace]} />
        </>
      ) : null}
      {isFirst && isLast ? null : (
        <View
          style={[
            styles.rail,
            lanePosition,
            railColor,
            isFirst && styles.railFirst,
            isLast && styles.railLast,
            isBranchPoint && styles.railBranchPoint,
          ]}
        />
      )}
      <View
        testID={commit.isOnRemote ? "commit-dot-remote" : "commit-dot-local"}
        style={[styles.marker, lanePosition, markerColor, !commit.isOnRemote && styles.markerRing]}
      />
    </View>
  );
}

const MARKER_SIZE = 8;
const RAIL_WIDTH = 2;
const WORKSPACE_LANE_LEFT = 3;
const BASE_LANE_LEFT = 15;

const styles = StyleSheet.create((theme) => ({
  container: {
    width: 24,
    alignSelf: "stretch",
    justifyContent: "center",
    position: "relative",
    flexShrink: 0,
  },
  rail: {
    position: "absolute",
    top: -theme.spacing[1] - 1,
    bottom: -theme.spacing[1] - 1,
    width: RAIL_WIDTH,
  },
  workspaceLane: {
    left: WORKSPACE_LANE_LEFT,
  },
  baseLane: {
    left: BASE_LANE_LEFT,
  },
  railFirst: {
    top: "50%",
  },
  railLast: {
    bottom: "50%",
  },
  railBranchPoint: {
    top: "50%",
  },
  branchIncoming: {
    position: "absolute",
    top: -theme.spacing[1] - 1,
    height: "34%",
    left: WORKSPACE_LANE_LEFT,
    width: RAIL_WIDTH,
  },
  branchConnector: {
    position: "absolute",
    top: "35%",
    left: WORKSPACE_LANE_LEFT + 1,
    width: 14,
    height: RAIL_WIDTH,
    transform: [{ rotate: "24deg" }],
  },
  railBase: {
    backgroundColor: theme.colors.foregroundMuted,
  },
  railWorkspace: {
    backgroundColor: theme.colors.accent,
  },
  marker: {
    position: "absolute",
    marginLeft: -(MARKER_SIZE - RAIL_WIDTH) / 2,
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[2],
    zIndex: 1,
  },
  markerBase: {
    backgroundColor: theme.colors.foregroundMuted,
    borderColor: theme.colors.foregroundMuted,
  },
  markerWorkspace: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  markerRing: {
    backgroundColor: theme.colors.surface0,
  },
}));
