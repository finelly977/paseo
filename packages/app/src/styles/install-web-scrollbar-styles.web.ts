import {
  WEB_SCROLLBAR_SIZE_PX,
  webScrollbarColor,
  webScrollbarHandleCssValue,
  webScrollbarThumbColor,
  WEB_SCROLLBAR_WIDTH,
} from "@/styles/web-scrollbar";
import { trackWebScrollbarVisibility } from "./web-scrollbar-visibility.web";

const STYLE_ID = "paseo-web-scrollbar-styles";
const handleColor = webScrollbarHandleCssValue();

export function installWebScrollbarStyles(): () => void {
  const existingStyle = document.getElementById(STYLE_ID);
  if (existingStyle) return () => {};

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
* {
  scrollbar-color: transparent transparent;
  scrollbar-width: ${WEB_SCROLLBAR_WIDTH};
}

[data-scrollbar-x], [data-scrollbar-y] {
  scrollbar-color: ${webScrollbarColor(handleColor)};
}

@supports selector(::-webkit-scrollbar) {
  *, [data-scrollbar-x], [data-scrollbar-y] { scrollbar-width: auto; scrollbar-color: auto; }
}

[data-composer-input] {
  scrollbar-gutter: stable;
}

[data-hidden-scrollbar] {
  scrollbar-width: none;
}

[data-hidden-scrollbar]::-webkit-scrollbar {
  width: 0;
  height: 0;
}

*::-webkit-scrollbar {
  width: ${WEB_SCROLLBAR_SIZE_PX}px;
  height: ${WEB_SCROLLBAR_SIZE_PX}px;
  background: transparent;
}

*::-webkit-scrollbar-track,
*::-webkit-scrollbar-corner {
  background: transparent;
}

*::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: transparent;
  background-clip: content-box;
}

[data-scrollbar-y]::-webkit-scrollbar-thumb:vertical,
[data-scrollbar-x]::-webkit-scrollbar-thumb:horizontal {
  background-color: ${webScrollbarThumbColor(handleColor)};
}
`;
  document.head.append(style);
  const stopTracking = trackWebScrollbarVisibility();

  return () => {
    stopTracking();
    style.remove();
  };
}
