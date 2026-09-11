import { describe, expect, it } from "vitest";
import { sanitizeEventHtml } from "./EventHtml";

describe("EventHtml", () => {
  it("keeps the allowed event html subset", () => {
    const markup = sanitizeEventHtml('<span class="lh-event-ok unknown">Done</span> <code>npm test</code>');

    expect(markup).toContain('class="lh-event-ok"');
    expect(markup).toContain("<code>npm test</code>");
    expect(markup).not.toContain("unknown");
  });

  it("strips unsafe html and attributes", () => {
    const markup = sanitizeEventHtml('<script>alert(1)</script><span onclick="alert(2)" style="color:red">Safe</span>');

    expect(markup).not.toContain("script");
    expect(markup).not.toContain("onclick");
    expect(markup).not.toContain("style=");
    expect(markup).toContain("<span>Safe</span>");
  });

  it("allows small inline svg graphics", () => {
    const markup = sanitizeEventHtml('<svg class="lh-event-graphic" viewBox="0 0 12 12" onclick="bad()"><circle cx="6" cy="6" r="4" stroke="currentColor"></circle></svg>');

    expect(markup).toContain("<svg");
    expect(markup).toContain('class="lh-event-graphic"');
    expect(markup).toMatch(/viewbox/i);
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).not.toContain("onclick");
  });
});
