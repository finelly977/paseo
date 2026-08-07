function getFenceDelimiter(line: string) {
  const match = /^( {0,3})(`{3,}|~{3,})/.exec(line);
  return match?.[2] ?? null;
}

export function splitMarkdownBlocks(text: string): string[] {
  if (text.length === 0) {
    return [];
  }

  const blocks: string[] = [];
  let currentLines: string[] = [];
  let activeFenceCharacter: "`" | "~" | null = null;
  let activeFenceLength = 0;
  let sawBlockSeparator = false;

  for (const line of text.split("\n")) {
    const isBlankLine = line.trim().length === 0;

    if (!activeFenceCharacter && isBlankLine) {
      if (currentLines.length > 0) {
        sawBlockSeparator = true;
      }
      continue;
    }

    if (!activeFenceCharacter && sawBlockSeparator) {
      blocks.push(currentLines.join("\n"));
      currentLines = [];
      sawBlockSeparator = false;
    }

    currentLines.push(line);

    const fenceDelimiter = getFenceDelimiter(line);
    if (!fenceDelimiter) {
      continue;
    }

    if (!activeFenceCharacter) {
      activeFenceCharacter = fenceDelimiter[0] as "`" | "~";
      activeFenceLength = fenceDelimiter.length;
      continue;
    }

    if (fenceDelimiter[0] === activeFenceCharacter && fenceDelimiter.length >= activeFenceLength) {
      activeFenceCharacter = null;
      activeFenceLength = 0;
    }
  }

  if (currentLines.length > 0) {
    blocks.push(currentLines.join("\n"));
  }

  return blocks.filter((block) => block.length > 0);
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
