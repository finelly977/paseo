import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import { estimateAssistantMessageHeightFromCache as estimateAssistantImageMessageHeightFromCache } from "@/utils/assistant-image-metadata";
import { getMarkdownBlockGap, splitMarkdownBlocks } from "@/utils/split-markdown-blocks";

const ASSISTANT_MARKDOWN_BLOCK_HEIGHT_CACHE_LIMIT = 1000;
const ASSISTANT_MARKDOWN_BLOCK_ESTIMATE_WIDTH = MAX_CONTENT_WIDTH - 16;
const ASSISTANT_MESSAGE_VERTICAL_PADDING = 24;
export const DEFAULT_ASSISTANT_MARKDOWN_BLOCK_GAP = 8;

interface MarkdownBlockHeightInput {
  block: string;
  width: number;
}

const assistantMarkdownBlockHeightCache = new Map<string, number>();

function touchCacheEntry<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size <= limit) {
    return;
  }
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) {
    cache.delete(oldestKey);
  }
}

function hashMarkdownBlock(block: string): string {
  let hash = 2166136261;
  for (let index = 0; index < block.length; index += 1) {
    hash ^= block.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${block.length}:${(hash >>> 0).toString(36)}`;
}

function normalizeMarkdownBlockWidth(width: number): number | null {
  if (!Number.isFinite(width) || width <= 0) {
    return null;
  }
  return Math.round(width);
}

function normalizeParagraphSpacing(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_ASSISTANT_MARKDOWN_BLOCK_GAP;
  }
  if (!Number.isFinite(value)) {
    return DEFAULT_ASSISTANT_MARKDOWN_BLOCK_GAP;
  }
  return Math.max(0, Math.round(value));
}

function createMarkdownBlockHeightKey(input: MarkdownBlockHeightInput): string | null {
  const normalizedWidth = normalizeMarkdownBlockWidth(input.width);
  if (normalizedWidth === null) {
    return null;
  }
  if (input.block.length === 0) {
    return null;
  }
  return `${normalizedWidth}:${hashMarkdownBlock(input.block)}`;
}

export function setAssistantMarkdownBlockHeight(input: {
  block: string;
  width: number;
  height: number;
}): number | null {
  if (!Number.isFinite(input.height) || input.height <= 0) {
    return null;
  }
  const key = createMarkdownBlockHeightKey({
    block: input.block,
    width: input.width,
  });
  if (!key) {
    return null;
  }
  const height = Math.ceil(input.height);
  touchCacheEntry(
    assistantMarkdownBlockHeightCache,
    key,
    height,
    ASSISTANT_MARKDOWN_BLOCK_HEIGHT_CACHE_LIMIT,
  );
  return height;
}

function estimateAssistantMarkdownBlockHeightFromCache(
  markdown: string,
  paragraphSpacing: number,
): number | null {
  const blocks = splitMarkdownBlocks(markdown);
  if (blocks.length === 0) {
    return null;
  }

  let blockHeight = 0;
  for (const block of blocks) {
    const key = createMarkdownBlockHeightKey({
      block,
      width: ASSISTANT_MARKDOWN_BLOCK_ESTIMATE_WIDTH,
    });
    const cachedHeight = key ? assistantMarkdownBlockHeightCache.get(key) : undefined;
    if (cachedHeight === undefined) {
      return null;
    }
    blockHeight += cachedHeight;
  }

  const blockGap = blocks.reduce(
    (total, block, index) =>
      total + getMarkdownBlockGap(block, blocks[index + 1], paragraphSpacing),
    0,
  );

  return ASSISTANT_MESSAGE_VERTICAL_PADDING + blockHeight + blockGap;
}

// Fallback estimate used when no measured height is cached yet: a paragraph
// line is ~1.4em tall, code lines are taller, and empty lines between blocks
// add a paragraph gap. This is a coarse first-frame anchor; the real height is
// measured and cached via onLayout shortly after.
const ESTIMATE_PARAGRAPH_LINE_HEIGHT = 20;
const ESTIMATE_CODE_LINE_HEIGHT = 21;
const ESTIMATE_MAX_LINES = 40;

function estimateMarkdownTextHeight(markdown: string, paragraphSpacing: number): number | null {
  if (markdown.length === 0) {
    return null;
  }
  const lines = markdown.split("\n");
  const estimatedLines = Math.min(lines.length, ESTIMATE_MAX_LINES);
  let codeLineCount = 0;
  let inFence = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      codeLineCount += 1;
    }
  }
  const textLineCount = estimatedLines - codeLineCount;
  const lineHeight =
    codeLineCount * ESTIMATE_CODE_LINE_HEIGHT + textLineCount * ESTIMATE_PARAGRAPH_LINE_HEIGHT;
  // Add a gap between the estimated lines; paragraphs in markdown are separated
  // by blank lines, which the collapsed markdown treats as spacing.
  const blockGaps = Math.max(0, Math.min(lines.length, ESTIMATE_MAX_LINES) / 8) * paragraphSpacing;
  return Math.ceil(ASSISTANT_MESSAGE_VERTICAL_PADDING + lineHeight + blockGaps);
}

export function estimateAssistantMessageHeightFromCache(
  markdown: string,
  paragraphSpacing?: number,
): number | null {
  const normalizedParagraphSpacing = normalizeParagraphSpacing(paragraphSpacing);
  return (
    estimateAssistantMarkdownBlockHeightFromCache(markdown, normalizedParagraphSpacing) ??
    estimateAssistantImageMessageHeightFromCache(markdown) ??
    estimateMarkdownTextHeight(markdown, normalizedParagraphSpacing)
  );
}

export function clearAssistantMessageHeightEstimateCache(): void {
  assistantMarkdownBlockHeightCache.clear();
}
