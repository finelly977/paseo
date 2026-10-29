// Apply the interface (UI) font app-wide on web.
//
// react-native-web stamps a hardcoded default font onto every text element, so a
// plain `body { font-family }` never cascades in — the element already has its own
// font. Instead we inject rules that point all text at CSS variables and set
// that variable live. The selector is high-specificity (1,2,0) so it deterministically
// beats both RN-web's base font and Unistyles' generated classes (0,1,0) — no reliance
// on stylesheet order. Modal 可能直接挂到 body 下，必须与主界面共用字体规则。
// Code/diff/terminal surfaces carry `data-pmono` (and have their
// subtree excluded via `:not([data-pmono] *)`) so they keep their monospace font.
const STYLE_ID = "paseo-ui-font";
const UI_SELECTOR = ":is(body, #root, #overlay-root) *:not([data-pmono]):not([data-pmono] *)";
// 紧凑徽标的字号由组件持有，不能为避开字号覆盖而误标成代码区域。
const RULE = `${UI_SELECTOR}{font-family:var(--paseo-ui-font);}
${UI_SELECTOR}:not([data-pcompact]):not([data-pcompact] *){font-size:var(--paseo-ui-font-size)!important;}`;

export function applyRootUiFont(uiFontStack: string, uiFontSize: number): void {
  if (typeof document === "undefined") return;
  // Strip anything that could break out of the CSS value; commas/quotes/spaces in a
  // font stack are fine.
  const value = uiFontStack
    .replace(/[<>{}();]/g, "")
    .replace(/[\r\n]/g, " ")
    .trim();
  if (value.length === 0) return;

  document.documentElement.style.setProperty("--paseo-ui-font", value);

  document.documentElement.style.setProperty("--paseo-ui-font-size", `${uiFontSize}px`);

  // The rule itself is static (references the variable); inject it once.
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = RULE;
    document.head.appendChild(style);
  }
}
