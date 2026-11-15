import { createMarkdownParser } from "@/utils/markdown-parser";
import type { StreamItem } from "@/types/stream";

const markdownParser = createMarkdownParser({ linkify: false });
const defaultValidateLink = markdownParser.validateLink.bind(markdownParser);
markdownParser.validateLink = (url: string) =>
  url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

export interface StandaloneMarkdownImage {
  key: string;
  source: string;
  alt: string;
}

export function getStandaloneMarkdownImages(markdown: string): StandaloneMarkdownImage[] | null {
  if (!markdown.trimStart().startsWith("![")) return null;
  const tokens = markdownParser.parse(markdown, {});
  const images: StandaloneMarkdownImage[] = [];
  const occurrencesBySource = new Map<string, number>();
  for (const token of tokens) {
    if (token.type === "paragraph_open" || token.type === "paragraph_close") continue;
    if (token.type !== "inline" || token.children === null) return null;
    for (const child of token.children) {
      if (child.type === "softbreak" || child.type === "hardbreak") continue;
      if (child.type === "text" && child.content.trim() === "") continue;
      if (child.type !== "image") return null;
      const source = child.attrGet("src");
      if (source === null) throw new Error("Markdown image token is missing its source");
      const occurrence = occurrencesBySource.get(source) ?? 0;
      occurrencesBySource.set(source, occurrence + 1);
      images.push({ key: `${source}:${occurrence}`, source, alt: child.content });
    }
  }
  return images.length > 0 ? images : null;
}

type AssistantItem = Extract<StreamItem, { kind: "assistant_message" }>;
const groupedImageCache = new WeakMap<StreamItem[], StreamItem[]>();

function isImageMessage(item: StreamItem | undefined): item is AssistantItem {
  return item?.kind === "assistant_message" && getStandaloneMarkdownImages(item.text) !== null;
}

function mergeImageMessages(first: AssistantItem, next: AssistantItem): AssistantItem {
  return { ...next, id: first.id, text: `${first.text}\n\n${next.text}` };
}

/** 展示层合并同回合紧邻的图像，原时间线与复制源不变。 */
export function groupConsecutiveImageMessages(items: StreamItem[]): StreamItem[] {
  const cached = groupedImageCache.get(items);
  if (cached) return cached;
  const grouped: StreamItem[] = [];
  let changed = false;
  for (const item of items) {
    const previous = grouped.at(-1);
    if (isImageMessage(previous) && isImageMessage(item) && previous.turnId === item.turnId) {
      grouped[grouped.length - 1] = mergeImageMessages(previous, item);
      changed = true;
    } else grouped.push(item);
  }
  const result = changed ? grouped : items;
  groupedImageCache.set(items, result);
  return result;
}

export function groupProviderImageSegments(tail: StreamItem[], head: StreamItem[]) {
  const history = groupConsecutiveImageMessages(tail);
  const live = groupConsecutiveImageMessages(head);
  const previous = history.at(-1),
    next = live[0];
  if (isImageMessage(previous) && isImageMessage(next) && previous.turnId === next.turnId) {
    return {
      tail: [...history.slice(0, -1), mergeImageMessages(previous, next)],
      head: live.slice(1),
    };
  }
  return { tail: history, head: live };
}
