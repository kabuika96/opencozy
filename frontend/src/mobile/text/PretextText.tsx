import { useMemo } from "react";

type PretextTextProps = {
  className?: string;
  text: string;
};

export function PretextText({ className, text }: PretextTextProps) {
  const markup = useMemo(() => renderPretextMarkup(text), [text]);
  return (
    <div
      className={className ? `${className} lh-mobile-pretext` : "lh-mobile-pretext"}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

export function PretextCodeBlock({ className, text }: PretextTextProps) {
  return <PretextText className={className} text={toPretextCodeBlock(text)} />;
}

export function toPretextInlineCode(text: string): string {
  return `\`${text.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``;
}

export function renderPretextMarkup(text: string): string {
  return renderBlocks(text.replace(/\r\n?/g, "\n"));
}

function toPretextCodeBlock(text: string): string {
  const lines = text.split(/\r?\n/);
  return lines.map((line) => `    ${line}`).join("\n");
}

function renderBlocks(source: string): string {
  const lines = source.split("\n");
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (isFence(line)) {
      const result = readFencedCode(lines, index);
      blocks.push(`<pre>${escapeHtml(result.text)}</pre>`);
      index = result.nextIndex;
      continue;
    }

    if (isIndentedCode(line)) {
      const result = readIndentedCode(lines, index);
      blocks.push(`<pre>${escapeHtml(result.text)}</pre>`);
      index = result.nextIndex;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const headingText = heading[2] ?? "";
      blocks.push(`<h${level}>${renderInline(headingText)}</h${level}>`);
      index += 1;
      continue;
    }

    if (isUnorderedListItem(line)) {
      const result = readList(lines, index, "ul");
      blocks.push(result.markup);
      index = result.nextIndex;
      continue;
    }

    if (isOrderedListItem(line)) {
      const result = readList(lines, index, "ol");
      blocks.push(result.markup);
      index = result.nextIndex;
      continue;
    }

    if (isQuote(line)) {
      const result = readQuote(lines, index);
      blocks.push(`<blockquote>${renderParagraphInner(result.text)}</blockquote>`);
      index = result.nextIndex;
      continue;
    }

    const result = readParagraph(lines, index);
    blocks.push(`<p>${renderParagraphInner(result.text)}</p>`);
    index = result.nextIndex;
  }

  return blocks.join("\n");
}

function readFencedCode(lines: string[], startIndex: number): { nextIndex: number; text: string } {
  const body: string[] = [];
  let index = startIndex + 1;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (isFence(line)) {
      return { nextIndex: index + 1, text: body.join("\n") };
    }
    body.push(line);
    index += 1;
  }

  return { nextIndex: index, text: body.join("\n") };
}

function readIndentedCode(lines: string[], startIndex: number): { nextIndex: number; text: string } {
  const body: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() !== "" && !isIndentedCode(line)) {
      break;
    }
    body.push(line.replace(/^( {4}|\t)/, ""));
    index += 1;
  }

  return { nextIndex: index, text: body.join("\n").replace(/\n+$/, "") };
}

function readList(lines: string[], startIndex: number, type: "ol" | "ul"): { markup: string; nextIndex: number } {
  const items: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (type === "ul" && !isUnorderedListItem(line)) break;
    if (type === "ol" && !isOrderedListItem(line)) break;
    items.push(`<li>${renderInline(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""))}</li>`);
    index += 1;
  }

  return { markup: `<${type}>${items.join("")}</${type}>`, nextIndex: index };
}

function readQuote(lines: string[], startIndex: number): { nextIndex: number; text: string } {
  const body: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!isQuote(line)) break;
    body.push(line.replace(/^>\s?/, ""));
    index += 1;
  }

  return { nextIndex: index, text: body.join("\n") };
}

function readParagraph(lines: string[], startIndex: number): { nextIndex: number; text: string } {
  const body: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") break;
    if (body.length > 0 && isBlockStarter(line)) break;
    body.push(line);
    index += 1;
  }

  return { nextIndex: index, text: body.join("\n") };
}

function renderParagraphInner(text: string): string {
  return text.split("\n").map(renderInline).join("<br>");
}

function renderInline(text: string): string {
  let result = "";
  let start = 0;
  let cursor = 0;

  while (cursor < text.length) {
    if (text[cursor] !== "`" || isEscaped(text, cursor)) {
      cursor += 1;
      continue;
    }

    const close = findClosingBacktick(text, cursor + 1);
    if (close === -1) {
      cursor += 1;
      continue;
    }

    result += renderPlainInline(text.slice(start, cursor));
    result += `<code>${escapeHtml(unescapeInlineCode(text.slice(cursor + 1, close)))}</code>`;
    cursor = close + 1;
    start = cursor;
  }

  return result + renderPlainInline(text.slice(start));
}

function renderPlainInline(text: string): string {
  const linkPattern = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;
  let result = "";
  let cursor = 0;

  for (const match of text.matchAll(linkPattern)) {
    const index = match.index ?? 0;
    result += escapeHtml(text.slice(cursor, index));

    const label = match[1] ?? "";
    const href = normalizeHref(match[2] ?? "");
    if (href) {
      result += `<a href="${escapeAttribute(href)}" rel="noreferrer" target="_blank">${escapeHtml(label)}</a>`;
    } else {
      result += escapeHtml(match[0] ?? "");
    }
    cursor = index + (match[0]?.length ?? 0);
  }

  return result + escapeHtml(text.slice(cursor));
}

function normalizeHref(rawHref: string): string | null {
  const href = rawHref.trim().replace(/^<(.+)>$/, "$1");
  if (!isAllowedHref(href)) {
    return null;
  }
  return href;
}

function isAllowedHref(href: string): boolean {
  try {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      return false;
    }
    const base = typeof window === "undefined" ? "http://liteharness.invalid" : window.location.href;
    const url = new URL(href, base);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

function findClosingBacktick(text: string, startIndex: number): number {
  for (let index = startIndex; index < text.length; index += 1) {
    if (text[index] === "`" && !isEscaped(text, index)) {
      return index;
    }
  }
  return -1;
}

function unescapeInlineCode(text: string): string {
  return text.replace(/\\([\\`])/g, "$1");
}

function isBlockStarter(line: string): boolean {
  return isFence(line)
    || isIndentedCode(line)
    || isUnorderedListItem(line)
    || isOrderedListItem(line)
    || isQuote(line)
    || /^#{1,6}\s+/.test(line);
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function isFence(line: string): boolean {
  return /^```/.test(line.trim());
}

function isIndentedCode(line: string): boolean {
  return /^( {4}|\t)/.test(line);
}

function isOrderedListItem(line: string): boolean {
  return /^\s*\d+[.)]\s+\S/.test(line);
}

function isQuote(line: string): boolean {
  return /^>\s?/.test(line);
}

function isUnorderedListItem(line: string): boolean {
  return /^\s*[-*+]\s+\S/.test(line);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/`/g, "&#96;");
}
