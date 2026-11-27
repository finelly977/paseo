import JSZip from "jszip";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MATH_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

const TOKEN_PREFIX = "__PASEO_DOCX_MATH_";
const TOKEN_SUFFIX = "__";
const TOKEN_PATTERN = /(__PASEO_DOCX_MATH_\d+__)/g;

const DOCX_XML_PART_PATTERN = /^word\/(?:document|footnotes|endnotes|header\d*|footer\d*)\.xml$/i;

const UPRIGHT_MATH_FUNCTIONS = new Set([
  "sin",
  "cos",
  "tan",
  "cot",
  "sec",
  "csc",
  "arcsin",
  "arccos",
  "arctan",
  "sinh",
  "cosh",
  "tanh",
  "log",
  "ln",
  "exp",
  "lim",
  "limsup",
  "liminf",
  "max",
  "min",
  "sup",
  "inf",
  "arg",
  "deg",
  "det",
  "dim",
  "gcd",
  "hom",
  "ker",
  "Pr",
  "mod",
]);

/** 将 OOXML 组合重音码点规范化为 MathML Core 可正确居中拉伸的非组合重音符号。 */
const COMBINING_ACCENT_MAP: Record<string, string> = {
  "\u0300": "\u0060", // grave
  "\u0301": "\u00B4", // acute
  "\u0302": "\u02C6", // circumflex / hat
  "\u0303": "\u02DC", // tilde
  "\u0304": "\u00AF", // macron / bar
  "\u0305": "\u00AF", // overline / bar
  "\u0306": "\u02D8", // breve
  "\u0307": "\u02D9", // dot
  "\u0308": "\u00A8", // ddot
  "\u030A": "\u02DA", // ring
  "\u030C": "\u02C7", // caron / check
  "\u20D7": "\u2192", // right arrow / vec
  "\u20D6": "\u2190", // left arrow
  "\u20E1": "\u2194", // left-right arrow
  "^": "\u02C6",
  "~": "\u02DC",
  "\u203E": "\u00AF",
};

const MATH_OPERATOR_PATTERN =
  /^[\s+\-\u2212=<>≤≥≠≈≡∼≃≅∝±∓×÷·⋅∗∘•/\\()[\]{}|‖,;:!?'′″°∂∇∑∏∫∬∭∮⋂⋃⋀⋁⊕⊗∈∉⊂⊃⊆⊇∀∃¬∧∨→←↔⇒⇐⇔↦↑↓]+$/u;

const CJK_OR_PROSE_PATTERN = /[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/u;

export interface MathMlNode {
  tag: string;
  attrs?: Record<string, string>;
  text?: string;
  children?: MathMlNode[];
}

export interface DocxMathReplacement {
  tree: MathMlNode;
  display: "inline" | "block";
}

export interface PreparedDocxPreview {
  buffer: ArrayBuffer;
  replacements: Map<string, DocxMathReplacement>;
}

function getChildElements(parent: Element): Element[] {
  const result: Element[] = [];
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) {
      result.push(child as Element);
    }
  }
  return result;
}

function findDirectChild(parent: Element, localName: string): Element | null {
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && (child as Element).localName === localName) {
      return child as Element;
    }
  }
  return null;
}

function getOmmlAttr(element: Element | null, attrLocalName: string): string | null {
  if (!element) return null;
  const namespaced = element.getAttributeNS(MATH_NS, attrLocalName);
  if (namespaced !== null) return namespaced;
  const prefixed = element.getAttribute(`m:${attrLocalName}`);
  if (prefixed !== null) return prefixed;
  return element.getAttribute(attrLocalName);
}

function getPropVal(parent: Element, prTagName: string, propTagName: string): string | null {
  const pr = findDirectChild(parent, prTagName);
  if (!pr) return null;
  const prop = findDirectChild(pr, propTagName);
  return getOmmlAttr(prop, "val");
}

function isPropTruthy(parent: Element, prTagName: string, propTagName: string): boolean {
  const pr = findDirectChild(parent, prTagName);
  if (!pr) return false;
  const prop = findDirectChild(pr, propTagName);
  if (!prop) return false;
  const val = getOmmlAttr(prop, "val");
  return val === null || val === "1" || val === "true" || val === "on";
}

function createMathEl(
  doc: Document,
  tagName: string,
  attrs?: Record<string, string>,
  children?: Node[],
): Element {
  const el = doc.createElementNS(MATHML_NS, tagName);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
  }
  if (children) {
    for (const child of children) {
      el.appendChild(child);
    }
  }
  return el;
}

function createTextToken(
  doc: Document,
  tagName: "mi" | "mn" | "mo" | "mtext",
  text: string,
  attrs?: Record<string, string>,
): Element {
  const el = createMathEl(doc, tagName, attrs);
  el.textContent = text;
  return el;
}

function wrapInMrow(doc: Document, nodes: Element[]): Element {
  if (nodes.length === 1 && nodes[0]) {
    return nodes[0];
  }
  return createMathEl(doc, "mrow", undefined, nodes);
}

function resolveMathVariant(run: Element): { normal: boolean; variant: string | null } {
  const rPr = findDirectChild(run, "rPr");
  if (!rPr) return { normal: false, variant: null };
  const normal = isPropTruthy(run, "rPr", "nor");
  const sty = getOmmlAttr(findDirectChild(rPr, "sty"), "val");
  const scr = getOmmlAttr(findDirectChild(rPr, "scr"), "val");

  if (scr === "double-struck") return { normal, variant: "double-struck" };
  if (scr === "script") return { normal, variant: sty === "b" ? "bold-script" : "script" };
  if (scr === "fraktur") return { normal, variant: sty === "b" ? "bold-fraktur" : "fraktur" };
  if (scr === "sans-serif")
    return { normal, variant: sty === "b" ? "bold-sans-serif" : "sans-serif" };
  if (scr === "monospace") return { normal, variant: "monospace" };

  if (sty === "p") return { normal, variant: "normal" };
  if (sty === "b") return { normal, variant: "bold" };
  if (sty === "bi") return { normal, variant: "bold-italic" };
  if (sty === "i") return { normal, variant: "italic" };
  return { normal, variant: null };
}

function tokenizeMathRunText(
  doc: Document,
  text: string,
  style: { normal: boolean; variant: string | null },
): Element[] {
  if (!text) return [];
  if (style.normal || CJK_OR_PROSE_PATTERN.test(text)) {
    const attrs = style.variant ? { mathvariant: style.variant } : undefined;
    return [createTextToken(doc, "mtext", text, attrs)];
  }

  const tokens: Element[] = [];
  // 按数字、字母串、单个符号/运算符切分，避免把 "αP" 拼成正体多字母 <mi> 或把 "t-1" 糊在一起
  const segmentPattern = /(\d+(?:\.\d+)?|[A-Za-z\u0370-\u03FF\u2100-\u214F]+|\s+|.)/gu;
  for (const match of text.matchAll(segmentPattern)) {
    const piece = match[0];
    if (!piece || /^\s+$/u.test(piece)) {
      continue;
    }
    if (/^\d/u.test(piece)) {
      const attrs = style.variant ? { mathvariant: style.variant } : undefined;
      tokens.push(createTextToken(doc, "mn", piece, attrs));
      continue;
    }
    if (MATH_OPERATOR_PATTERN.test(piece)) {
      const normalized = piece === "-" ? "\u2212" : piece;
      tokens.push(createTextToken(doc, "mo", normalized));
      continue;
    }
    if (UPRIGHT_MATH_FUNCTIONS.has(piece) || style.variant === "normal") {
      tokens.push(createTextToken(doc, "mi", piece, { mathvariant: style.variant ?? "normal" }));
      continue;
    }
    const attrs = style.variant ? { mathvariant: style.variant } : undefined;
    for (const char of Array.from(piece)) {
      tokens.push(createTextToken(doc, "mi", char, attrs));
    }
  }
  return tokens;
}

function convertRun(doc: Document, run: Element): Element[] {
  let text = "";
  for (const child of getChildElements(run)) {
    if (child.localName === "t") {
      text += child.textContent ?? "";
    }
  }
  if (!text) return [];
  return tokenizeMathRunText(doc, text, resolveMathVariant(run));
}

function convertContainerChildren(doc: Document, container: Element | null): Element[] {
  if (!container) return [];
  const out: Element[] = [];
  for (const child of getChildElements(container)) {
    out.push(...convertOmmlNode(doc, child));
  }
  return out;
}

function convertFraction(doc: Document, elem: Element): Element {
  const num = wrapInMrow(doc, convertContainerChildren(doc, findDirectChild(elem, "num")));
  const den = wrapInMrow(doc, convertContainerChildren(doc, findDirectChild(elem, "den")));
  const fracType = getPropVal(elem, "fPr", "type");
  if (fracType === "lin") {
    return createMathEl(doc, "mrow", undefined, [num, createTextToken(doc, "mo", "/"), den]);
  }
  if (fracType === "noBar") {
    return createMathEl(doc, "mfrac", { linethickness: "0" }, [num, den]);
  }
  return createMathEl(doc, "mfrac", undefined, [num, den]);
}

function convertAccent(doc: Document, elem: Element): Element {
  const base = wrapInMrow(doc, convertContainerChildren(doc, findDirectChild(elem, "e")));
  const rawChar = getPropVal(elem, "accPr", "chr") ?? "\u0302";
  const accentChar = COMBINING_ACCENT_MAP[rawChar] ?? rawChar;
  const accentOp = createTextToken(doc, "mo", accentChar, { stretchy: "true" });
  return createMathEl(doc, "mover", { accent: "true" }, [base, accentOp]);
}

function convertBar(doc: Document, elem: Element): Element {
  const base = wrapInMrow(doc, convertContainerChildren(doc, findDirectChild(elem, "e")));
  const pos = getPropVal(elem, "barPr", "pos");
  if (pos === "bot") {
    const barOp = createTextToken(doc, "mo", "_", { stretchy: "true" });
    return createMathEl(doc, "munder", { accentunder: "true" }, [base, barOp]);
  }
  const barOp = createTextToken(doc, "mo", "\u00AF", { stretchy: "true" });
  return createMathEl(doc, "mover", { accent: "true" }, [base, barOp]);
}

function convertRadical(doc: Document, elem: Element): Element {
  const base = wrapInMrow(doc, convertContainerChildren(doc, findDirectChild(elem, "e")));
  const degHide = isPropTruthy(elem, "radPr", "degHide");
  const degNodes = degHide ? [] : convertContainerChildren(doc, findDirectChild(elem, "deg"));
  if (degNodes.length === 0) {
    return createMathEl(doc, "msqrt", undefined, [base]);
  }
  return createMathEl(doc, "mroot", undefined, [base, wrapInMrow(doc, degNodes)]);
}

function convertDelimiter(doc: Document, elem: Element): Element {
  const dPr = findDirectChild(elem, "dPr");
  const begChrNode = dPr ? findDirectChild(dPr, "begChr") : null;
  const endChrNode = dPr ? findDirectChild(dPr, "endChr") : null;
  const sepChrNode = dPr ? findDirectChild(dPr, "sepChr") : null;
  const begChr = begChrNode ? (getOmmlAttr(begChrNode, "val") ?? "") : "(";
  const endChr = endChrNode ? (getOmmlAttr(endChrNode, "val") ?? "") : ")";
  const sepChr = sepChrNode ? (getOmmlAttr(sepChrNode, "val") ?? "|") : "|";

  const children: Element[] = [];
  if (begChr) {
    children.push(createTextToken(doc, "mo", begChr, { fence: "true", stretchy: "true" }));
  }
  const parts = getChildElements(elem).filter((child) => child.localName === "e");
  parts.forEach((part, index) => {
    if (index > 0 && sepChr) {
      children.push(createTextToken(doc, "mo", sepChr, { separator: "true", stretchy: "true" }));
    }
    children.push(wrapInMrow(doc, convertContainerChildren(doc, part)));
  });
  if (endChr) {
    children.push(createTextToken(doc, "mo", endChr, { fence: "true", stretchy: "true" }));
  }
  return createMathEl(doc, "mrow", undefined, children);
}

function convertNary(doc: Document, elem: Element): Element {
  const chr = getPropVal(elem, "naryPr", "chr") ?? "\u222B";
  const limLoc = getPropVal(elem, "naryPr", "limLoc");
  const subHide = isPropTruthy(elem, "naryPr", "subHide");
  const supHide = isPropTruthy(elem, "naryPr", "supHide");
  const subNodes = subHide ? [] : convertContainerChildren(doc, findDirectChild(elem, "sub"));
  const supNodes = supHide ? [] : convertContainerChildren(doc, findDirectChild(elem, "sup"));
  const bodyNodes = convertContainerChildren(doc, findDirectChild(elem, "e"));

  const op = createTextToken(doc, "mo", chr, { largeop: "true", movablelimits: "true" });
  const useUnderOver = limLoc === "undOvr";
  let operatorNode: Element = op;
  if (subNodes.length > 0 && supNodes.length > 0) {
    operatorNode = createMathEl(doc, useUnderOver ? "munderover" : "msubsup", undefined, [
      op,
      wrapInMrow(doc, subNodes),
      wrapInMrow(doc, supNodes),
    ]);
  } else if (subNodes.length > 0) {
    operatorNode = createMathEl(doc, useUnderOver ? "munder" : "msub", undefined, [
      op,
      wrapInMrow(doc, subNodes),
    ]);
  } else if (supNodes.length > 0) {
    operatorNode = createMathEl(doc, useUnderOver ? "mover" : "msup", undefined, [
      op,
      wrapInMrow(doc, supNodes),
    ]);
  }

  return createMathEl(doc, "mrow", undefined, [operatorNode, ...bodyNodes]);
}

function convertGroupChar(doc: Document, elem: Element): Element {
  const base = wrapInMrow(doc, convertContainerChildren(doc, findDirectChild(elem, "e")));
  const chr = getPropVal(elem, "groupChrPr", "chr") ?? "\u23DF";
  const pos = getPropVal(elem, "groupChrPr", "pos");
  const op = createTextToken(doc, "mo", chr, { stretchy: "true" });
  return createMathEl(doc, pos === "top" ? "mover" : "munder", undefined, [base, op]);
}

function convertMatrix(doc: Document, elem: Element): Element {
  const rows: Element[] = [];
  for (const child of getChildElements(elem)) {
    if (child.localName !== "mr") continue;
    const cells = getChildElements(child)
      .filter((cell) => cell.localName === "e")
      .map((cell) => createMathEl(doc, "mtd", undefined, convertContainerChildren(doc, cell)));
    rows.push(createMathEl(doc, "mtr", undefined, cells));
  }
  return createMathEl(doc, "mtable", undefined, rows);
}

function convertEquationArray(doc: Document, elem: Element): Element {
  const rows = getChildElements(elem)
    .filter((child) => child.localName === "e")
    .map((line) =>
      createMathEl(doc, "mtr", undefined, [
        createMathEl(doc, "mtd", undefined, convertContainerChildren(doc, line)),
      ]),
    );
  return createMathEl(doc, "mtable", undefined, rows);
}

function convertScriptElement(doc: Document, elem: Element): Element | null {
  const base = wrapInMrow(doc, convertContainerChildren(doc, findDirectChild(elem, "e")));
  if (elem.localName === "sSub") {
    const sub = wrapInMrow(doc, convertContainerChildren(doc, findDirectChild(elem, "sub")));
    return createMathEl(doc, "msub", undefined, [base, sub]);
  }
  if (elem.localName === "sSup") {
    const sup = wrapInMrow(doc, convertContainerChildren(doc, findDirectChild(elem, "sup")));
    return createMathEl(doc, "msup", undefined, [base, sup]);
  }
  if (elem.localName === "sSubSup") {
    const sub = wrapInMrow(doc, convertContainerChildren(doc, findDirectChild(elem, "sub")));
    const sup = wrapInMrow(doc, convertContainerChildren(doc, findDirectChild(elem, "sup")));
    return createMathEl(doc, "msubsup", undefined, [base, sub, sup]);
  }
  if (elem.localName === "sPre") {
    const sub = wrapInMrow(doc, convertContainerChildren(doc, findDirectChild(elem, "sub")));
    const sup = wrapInMrow(doc, convertContainerChildren(doc, findDirectChild(elem, "sup")));
    return createMathEl(doc, "mmultiscripts", undefined, [
      base,
      createMathEl(doc, "mprescripts"),
      sub,
      sup,
    ]);
  }
  return null;
}

function convertFunction(doc: Document, elem: Element): Element {
  const fName = wrapInMrow(doc, convertContainerChildren(doc, findDirectChild(elem, "fName")));
  const base = wrapInMrow(doc, convertContainerChildren(doc, findDirectChild(elem, "e")));
  return createMathEl(doc, "mrow", undefined, [fName, createTextToken(doc, "mo", "\u2061"), base]);
}

function convertLimit(doc: Document, elem: Element, tagName: "munder" | "mover"): Element {
  const base = wrapInMrow(doc, convertContainerChildren(doc, findDirectChild(elem, "e")));
  const lim = wrapInMrow(doc, convertContainerChildren(doc, findDirectChild(elem, "lim")));
  return createMathEl(doc, tagName, undefined, [base, lim]);
}

function convertBorderBox(doc: Document, elem: Element): Element {
  const inner = convertContainerChildren(doc, findDirectChild(elem, "e"));
  return createMathEl(
    doc,
    "mrow",
    { style: "border: 1px solid currentColor; padding: 2px 4px;" },
    inner,
  );
}

function convertPhantom(doc: Document, elem: Element): Element {
  const inner = convertContainerChildren(doc, findDirectChild(elem, "e"));
  const showVal = getPropVal(elem, "phantPr", "show");
  const tagName = showVal === "0" || showVal === "false" ? "mphantom" : "mrow";
  return createMathEl(doc, tagName, undefined, inner);
}

const OMML_ELEMENT_CONVERTERS: Record<string, (doc: Document, elem: Element) => Element> = {
  f: convertFraction,
  acc: convertAccent,
  bar: convertBar,
  rad: convertRadical,
  d: convertDelimiter,
  nary: convertNary,
  groupChr: convertGroupChar,
  m: convertMatrix,
  eqArr: convertEquationArray,
  func: convertFunction,
  limLow: (doc, elem) => convertLimit(doc, elem, "munder"),
  limUpp: (doc, elem) => convertLimit(doc, elem, "mover"),
  borderBox: convertBorderBox,
  phant: convertPhantom,
};

function convertOmmlNode(doc: Document, elem: Element): Element[] {
  const name = elem.localName;
  if (name.endsWith("Pr")) {
    return [];
  }
  if (name === "r") {
    return convertRun(doc, elem);
  }
  const scriptNode = convertScriptElement(doc, elem);
  if (scriptNode) {
    return [scriptNode];
  }
  const converter = OMML_ELEMENT_CONVERTERS[name];
  if (converter) {
    return [converter(doc, elem)];
  }
  // 保留 box/e/oMath 及未知包裹节点内部的子表达式，避免整段公式被静默丢弃。
  return convertContainerChildren(doc, elem);
}

function serializeElementToTree(el: Element): MathMlNode {
  const attrs: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i += 1) {
    const attr = el.attributes[i];
    if (!attr || attr.name === "xmlns") continue;
    attrs[attr.name] = attr.value;
  }
  const node: MathMlNode = { tag: el.localName };
  if (Object.keys(attrs).length > 0) {
    node.attrs = attrs;
  }
  const childElements = getChildElements(el);
  if (childElements.length > 0) {
    node.children = childElements.map(serializeElementToTree);
  } else if (el.textContent) {
    node.text = el.textContent;
  }
  return node;
}

function buildMathMlDom(ownerDoc: Document, node: MathMlNode): Element {
  const el = ownerDoc.createElementNS(MATHML_NS, node.tag);
  if (node.attrs) {
    for (const [key, value] of Object.entries(node.attrs)) {
      el.setAttribute(key, value);
    }
  }
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      el.appendChild(buildMathMlDom(ownerDoc, child));
    }
  } else if (node.text !== undefined) {
    el.textContent = node.text;
  }
  return el;
}

export function convertOmmlElementToMathMl(
  ommlElement: Element,
  targetDoc: Document,
  display: "inline" | "block",
): Element {
  let children: Element[];
  if (ommlElement.localName === "oMathPara") {
    const equations = getChildElements(ommlElement).filter((child) => child.localName === "oMath");
    if (equations.length <= 1) {
      children = convertContainerChildren(targetDoc, equations[0] ?? ommlElement);
    } else {
      const rows = equations.map((eq) =>
        createMathEl(targetDoc, "mtr", undefined, [
          createMathEl(targetDoc, "mtd", undefined, convertContainerChildren(targetDoc, eq)),
        ]),
      );
      children = [createMathEl(targetDoc, "mtable", undefined, rows)];
    }
  } else {
    children = convertContainerChildren(targetDoc, ommlElement);
  }

  return createMathEl(
    targetDoc,
    "math",
    { display },
    children.length > 0 ? children : [createMathEl(targetDoc, "mrow")],
  );
}

function collectTopLevelOmmlNodes(root: Element): Element[] {
  const found: Element[] = [];
  const walk = (node: Element) => {
    for (const child of getChildElements(node)) {
      if (child.localName === "oMathPara" || child.localName === "oMath") {
        found.push(child);
        continue;
      }
      walk(child);
    }
  };
  walk(root);
  return found;
}

function createPlaceholderRun(xmlDoc: Document, token: string): Element {
  const run = xmlDoc.createElementNS(WORD_NS, "w:r");
  const text = xmlDoc.createElementNS(WORD_NS, "w:t");
  text.setAttributeNS(XML_NS, "xml:space", "preserve");
  text.textContent = token;
  run.appendChild(text);
  return run;
}

function ensureParagraphCenteredForDisplayMath(paragraph: Element, xmlDoc: Document): void {
  const nonPrChildren = getChildElements(paragraph).filter((el) => el.localName !== "pPr");
  if (nonPrChildren.length !== 1) {
    return;
  }
  let pPr = findDirectChild(paragraph, "pPr");
  if (pPr && findDirectChild(pPr, "jc")) {
    return;
  }
  if (!pPr) {
    pPr = xmlDoc.createElementNS(WORD_NS, "w:pPr");
    paragraph.insertBefore(pPr, paragraph.firstChild);
  }
  const jc = xmlDoc.createElementNS(WORD_NS, "w:jc");
  jc.setAttributeNS(WORD_NS, "w:val", "center");
  pPr.appendChild(jc);
}

function replaceOmmlNodeWithPlaceholder(
  ommlNode: Element,
  xmlDoc: Document,
  token: string,
  display: "inline" | "block",
): void {
  const parent = ommlNode.parentNode;
  if (!parent) return;

  const placeholderRun = createPlaceholderRun(xmlDoc, token);
  const parentElement = parent.nodeType === 1 ? (parent as Element) : null;

  if (display === "block" && parentElement && parentElement.localName !== "p") {
    const paragraph = xmlDoc.createElementNS(WORD_NS, "w:p");
    const pPr = xmlDoc.createElementNS(WORD_NS, "w:pPr");
    const jc = xmlDoc.createElementNS(WORD_NS, "w:jc");
    jc.setAttributeNS(WORD_NS, "w:val", "center");
    pPr.appendChild(jc);
    paragraph.appendChild(pPr);
    paragraph.appendChild(placeholderRun);
    parent.replaceChild(paragraph, ommlNode);
    return;
  }

  parent.replaceChild(placeholderRun, ommlNode);
  if (display === "block" && parentElement && parentElement.localName === "p") {
    ensureParagraphCenteredForDisplayMath(parentElement, xmlDoc);
  }
}

export async function prepareDocxWithMathPlaceholders(
  bytes: Uint8Array,
): Promise<PreparedDocxPreview> {
  const replacements = new Map<string, DocxMathReplacement>();
  const zip = await JSZip.loadAsync(bytes);
  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  let modified = false;
  let tokenIndex = 0;

  const xmlPartNames = Object.keys(zip.files).filter(
    (name) => !zip.files[name]?.dir && DOCX_XML_PART_PATTERN.test(name),
  );

  for (const partName of xmlPartNames) {
    const entry = zip.file(partName);
    if (!entry) continue;
    const xmlText = await entry.async("string");
    if (!xmlText.includes("oMath")) {
      continue;
    }

    const xmlDoc = parser.parseFromString(xmlText, "application/xml");
    if (xmlDoc.getElementsByTagName("parsererror").length > 0 || !xmlDoc.documentElement) {
      continue;
    }

    const ommlNodes = collectTopLevelOmmlNodes(xmlDoc.documentElement);
    if (ommlNodes.length === 0) {
      continue;
    }

    for (const ommlNode of ommlNodes) {
      const display: "inline" | "block" = ommlNode.localName === "oMathPara" ? "block" : "inline";
      const mathMl = convertOmmlElementToMathMl(ommlNode, xmlDoc, display);
      const token = `${TOKEN_PREFIX}${tokenIndex}${TOKEN_SUFFIX}`;
      tokenIndex += 1;
      replacements.set(token, {
        tree: serializeElementToTree(mathMl),
        display,
      });
      replaceOmmlNodeWithPlaceholder(ommlNode, xmlDoc, token, display);
    }

    zip.file(partName, serializer.serializeToString(xmlDoc));
    modified = true;
  }

  if (!modified) {
    return { buffer: bytes.slice().buffer, replacements };
  }

  const repacked = await zip.generateAsync({ type: "arraybuffer" });
  return { buffer: repacked, replacements };
}

export function hydrateDocxMathPlaceholders(
  container: HTMLElement,
  replacements: ReadonlyMap<string, DocxMathReplacement>,
): void {
  if (replacements.size === 0) return;
  const ownerDoc = container.ownerDocument;
  const walker = ownerDoc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const matchedTextNodes: Text[] = [];

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue;
    if (value && value.includes(TOKEN_PREFIX)) {
      matchedTextNodes.push(node as Text);
    }
  }

  for (const textNode of matchedTextNodes) {
    const raw = textNode.nodeValue;
    const parent = textNode.parentNode;
    if (!raw || !parent) continue;

    const parts = raw.split(TOKEN_PATTERN);
    const fragment = ownerDoc.createDocumentFragment();
    for (const part of parts) {
      if (!part) continue;
      const replacement = replacements.get(part);
      if (!replacement) {
        fragment.appendChild(ownerDoc.createTextNode(part));
        continue;
      }
      const mathEl = buildMathMlDom(ownerDoc, replacement.tree);
      const wrapper = ownerDoc.createElement("span");
      wrapper.className =
        replacement.display === "block" ? "paseo-docx-math-block" : "paseo-docx-math-inline";
      wrapper.appendChild(mathEl);
      fragment.appendChild(wrapper);
    }
    parent.replaceChild(fragment, textNode);
  }
}
