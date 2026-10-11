import { createMarkdownParser } from "@/utils/markdown-parser";

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
