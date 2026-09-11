import { useMemo } from "react";
import { renderPretextMarkup } from "./PretextText";

type HarnessHtmlProps = {
  className?: string;
  html: string;
};

const allowedClasses = new Set([
  "lh-html-muted",
  "lh-html-ok",
  "lh-html-info",
  "lh-html-warn",
  "lh-html-error",
  "lh-html-accent",
  "lh-html-chip",
]);
const allowedTags = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "circle",
  "code",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "li",
  "line",
  "mark",
  "ol",
  "p",
  "path",
  "polyline",
  "pre",
  "rect",
  "section",
  "small",
  "span",
  "strong",
  "summary",
  "svg",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);
const droppedTags = new Set(["iframe", "object", "script", "style", "template"]);
const globalAttributes = new Set(["aria-hidden", "aria-label", "class", "role", "style"]);
const allowedRoles = new Set(["img", "note", "status"]);
const svgAttributes = new Set([
  "cx",
  "cy",
  "d",
  "fill",
  "height",
  "points",
  "r",
  "stroke",
  "stroke-width",
  "viewBox",
  "viewbox",
  "width",
  "x",
  "x1",
  "x2",
  "y",
  "y1",
  "y2",
]);
const tableAttributes = new Set(["colspan", "rowspan"]);
const allowedStyleProperties = new Set([
  "font-style",
  "font-weight",
  "opacity",
  "text-decoration",
]);

export function HarnessHtml({ className, html }: HarnessHtmlProps) {
  const markup = useMemo(() => renderHarnessHtml(html), [html]);
  return (
    <div
      className={className ? `${className} lh-mobile-harness-html` : "lh-mobile-harness-html"}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

export function renderHarnessHtml(html: string): string {
  if (!containsHarnessHtml(html)) {
    return renderPretextMarkup(html);
  }
  if (typeof DOMParser === "undefined" || typeof Node === "undefined") {
    return renderPretextMarkup(html);
  }

  const document = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = document.body.firstElementChild;
  if (!root) {
    return renderPretextMarkup(html);
  }
  sanitizeChildren(root);
  return root.innerHTML;
}

function sanitizeChildren(parent: Element): void {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }

    const element = child as Element;
    const tagName = element.tagName.toLowerCase();
    if (droppedTags.has(tagName)) {
      element.remove();
      continue;
    }
    if (!allowedTags.has(tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      sanitizeChildren(parent);
      continue;
    }

    // Embedded PNGs render without network access or active SVG content.
    if (tagName === "img" && !isEmbeddedPng(element.getAttribute("src") ?? "")) {
      element.remove();
      continue;
    }
    sanitizeAttributes(element, tagName);
    sanitizeChildren(element);
  }
}

function sanitizeAttributes(element: Element, tagName: string): void {
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name === "style") {
      const style = sanitizeStyle(attribute.value);
      if (style) {
        element.setAttribute("style", style);
      } else {
        element.removeAttribute("style");
      }
      continue;
    }

    if (attribute.name === "class") {
      const classes = attribute.value.split(/\s+/).filter((className) => allowedClasses.has(className));
      if (classes.length > 0) {
        element.setAttribute("class", classes.join(" "));
      } else {
        element.removeAttribute("class");
      }
      continue;
    }

    if (!isAllowedAttribute(attribute.name, attribute.value, tagName)) {
      element.removeAttribute(attribute.name);
    }
  }

  if (tagName === "a") {
    element.setAttribute("rel", "noreferrer");
    element.setAttribute("target", "_blank");
  }

  if (tagName === "svg") {
    element.setAttribute("focusable", "false");
    if (!element.hasAttribute("aria-label")) {
      element.setAttribute("aria-hidden", "true");
    }
  }
}

function isAllowedAttribute(name: string, value: string, tagName: string): boolean {
  if (name.startsWith("on")) return false;
  if (globalAttributes.has(name)) return name !== "role" || allowedRoles.has(value);
  if (tagName === "img") {
    if (name === "src") return isEmbeddedPng(value);
    if (name === "alt") return true;
    if (name === "width" || name === "height") return /^[1-9]\d{0,3}$/.test(value) && Number(value) <= 2048;
  }
  if (tagName === "a" && name === "href") return isAllowedHref(value);
  if ((tagName === "td" || tagName === "th") && tableAttributes.has(name)) return /^[1-9]\d?$/.test(value);
  if (!isSvgTag(tagName) || !svgAttributes.has(name)) return false;
  if (name === "fill" || name === "stroke") {
    return value === "none" || value === "currentColor" || /^#[0-9a-f]{3,8}$/i.test(value);
  }
  if (name === "viewBox") return /^[-\d.\s]+$/.test(value);
  if (name === "d") return /^[\s\d,.+\-a-z]+$/i.test(value);
  if (name === "points") return /^[\s\d,.+\-]+$/.test(value);
  return /^[-\d.]+$/.test(value);
}

function isEmbeddedPng(value: string): boolean {
  return value.length <= 512_000 && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function containsHarnessHtml(html: string): boolean {
  const tagNames = Array.from(new Set([...allowedTags, ...droppedTags])).join("|");
  const pairedTag = new RegExp(`<\\/(?:${tagNames})\\s*>`, "i");
  const standaloneTag = new RegExp(`<(?:br|hr)\\s*\\/?\\s*>|<svg(?:\\s[^<>]*)?>`, "i");
  // Assistant HTML arrives incrementally. A fragment beginning with an
  // approved opening tag is presentation markup; tag-shaped text later in a
  // code sample remains Pretext until it has an approved closing tag.
  const leadingFragment = new RegExp(`^\\s*<(?:${tagNames})(?:\\s[^<>]*)?>`, "i");
  return pairedTag.test(html) || standaloneTag.test(html) || leadingFragment.test(html);
}

function sanitizeStyle(style: string): string {
  const declarations = style.split(";").flatMap((declaration) => {
    const [rawProperty, ...rawValue] = declaration.split(":");
    const property = rawProperty?.trim().toLowerCase();
    const value = rawValue.join(":").trim();
    if (!property || !value || !allowedStyleProperties.has(property)) return [];
    if (/url|expression|javascript|position|fixed|absolute/i.test(value)) return [];
    if (!/^[-#(),.%\w\s]+$/.test(value)) return [];
    return [`${property}: ${value}`];
  });
  return declarations.join("; ");
}

function isAllowedHref(rawHref: string): boolean {
  try {
    const href = rawHref.trim();
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

function isSvgTag(tagName: string): boolean {
  return tagName === "svg" || tagName === "path" || tagName === "circle" || tagName === "rect" || tagName === "line" || tagName === "polyline";
}
