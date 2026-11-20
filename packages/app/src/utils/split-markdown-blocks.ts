function getFenceDelimiter(line: string) {
  const match = /^( {0,3})(`{3,}|~{3,})/.exec(line);
  return match?.[2] ?? null;
}

export interface IncrementalMarkdownBlocksState {
  readonly text: string;
  readonly blocks: readonly string[];
  /** 已通过后续空行与新块首行确认稳定的前置块数量；流式追加不会改写这些块。 */
  readonly stableBlockCount: number;
  /** 最后一个未完成块第一行在 text 中的字符偏移量。 */
  readonly tailStartOffset: number;
}

function scanMarkdownBlocks(text: string): {
  blocks: string[];
  lastBlockStartOffset: number;
} {
  if (text.length === 0) {
    return { blocks: [], lastBlockStartOffset: 0 };
  }

  const blocks: string[] = [];
  let lineStart = 0;
  let currentBlockStartOffset = 0;
  let currentLines: string[] = [];
  let activeFenceCharacter: "`" | "~" | null = null;
  let activeFenceLength = 0;
  let sawBlockSeparator = false;

  while (lineStart <= text.length) {
    const newlineIndex = text.indexOf("\n", lineStart);
    const line = newlineIndex === -1 ? text.slice(lineStart) : text.slice(lineStart, newlineIndex);
    const isBlankLine = line.trim().length === 0;

    if (!activeFenceCharacter && isBlankLine) {
      if (currentLines.length > 0) {
        sawBlockSeparator = true;
      }
    } else {
      if (!activeFenceCharacter && sawBlockSeparator) {
        const joined = currentLines.join("\n");
        if (joined.length > 0) {
          blocks.push(joined);
        }
        currentLines = [];
        sawBlockSeparator = false;
        currentBlockStartOffset = lineStart;
      } else if (currentLines.length === 0) {
        currentBlockStartOffset = lineStart;
      }

      currentLines.push(line);

      const fenceDelimiter = getFenceDelimiter(line);
      if (fenceDelimiter) {
        if (!activeFenceCharacter) {
          activeFenceCharacter = fenceDelimiter[0] as "`" | "~";
          activeFenceLength = fenceDelimiter.length;
        } else if (
          fenceDelimiter[0] === activeFenceCharacter &&
          fenceDelimiter.length >= activeFenceLength
        ) {
          activeFenceCharacter = null;
          activeFenceLength = 0;
        }
      }
    }

    if (newlineIndex === -1) {
      break;
    }
    lineStart = newlineIndex + 1;
  }

  if (currentLines.length > 0) {
    const joined = currentLines.join("\n");
    if (joined.length > 0) {
      blocks.push(joined);
    }
  }

  return { blocks, lastBlockStartOffset: currentBlockStartOffset };
}

export function splitMarkdownBlocks(text: string): string[] {
  return scanMarkdownBlocks(text).blocks;
}

/**
 * 增量切分流式 Markdown 块。追加正文时只重扫最后一个未完成块及其后续内容，
 * 与全量 `splitMarkdownBlocks(nextText)` 的输出严格逐元素一致。
 */
export function splitMarkdownBlocksIncremental(
  previous: IncrementalMarkdownBlocksState | null,
  nextText: string,
): IncrementalMarkdownBlocksState {
  if (previous && previous.text === nextText) {
    return previous;
  }

  if (previous && previous.tailStartOffset > 0 && nextText.startsWith(previous.text)) {
    const { blocks: tailBlocks, lastBlockStartOffset } = scanMarkdownBlocks(
      nextText.slice(previous.tailStartOffset),
    );
    const stablePrefix = previous.blocks.slice(0, previous.stableBlockCount);
    const blocks = [...stablePrefix, ...tailBlocks];
    const stableBlockCount =
      blocks.length >= 2 ? previous.stableBlockCount + Math.max(0, tailBlocks.length - 1) : 0;
    const tailStartOffset =
      tailBlocks.length >= 2
        ? previous.tailStartOffset + lastBlockStartOffset
        : previous.tailStartOffset;
    return {
      text: nextText,
      blocks,
      stableBlockCount,
      tailStartOffset,
    };
  }

  const { blocks, lastBlockStartOffset } = scanMarkdownBlocks(nextText);
  return {
    text: nextText,
    blocks,
    stableBlockCount: blocks.length >= 2 ? blocks.length - 1 : 0,
    tailStartOffset: blocks.length >= 2 ? lastBlockStartOffset : 0,
  };
}

export function isStandaloneMarkdownHorizontalRule(block: string): boolean {
  if (block.includes("\n")) {
    return false;
  }

  return /^(?: {0,3})(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(block);
}

export function getMarkdownBlockGap(
  block: string,
  nextBlock: string | undefined,
  paragraphSpacing: number,
): number {
  if (nextBlock === undefined) {
    return 0;
  }

  // 横线自身负责上下留白，两侧不再叠加外层段落间距。
  if (isStandaloneMarkdownHorizontalRule(block) || isStandaloneMarkdownHorizontalRule(nextBlock)) {
    return 0;
  }

  return paragraphSpacing;
}
