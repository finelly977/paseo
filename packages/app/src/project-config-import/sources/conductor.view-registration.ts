import { createElement } from "react";
import type { ProjectConfigImportIconProps, ProjectConfigImportViewModule } from "./view-registry";

function ConductorImportIcon(props: ProjectConfigImportIconProps) {
  const { ConductorIcon } = require("./conductor.view") as typeof import("./conductor.view");
  return createElement(ConductorIcon, props);
}

export const conductorProjectConfigImportView = {
  kind: "conductor",
  Icon: ConductorImportIcon,
} satisfies ProjectConfigImportViewModule;
