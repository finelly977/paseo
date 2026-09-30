import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import { createMarkdownParser } from "@/utils/markdown-parser";

export function createAssistantMarkdownParser(): MarkdownIt {
  const parser = createMarkdownParser({ linkify: true });
  const defaultValidateLink = parser.validateLink.bind(parser);

  // 只有智能体消息允许链接到本机文件，其他界面沿用 markdown-it 更严格的默认规则。
  parser.validateLink = (url: string) =>
    url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

  // 模型常在结束标记前留下空格，或把中文标点紧接正文。只修正内联闭合标记，
  // 仍交给原有强调配对规则处理，代码、转义字符和复制原文不会被改写。
  parser.inline.ruler.before("emphasis", "assistant_strong_close", assistantStrongClose);

  return parser;
}

function assistantStrongClose(state: StateInline, silent: boolean): boolean {
  if (silent || state.src.charAt(state.pos) !== "*") return false;
  const scanned = state.scanDelims(state.pos, true);
  if (scanned.length !== 2 || scanned.can_close) return false;
  const previous = state.src.charAt(state.pos - 1);
  const next = state.src.charAt(state.pos + 2);
  const paddedClose = /\s/.test(previous);
  const punctuationClose = /\p{Punctuation}/u.test(previous) && /\p{Letter}|\p{Number}/u.test(next);
  if (!paddedClose && !punctuationClose) return false;
  let unmatchedMarkers = 0;
  for (const delimiter of state.delimiters) {
    if (delimiter.marker !== 42 || delimiter.length !== 2) continue;
    if (delimiter.close && unmatchedMarkers > 0) unmatchedMarkers -= 1;
    else if (delimiter.open) unmatchedMarkers += 1;
  }
  if (unmatchedMarkers < 2) return false;
  for (let index = 0; index < 2; index += 1) {
    state.push("text", "", 0).content = "*";
    const delimiter = {
      marker: 42,
      length: 2,
      jump: index,
      token: state.tokens.length - 1,
      end: -1,
      open: false,
      close: true,
    };
    state.delimiters.push(delimiter);
  }
  state.pos += 2;
  return true;
}
