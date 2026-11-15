import type { ReactElement, ReactNode } from "react";

export interface ComposerControlSlots {
  permission: ReactNode;
  models: ReactNode;
  thinking: ReactNode;
}

export type RenderComposerControls = (slots: ComposerControlSlots) => ReactElement;
