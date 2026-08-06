import { createContext, useContext } from "react";
import {
  DEFAULT_SIDEBAR_HORIZONTAL_PADDING,
  DEFAULT_SIDEBAR_PROJECT_SPACING,
  DEFAULT_SIDEBAR_ROW_VERTICAL_PADDING,
  DEFAULT_SIDEBAR_SESSION_SPACING,
} from "@/hooks/use-settings";

export interface SidebarListSpacing {
  horizontalPadding: number;
  projectSpacing: number;
  sessionSpacing: number;
  rowVerticalPadding: number;
}

export const SidebarListSpacingContext = createContext<SidebarListSpacing>({
  horizontalPadding: DEFAULT_SIDEBAR_HORIZONTAL_PADDING,
  projectSpacing: DEFAULT_SIDEBAR_PROJECT_SPACING,
  sessionSpacing: DEFAULT_SIDEBAR_SESSION_SPACING,
  rowVerticalPadding: DEFAULT_SIDEBAR_ROW_VERTICAL_PADDING,
});

export function useSidebarListSpacing(): SidebarListSpacing {
  return useContext(SidebarListSpacingContext);
}
