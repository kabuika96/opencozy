import { useMemo } from "react";

type EventHtmlProps = {
  className?: string;
  html: string;
  textFallback: string;
};

const allowedTags = new Set(["br", "circle", "code", "em", "line", "path", "polyline", "pre", "rect", "span", "strong", "svg"]);
const droppedTags = new Set(["iframe", "object", "script", "style", "template"]);
const allowedClasses = new Set([
  "lh-event-accent",
  "lh-event-chip",
  "lh-event-code",
  "lh-event-dim",
  "lh-event-error",
  "lh-event-graphic",
  "lh-event-info",
  "lh-event-muted",
  "lh-event-ok",
  "lh-event-warn",
]);
const globalAttributes = new Set(["aria-hidden", "aria-label", "class", "role"]);
const svgAttributes = new Set([
  "cx",
  "cy",
  "d",
  "fill",
  "height",
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

export function EventHtml({ className, html, textFallback }: EventHtmlProps) {
  const markup = useMemo(() => sanitizeEventHtml(html, textFallback), [html, textFallback]);
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

export function sanitizeEventHtml(html: string, textFallback = ""): string {
  if (!html.trim()) {
    return escapeHtml(textFallback);
  }
  if (typeof DOMParser === "undefined" || typeof Node === "undefined") {
    return escapeHtml(textFallback || html);
  }

  const document = new DOMParser().parseFromString(`<span>${html}</span>`, "text/html");
  const root = document.body.firstElementChild;
  if (!root) {
    return escapeHtml(textFallback);
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

    sanitizeAttributes(element, tagName);
    sanitizeChildren(element);
  }
}

function sanitizeAttributes(element: Element, tagName: string): void {
  for (const attribute of Array.from(element.attributes)) {
    if (!isAllowedAttribute(attribute.name, attribute.value, tagName)) {
      element.removeAttribute(attribute.name);
      continue;
    }
    if (attribute.name === "class") {
      const classes = attribute.value.split(/\s+/).filter((className) => allowedClasses.has(className));
      if (classes.length > 0) {
        element.setAttribute("class", classes.join(" "));
      } else {
        element.removeAttribute("class");
      }
    }
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
  if (globalAttributes.has(name)) return name !== "role" || value === "img";
  if (!isSvgTag(tagName) || !svgAttributes.has(name)) return false;
  if (name === "fill" || name === "stroke") {
    return value === "none" || value === "currentColor" || /^#[0-9a-f]{3,8}$/i.test(value);
  }
  if (name === "viewBox") return /^[-\d.\s]+$/.test(value);
  return /^[-\d.]+$/.test(value);
}

function isSvgTag(tagName: string): boolean {
  return tagName === "svg" || tagName === "path" || tagName === "circle" || tagName === "rect" || tagName === "line" || tagName === "polyline";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
