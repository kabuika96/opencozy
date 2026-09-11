import { describe, expect, it } from "vitest";
import { renderHarnessHtml } from "./HarnessHtml";

describe("HarnessHtml", () => {
  it("displays embedded PNG images without allowing remote images or executable formats", () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
    const markup = renderHarnessHtml(`<p>Scan</p><img src="${png}" alt="Pairing QR" width="325" height="325" onerror="bad()">`);
    expect(markup).toContain(`<img src="${png}"`);
    expect(markup).toContain('alt="Pairing QR"');
    expect(markup).not.toContain("onerror");
    for (const src of ["https://example.com/tracker.png", "data:image/svg+xml;base64,PHN2Zz4=", "javascript:alert(1)", "data:image/png;base64,invalid", "data:image/png;base64,iVBORw0KGgo" + "A".repeat(600_000)]) {
      expect(renderHarnessHtml(`<p>Scan</p><img src="${src}">`)).not.toContain("<img");
    }
    expect(renderHarnessHtml(`<img src="${png}">`)).toContain("<img");
  });

  it("renders safe mobile html fragments for assistant replies", () => {
    const markup = renderHarnessHtml('<p><strong>Done</strong></p><ul><li><code>npm run check</code></li></ul>');

    expect(markup).toContain("<p>");
    expect(markup).toContain("<strong>Done</strong>");
    expect(markup).toContain("<ul>");
    expect(markup).toContain("<code>npm run check</code>");
  });

  it("keeps safe text styling but strips executable and palette-breaking html", () => {
    const markup = renderHarnessHtml('<script>alert(1)</script><span onclick="bad()" style="color: #ffd166; background-color: #111; font-weight: 700; position: fixed">Safe</span>');

    expect(markup).not.toContain("script");
    expect(markup).not.toContain("onclick");
    expect(markup).not.toContain("position");
    expect(markup).not.toContain("color:");
    expect(markup).not.toContain("background-color");
    expect(markup).toContain('style="font-weight: 700"');
    expect(markup).toContain(">Safe</span>");
  });

  it("falls back to Pretext rendering for plain text replies", () => {
    const markup = renderHarnessHtml("Use `npm run check`");

    expect(markup).toContain("<code>npm run check</code>");
  });

  it("keeps safe SVG path geometry and removes non-semantic classes", () => {
    const markup = renderHarnessHtml('<svg class="lh-html-info injected" viewBox="0 0 12 12"><path d="M 1,1 L 11,11"/><polyline points="1,1 6,8 11,1"/></svg>');

    expect(markup).toContain('class="lh-html-info"');
    expect(markup).not.toContain("injected");
    expect(markup).toContain('d="M 1,1 L 11,11"');
    expect(markup).toContain('points="1,1 6,8 11,1"');
  });

  it("treats code comparisons as Pretext rather than an HTML fragment", () => {
    const markup = renderHarnessHtml("if (left <right) return false;");

    expect(markup).toContain("if (left &lt;right) return false;");
    expect(markup).not.toContain("<right>");
  });

  it("renders leading streamed HTML fragments before their closing tag arrives", () => {
    expect(renderHarnessHtml("<p>Hello")).toContain("<p>Hello</p>");
    expect(renderHarnessHtml('<small class="lh-html-muted">Working')).toContain('class="lh-html-muted"');
  });
});
