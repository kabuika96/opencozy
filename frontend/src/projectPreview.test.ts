import { describe, expect, it } from "vitest";
import {
  canOpenWiredPreviewFrame,
  isBrowserLocalPreviewUrl,
  orderPreviewsWithAttachedFirst,
  previewNeedsPublishedTarget,
  readWiredPreviewOpenUrl
} from "./projectPreview";
import type { WiredPreview } from "./types";

function wiredPreview(overrides: Partial<WiredPreview> = {}): WiredPreview {
  return {
    id: "preview-1",
    name: "Mobile App",
    wiringSessionId: null,
    projectDirectory: "/Users/me/projects/mobile-app",
    target: { name: "App", url: "http://127.0.0.1:5173/" },
    dependencyServices: [],
    commands: [],
    requestedPublishedOrigins: [],
    publishedOrigins: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides
  };
}

describe("Project Preview helpers", () => {
  it("opens the published target origin before falling back to the stored target URL", () => {
    expect(readWiredPreviewOpenUrl(wiredPreview())).toBe("http://127.0.0.1:5173/");
    expect(readWiredPreviewOpenUrl(wiredPreview({
      publishedOrigins: [
        {
          id: "origin-1",
          source: "target",
          dependencyServiceName: null,
          dependencyServiceIndex: null,
          name: "App HTTPS",
          provider: "tailscale-serve",
          sourceUrl: "http://127.0.0.1:5173/",
          publishedUrl: "https://mobile-app.tailnet.test:8443/",
          httpsPort: 8443,
          status: "published",
          error: null,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString()
        }
      ]
    }))).toBe("https://mobile-app.tailnet.test:8443/");
  });

  it("does not auto-open browser-local targets before they have a published origin", () => {
    const localPreview = wiredPreview();
    const lanPreview = wiredPreview({ target: { name: "App", url: "http://192.168.1.20:5173/" } });
    const publishedPreview = wiredPreview({
      publishedOrigins: [
        {
          id: "origin-1",
          source: "target",
          dependencyServiceName: null,
          dependencyServiceIndex: null,
          name: "App HTTPS",
          provider: "tailscale-serve",
          sourceUrl: "http://127.0.0.1:5173/",
          publishedUrl: "https://mobile-app.tailnet.test:8443/",
          httpsPort: 8443,
          status: "published",
          error: null,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString()
        }
      ]
    });

    expect(isBrowserLocalPreviewUrl("http://localhost:5173/")).toBe(true);
    expect(isBrowserLocalPreviewUrl("http://127.0.0.1:5173/")).toBe(true);
    expect(isBrowserLocalPreviewUrl("http://0.0.0.0:5173/")).toBe(true);
    expect(isBrowserLocalPreviewUrl("http://192.168.1.20:5173/")).toBe(false);
    expect(previewNeedsPublishedTarget(localPreview)).toBe(true);
    expect(canOpenWiredPreviewFrame(localPreview)).toBe(false);
    expect(previewNeedsPublishedTarget(lanPreview)).toBe(false);
    expect(canOpenWiredPreviewFrame(lanPreview)).toBe(true);
    expect(previewNeedsPublishedTarget(publishedPreview)).toBe(false);
    expect(canOpenWiredPreviewFrame(publishedPreview)).toBe(true);
  });

  it("keeps the attached Wired Preview before search results", () => {
    const attached = wiredPreview({ id: "attached", name: "Attached App" });
    const other = wiredPreview({ id: "other", name: "Other App" });

    expect(orderPreviewsWithAttachedFirst([other, attached], attached).map((preview) => preview.id)).toEqual([
      "attached",
      "other"
    ]);
  });
});
