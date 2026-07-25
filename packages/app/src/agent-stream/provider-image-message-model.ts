import MarkdownIt from "markdown-it";

const markdownParser = new MarkdownIt({ html: false, linkify: false, typographer: false });
const defaultValidateLink = markdownParser.validateLink.bind(markdownParser);
markdownParser.validateLink = (url: string) =>
  url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

export function isStandaloneMarkdownImage(markdown: string): boolean {
  const tokens = markdownParser.parse(markdown, {});
  if (
    tokens.length !== 3 ||
    tokens[0]?.type !== "paragraph_open" ||
    tokens[1]?.type !== "inline" ||
    tokens[2]?.type !== "paragraph_close"
  ) {
    return false;
  }

  const children = tokens[1].children;
  return children?.length === 1 && children[0]?.type === "image";
}
