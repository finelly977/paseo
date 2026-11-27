/**
 * @vitest-environment jsdom
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  convertOmmlElementToMathMl,
  hydrateDocxMathPlaceholders,
  prepareDocxWithMathPlaceholders,
} from "./docx-math";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MATH_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";

function parseOmml(innerXml: string): Element {
  const xml = `<root xmlns:w="${WORD_NS}" xmlns:m="${MATH_NS}">${innerXml}</root>`;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const first = doc.documentElement.firstElementChild;
  if (!first) throw new Error("Missing OMML root element");
  return first;
}

describe("docx OMML to MathML conversion", () => {
  it("converts sSubSup (P_t^e, pi_t^e) and accented subscripts (bar{Y}_t) without dropping symbols", () => {
    const omml = parseOmml(`
      <m:oMathPara>
        <m:oMath>
          <m:sSub>
            <m:e><m:r><m:t>P</m:t></m:r></m:e>
            <m:sub><m:r><m:t>t</m:t></m:r></m:sub>
          </m:sSub>
          <m:r><m:t>-</m:t></m:r>
          <m:sSubSup>
            <m:e><m:r><m:t>P</m:t></m:r></m:e>
            <m:sub><m:r><m:t>t</m:t></m:r></m:sub>
            <m:sup><m:r><m:t>e</m:t></m:r></m:sup>
          </m:sSubSup>
          <m:r><m:t>=</m:t></m:r>
          <m:f>
            <m:num>
              <m:sSub>
                <m:e><m:r><m:t>Y</m:t></m:r></m:e>
                <m:sub><m:r><m:t>t</m:t></m:r></m:sub>
              </m:sSub>
              <m:r><m:t>-</m:t></m:r>
              <m:sSub>
                <m:e>
                  <m:acc>
                    <m:accPr><m:chr m:val="&#x0304;"/></m:accPr>
                    <m:e><m:r><m:t>Y</m:t></m:r></m:e>
                  </m:acc>
                </m:e>
                <m:sub><m:r><m:t>t</m:t></m:r></m:sub>
              </m:sSub>
            </m:num>
            <m:den><m:r><m:t>α</m:t></m:r></m:den>
          </m:f>
        </m:oMath>
      </m:oMathPara>
    `);

    const mathEl = convertOmmlElementToMathMl(omml, document, "block");
    expect(mathEl.tagName).toBe("math");
    expect(mathEl.getAttribute("display")).toBe("block");

    // sSubSup -> msubsup (P_t^e)
    const msubsup = mathEl.querySelector("msubsup");
    expect(msubsup).not.toBeNull();
    expect(msubsup?.textContent).toBe("Pte");

    // acc -> mover with macron overbar (bar{Y}) inside msub (bar{Y}_t)
    const mover = mathEl.querySelector("mover");
    expect(mover).not.toBeNull();
    expect(mover?.getAttribute("accent")).toBe("true");
    expect(mover?.textContent).toBe("Y\u00AF");

    // mfrac denominator alpha
    const mfrac = mathEl.querySelector("mfrac");
    expect(mfrac).not.toBeNull();
    expect(mfrac?.children[1]?.textContent).toBe("α");

    // Never uses invalid <ms> or <mn> wrappers for math runs/scripts
    expect(mathEl.querySelector("ms")).toBeNull();
  });

  it("wraps compound subscript expressions (P_{t-1}) in <mrow> instead of <mn>", () => {
    const omml = parseOmml(`
      <m:oMath>
        <m:sSub>
          <m:e><m:r><m:t>P</m:t></m:r></m:e>
          <m:sub><m:r><m:t>t-1</m:t></m:r></m:sub>
        </m:sSub>
      </m:oMath>
    `);

    const mathEl = convertOmmlElementToMathMl(omml, document, "inline");
    const msub = mathEl.querySelector("msub");
    expect(msub).not.toBeNull();
    const subChild = msub?.children[1];
    expect(subChild?.tagName).toBe("mrow");
    expect(Array.from(subChild?.children ?? []).map((el) => [el.tagName, el.textContent])).toEqual([
      ["mi", "t"],
      ["mo", "\u2212"],
      ["mn", "1"],
    ]);
  });

  it("handles CJK prose runs, delimiters, radicals, and n-ary sums safely", () => {
    const omml = parseOmml(`
      <m:oMath>
        <m:r><m:rPr><m:nor/></m:rPr><m:t>价格水平</m:t></m:r>
        <m:r><m:t>→</m:t></m:r>
        <m:r><m:rPr><m:nor/></m:rPr><m:t>通胀率</m:t></m:r>
        <m:d>
          <m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr>
          <m:e><m:r><m:t>αP</m:t></m:r></m:e>
        </m:d>
        <m:rad>
          <m:radPr><m:degHide m:val="1"/></m:radPr>
          <m:deg/>
          <m:e><m:r><m:t>x</m:t></m:r></m:e>
        </m:rad>
        <m:nary>
          <m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/></m:naryPr>
          <m:sub><m:r><m:t>i=1</m:t></m:r></m:sub>
          <m:sup><m:r><m:t>n</m:t></m:r></m:sup>
          <m:e><m:r><m:t>x</m:t></m:r></m:e>
        </m:nary>
      </m:oMath>
    `);

    const mathEl = convertOmmlElementToMathMl(omml, document, "inline");
    expect(Array.from(mathEl.querySelectorAll("mtext")).map((el) => el.textContent)).toEqual([
      "价格水平",
      "通胀率",
    ]);
    expect(mathEl.querySelector("msqrt")?.textContent).toBe("x");
    const munderover = mathEl.querySelector("munderover");
    expect(munderover?.children.length).toBe(3);
    expect(munderover?.children[0]?.textContent).toBe("∑");
    expect(munderover?.children[1]?.textContent).toBe("i=1");
    expect(munderover?.children[2]?.textContent).toBe("n");
  });

  it("extracts OMML from a docx zip and hydrates placeholders into rendered DOM", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="${WORD_NS}" xmlns:m="${MATH_NS}">
        <w:body>
          <w:p>
            <w:r><w:t>内联公式 </w:t></w:r>
            <m:oMath>
              <m:sSubSup>
                <m:e><m:r><m:t>π</m:t></m:r></m:e>
                <m:sub><m:r><m:t>t</m:t></m:r></m:sub>
                <m:sup><m:r><m:t>e</m:t></m:r></m:sup>
              </m:sSubSup>
            </m:oMath>
            <w:r><w:t> 结束</w:t></w:r>
          </w:p>
          <w:p>
            <m:oMathPara>
              <m:oMath>
                <m:r><m:t>x=1</m:t></m:r>
              </m:oMath>
            </m:oMathPara>
          </w:p>
        </w:body>
      </w:document>`,
    );
    const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
    const prepared = await prepareDocxWithMathPlaceholders(bytes);
    expect(prepared.replacements.size).toBe(2);

    const repackedZip = await JSZip.loadAsync(prepared.buffer);
    const rewrittenXml = await repackedZip.file("word/document.xml")?.async("string");
    expect(rewrittenXml).not.toContain("oMath");
    expect(rewrittenXml).toContain("__PASEO_DOCX_MATH_0__");
    expect(rewrittenXml).toContain("__PASEO_DOCX_MATH_1__");

    const host = document.createElement("div");
    host.innerHTML =
      "<p><span>内联公式 __PASEO_DOCX_MATH_0__ 结束</span></p><p><span>__PASEO_DOCX_MATH_1__</span></p>";
    hydrateDocxMathPlaceholders(host, prepared.replacements);

    expect(host.textContent).not.toContain("__PASEO_DOCX_MATH_");
    expect(host.querySelector(".paseo-docx-math-inline math msubsup")?.textContent).toBe("πte");
    expect(host.querySelector('.paseo-docx-math-block math[display="block"]')?.textContent).toBe(
      "x=1",
    );
  });

  it("skips repacking when a docx contains no OMML formulas", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="${WORD_NS}"><w:body><w:p><w:r><w:t>纯文本</w:t></w:r></w:p></w:body></w:document>`,
    );
    const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
    const prepared = await prepareDocxWithMathPlaceholders(bytes);
    expect(prepared.replacements.size).toBe(0);
    expect(prepared.buffer.byteLength).toBe(bytes.byteLength);
  });
});
