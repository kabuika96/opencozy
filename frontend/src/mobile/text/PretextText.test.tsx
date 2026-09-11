import { describe, expect, it } from "vitest";
import { renderPretextMarkup, toPretextInlineCode } from "./PretextText";

describe("PretextText", () => {
  it("renders inline code", () => {
    expect(renderPretextMarkup("Use `npm run check`")).toContain("<code>npm run check</code>");
  });

  it("escapes raw html in harness text", () => {
    const markup = renderPretextMarkup("<script>alert(1)</script><p>safe");
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("<p>safe");
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(markup).toContain("&lt;p&gt;safe");
  });

  it("supports inline code escaping", () => {
    expect(renderPretextMarkup(toPretextInlineCode("path/with`tick"))).toContain("<code>path/with`tick</code>");
  });

  it("renders harness-style blocks without raw tag passthrough", () => {
    const markup = renderPretextMarkup([
      "Run these checks:",
      "- `npm run check`",
      "- [docs](https://example.com/docs)",
      "",
      "```tsx",
      "<div style={{ height: '100dvh' }}>dark</div>",
      "```",
      "",
      "[local](</workspaces/control-plane/frontend/src/main.tsx:1>)",
    ].join("\n"));

    expect(markup).toContain("<ul>");
    expect(markup).toContain("<code>npm run check</code>");
    expect(markup).toContain("href=\"https://example.com/docs\"");
    expect(markup).toContain("&lt;div style=");
    expect(markup).not.toContain("<div style=");
    expect(markup).toContain("&lt;/workspaces/control-plane/frontend/src/main.tsx:1&gt;");
  });
});
