import type { ReactElement, ReactNode } from "react";

export interface ComposerControlSlots {
  permission: ReactNode;
  models: ReactNode;
  maxEffort: boolean;
}

export type RenderComposerControls = (slots: ComposerControlSlots) => ReactElement;
