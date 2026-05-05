import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WiredPreviewStore } from "./wiredPreviewStore.js";

function createStore(): WiredPreviewStore {
  const dir = mkdtempSync(path.join(tmpdir(), "opencozy-wired-preview-"));
  return new WiredPreviewStore(path.join(dir, "opencozy.sqlite"));
}

describe("WiredPreviewStore", () => {
  it("persists and searches Wired Previews", () => {
    const store = createStore();

    try {
      const preview = store.create({
        name: "Mobile App",
        projectDirectory: "/Users/me/projects/mobile-app",
        target: { name: "App", url: "http://127.0.0.1:5173/" },
        dependencyServices: [
          { name: "API", url: "http://127.0.0.1:3000/", browserDirect: true }
        ],
        commands: [
          { label: "Start app", cwd: "/Users/me/projects/mobile-app", command: "npm run dev" }
        ],
        requestedPublishedOrigins: [
          { name: "App HTTPS", url: "https://mobile-app.tailnet.example.ts.net/" }
        ]
      });

      expect(preview).toMatchObject({
        id: expect.any(String),
        name: "Mobile App",
        wiringSessionId: null,
        projectDirectory: "/Users/me/projects/mobile-app",
        target: { name: "App", url: "http://127.0.0.1:5173/" },
        dependencyServices: [
          { name: "API", url: "http://127.0.0.1:3000/", browserDirect: true }
        ],
        commands: [
          { label: "Start app", cwd: "/Users/me/projects/mobile-app", command: "npm run dev" }
        ],
        requestedPublishedOrigins: [
          { name: "App HTTPS", url: "https://mobile-app.tailnet.example.ts.net/" }
        ],
        publishedOrigins: [],
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      });
      expect(store.get(preview.id)?.name).toBe("Mobile App");
      expect(store.list("mobile")).toHaveLength(1);
      expect(store.list("missing")).toHaveLength(0);

      const withWiringSession = store.setWiringSessionId(preview.id, "session-1");
      expect(withWiringSession?.wiringSessionId).toBe("session-1");

      const published = store.savePublishedOrigin(preview.id, {
        id: "origin-1",
        source: "target",
        dependencyServiceName: null,
        dependencyServiceIndex: null,
        name: "App",
        provider: "tailscale-serve",
        sourceUrl: "http://127.0.0.1:5173/",
        publishedUrl: "https://mobile-app.tailnet.example.ts.net:8443/",
        httpsPort: 8443,
        status: "published",
        error: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      });
      expect(published?.publishedOrigins).toEqual([
        expect.objectContaining({
          id: "origin-1",
          status: "published",
          httpsPort: 8443
        })
      ]);

      const unpublished = store.updatePublishedOrigin(preview.id, "origin-1", { status: "unpublished", error: null });
      expect(unpublished?.publishedOrigins[0]).toMatchObject({
        id: "origin-1",
        status: "unpublished"
      });
    } finally {
      store.close();
    }
  });

  it("updates and deletes Wired Previews", () => {
    const store = createStore();

    try {
      const preview = store.create({
        name: "Mobile App",
        projectDirectory: "/Users/me/projects/mobile-app",
        target: { name: "App", url: "http://127.0.0.1:5173/" },
        dependencyServices: [],
        commands: [],
        requestedPublishedOrigins: []
      });

      const updated = store.update(preview.id, {
        name: "Renamed App",
        projectDirectory: preview.projectDirectory,
        target: preview.target,
        dependencyServices: preview.dependencyServices,
        commands: preview.commands,
        requestedPublishedOrigins: preview.requestedPublishedOrigins
      });

      expect(updated?.name).toBe("Renamed App");
      expect(store.delete(preview.id)).toBe(true);
      expect(store.get(preview.id)).toBeNull();
      expect(store.delete(preview.id)).toBe(false);
    } finally {
      store.close();
    }
  });
});
