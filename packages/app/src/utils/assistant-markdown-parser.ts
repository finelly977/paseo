import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import { createMarkdownParser } from "@/utils/markdown-parser";
import { parseInlinePathToken } from "@/assistant-file-links/parse";

export function createAssistantMarkdownParser(): MarkdownIt {
  const parser = createMarkdownParser({ linkify: true });
  const defaultValidateLink = parser.validateLink.bind(parser);

  // 只有智能体消息允许链接到本机文件，其他界面沿用 markdown-it 更严格的默认规则。
  parser.validateLink = (url: string) =>
    url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

  parser.inline.ruler.before("link", "codex_file_citation", codexFileCitation);

  // 模型常在结束标记前留下空格，或把中文标点紧接正文。只修正内联闭合标记，
  // 仍交给原有强调配对规则处理，代码、转义字符和复制原文不会被改写。
  parser.inline.ruler.before("emphasis", "assistant_strong_close", assistantStrongClose);

  return parser;
}

function codexFileCitation(state: StateInline, silent: boolean): boolean {
  if (state.src.charAt(state.pos) !== ":") return false;
  const directive =
    /^:codex-file-citation\{((?:\s*[A-Za-z_]\w*\s*=\s*(?:"[^"\r\n]*"|'[^'\r\n]*'))+)\s*\}/.exec(
      state.src.slice(state.pos),
    );
  if (!directive) return false;
  for (let index = state.tokens.length - 1; index >= 0; index -= 1) {
    if (state.tokens[index].type === "link_close") break;
    if (state.tokens[index].type === "link_open") return false;
  }
  const attributes = Array.from(directive[1].matchAll(/([A-Za-z_]\w*)\s*=\s*(["'])(.*?)\2/g));
  const paths = attributes.filter((attribute) => attribute[1] === "path");
  if (paths.length !== 1) return false;
  // 路径中的反斜杠是 Windows 分隔符，不按 JSON 转义解码。
  const path = paths[0][3];
  const hasScheme = /^[A-Za-z][\w+.-]*:/.test(path);
  const isWindowsPath = /^[A-Za-z]:[\\/]/.test(path);
  const isInlinePath = parseInlinePathToken(path) !== null;
  if (!path.trim() || !state.md.validateLink(path)) return false;
  if (hasScheme && !isWindowsPath && !isInlinePath) return false;
  const label = path.replace(/\\/g, "/").split("/").at(-1);
  if (!label) return false;
  if (!silent) {
    const open = state.push("link_open", "a", 1);
    open.attrs = [["href", path]];
    open.info = "codex-file-citation";
    state.push("text", "", 0).content = label;
    state.push("link_close", "a", -1);
  }
  state.pos += directive[0].length;
  return true;
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
