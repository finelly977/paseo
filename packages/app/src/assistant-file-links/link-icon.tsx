import { SvgXml } from "react-native-svg";
import { getFileIconSvg } from "@/components/material-file-icons";
import { parseAssistantFileLink, parseInlinePathToken, type InlinePathTarget } from "./parse";
import { getAssistantFileLinkToken, type AssistantFileLinkSource } from "./resolver";

const WEB_GLOBE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#29b6f6" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2m7.93 6h-3.66a15.6 15.6 0 0 0-1.94-4.78A8.03 8.03 0 0 1 19.93 8M12 4.04A13.7 13.7 0 0 1 14.3 8H9.7A13.7 13.7 0 0 1 12 4.04M4.07 14a8.2 8.2 0 0 1 0-4h3.38a16.5 16.5 0 0 0 0 4zm.7 2h3.66a15.6 15.6 0 0 0 1.94 4.78A8.03 8.03 0 0 1 4.77 16m3.66-8H4.77a8.03 8.03 0 0 1 5.6-4.78A15.6 15.6 0 0 0 8.43 8M12 19.96A13.7 13.7 0 0 1 9.7 16h4.6A13.7 13.7 0 0 1 12 19.96M14.74 14H9.26a14.4 14.4 0 0 1 0-4h5.48a14.4 14.4 0 0 1 0 4m.93 6.78A15.6 15.6 0 0 0 17.61 16h3.62a8.03 8.03 0 0 1-5.56 4.78M19.93 14h-3.38a16.5 16.5 0 0 0 0-4h3.38a8.2 8.2 0 0 1 0 4"/></svg>`;

const EXTERNAL_LINK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#42a5f5" d="M10.59 13.41c.41.39.41 1.03 0 1.42-.39.39-1.03.39-1.42 0a5.003 5.003 0 0 1 0-7.07l3.54-3.54a5.003 5.003 0 0 1 7.07 0 5.003 5.003 0 0 1 0 7.07l-1.49 1.49c.01-.82-.12-1.64-.4-2.42l.47-.48a2.98 2.98 0 0 0 0-4.24 2.98 2.98 0 0 0-4.24 0l-3.53 3.53a2.98 2.98 0 0 0 0 4.24m2.82-4.24c.39-.39 1.03-.39 1.42 0a5.003 5.003 0 0 1 0 7.07l-3.54 3.54a5.003 5.003 0 0 1-7.07 0 5.003 5.003 0 0 1 0-7.07l1.49-1.49c-.01.82.12 1.64.4 2.43l-.47.47a2.98 2.98 0 0 0 0 4.24 2.98 2.98 0 0 0 4.24 0l3.53-3.53a2.98 2.98 0 0 0 0-4.24.973.973 0 0 1 0-1.42"/></svg>`;

function extractFileNameFromPath(filePath: string): string {
  const normalized = filePath.trim().replace(/\\/g, "/");
  const withoutHash = normalized.split("#")[0] ?? normalized;
  const slashIndex = withoutHash.lastIndexOf("/");
  return slashIndex >= 0 ? withoutHash.slice(slashIndex + 1) : withoutHash;
}

function extractFileNameFromToken(token: string): string {
  const parsedToken = parseInlinePathToken(token);
  if (parsedToken) {
    return extractFileNameFromPath(parsedToken.path);
  }
  const parsedLink = parseAssistantFileLink(token);
  if (parsedLink) {
    return extractFileNameFromPath(parsedLink.path);
  }
  return extractFileNameFromPath(token);
}

export function resolveAssistantLinkIconSvg(input: {
  source: AssistantFileLinkSource;
  target: InlinePathTarget | null;
}): string {
  if (input.target) {
    return getFileIconSvg(extractFileNameFromPath(input.target.path));
  }

  const token = getAssistantFileLinkToken(input.source).trim();
  const href = input.source.href.trim();
  const effectiveUrl = /^https?:\/\//i.test(href) ? href : token;
  if (/^https?:\/\//i.test(effectiveUrl)) {
    return WEB_GLOBE_ICON_SVG;
  }

  if (
    /^[a-z][a-z0-9+.-]*:/i.test(effectiveUrl) &&
    !/^[a-z]:[\\/]/i.test(effectiveUrl) &&
    !/^file:/i.test(effectiveUrl)
  ) {
    return EXTERNAL_LINK_ICON_SVG;
  }

  const fileName = extractFileNameFromToken(token || href);
  return getFileIconSvg(fileName);
}

export function AssistantLinkIcon({ svg, size = 14 }: { svg: string; size?: number }) {
  return <SvgXml xml={svg} width={size} height={size} />;
}
