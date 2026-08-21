export interface MatchScore {
  tier: number;
  offset: number;
  spread?: number;
}

function isWordBoundaryCharacter(character: string | undefined): boolean {
  return character === undefined || !/[a-z0-9]/.test(character);
}

function scoreTextMatch(query: string, text: string): MatchScore | null {
  const normalizedQuery = query.toLowerCase();
  const normalizedText = text.toLowerCase();
  if (!normalizedQuery) return { tier: 0, offset: 0 };
  if (normalizedText === normalizedQuery) return { tier: 0, offset: 0 };

  let bestSubstring: MatchScore | null = null;
  let position = 0;
  while (position <= normalizedText.length - normalizedQuery.length) {
    const offset = normalizedText.indexOf(normalizedQuery, position);
    if (offset === -1) break;
    const startsAtBoundary = isWordBoundaryCharacter(normalizedText[offset - 1]);
    const endsAtBoundary = isWordBoundaryCharacter(normalizedText[offset + normalizedQuery.length]);
    let tier = 4;
    if (startsAtBoundary && endsAtBoundary) {
      tier = 1;
    } else if (offset === 0) {
      tier = 2;
    } else if (startsAtBoundary) {
      tier = 3;
    }
    if (
      !bestSubstring ||
      tier < bestSubstring.tier ||
      (tier === bestSubstring.tier && offset < bestSubstring.offset)
    ) {
      bestSubstring = { tier, offset };
    }
    position = offset + 1;
  }
  if (bestSubstring) return bestSubstring;

  let queryIndex = 0;
  let firstOffset = -1;
  let lastOffset = -1;
  for (
    let textIndex = 0;
    textIndex < normalizedText.length && queryIndex < normalizedQuery.length;
    textIndex += 1
  ) {
    if (normalizedText[textIndex] !== normalizedQuery[queryIndex]) continue;
    if (firstOffset === -1) firstOffset = textIndex;
    lastOffset = textIndex;
    queryIndex += 1;
  }
  if (queryIndex !== normalizedQuery.length || firstOffset === -1) return null;
  return { tier: 5, offset: firstOffset, spread: lastOffset - firstOffset + 1 };
}

function compactText(value: string): { value: string; offsets: number[] } {
  let compact = "";
  const offsets: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (!character || !/[a-z0-9]/i.test(character)) continue;
    compact += character.toLowerCase();
    offsets.push(index);
  }
  return { value: compact, offsets };
}

export function scorePathMatch(query: string, path: string): MatchScore | null {
  const direct = scoreTextMatch(query, path);
  if (direct) return direct;

  const compactQuery = compactText(query);
  const compactPath = compactText(path);
  if (!compactQuery.value || !compactPath.value) return null;

  const compactScore = scoreTextMatch(compactQuery.value, compactPath.value);
  if (!compactScore) return null;
  return {
    ...compactScore,
    offset: compactPath.offsets[compactScore.offset] ?? compactScore.offset,
  };
}
