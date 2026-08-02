// Monospace glyphs are roughly 0.6em wide. The diff sidebar's minimum width is
// 280px; using that as the budget keeps the wrapped estimate conservative (a
// wider sidebar fits more chars, so this under-estimates slightly rather than
// over-estimating, which is the safer direction for scroll anchoring).
const MONOSPACE_CHAR_WIDTH_RATIO = 0.6;
const DIFF_WRAP_ESTIMATE_WIDTH = 280;

/**
 * Estimates how many monospace characters fit on one wrapped diff line at the
 * sidebar's minimum width. Used to predict the wrapped row count for virtualized
 * diff heights before the real layout is measured.
 */
export function estimateWrappedCharsPerLine(codeFontSize: number): number {
  const charWidth = codeFontSize * MONOSPACE_CHAR_WIDTH_RATIO;
  return Math.floor(DIFF_WRAP_ESTIMATE_WIDTH / charWidth);
}
