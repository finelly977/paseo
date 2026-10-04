import { createMarkdownParser } from "@/utils/markdown-parser";

const markdownParser = createMarkdownParser({ linkify: false });
const defaultValidateLink = markdownParser.validateLink.bind(markdownParser);
markdownParser.validateLink = (url: string) =>
  url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

export interface StandaloneMarkdownImage {
  source: string;
  alt: string;
}

export function getStandaloneMarkdownImage(markdown: string): StandaloneMarkdownImage | null {
  const tokens = markdownParser.parse(markdown, {});
  if (
    tokens.length !== 3 ||
    tokens[0].type !== "paragraph_open" ||
    tokens[1].type !== "inline" ||
    tokens[2].type !== "paragraph_close"
  ) {
    return null;
  }

  const children = tokens[1].children;
  if (!children || children.length !== 1 || children[0].type !== "image") return null;
  const image = children[0];
  const source = image.attrGet("src");
  if (source === null) throw new Error("Markdown image token is missing its source");
  return { source, alt: image.content };
}
