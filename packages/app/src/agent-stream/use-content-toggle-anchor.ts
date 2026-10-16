import { useEffect, useRef, useState } from "react";
import { createContentToggleAnchor, type ContentToggleAnchorPort } from "./content-toggle-anchor";

export function useContentToggleAnchor(port: Omit<ContentToggleAnchorPort, "setActive">) {
  const [active, setActive] = useState(false);
  const portRef = useRef(port);
  portRef.current = port;
  const [controller] = useState(() =>
    createContentToggleAnchor({
      inverted: port.inverted,
      getOffset: () => portRef.current.getOffset(),
      setOffset: (offset) => portRef.current.setOffset(offset),
      detach: () => portRef.current.detach(),
      setActive,
    }),
  );
  useEffect(() => () => controller.cancel(), [controller]);
  return { active, ...controller };
}
