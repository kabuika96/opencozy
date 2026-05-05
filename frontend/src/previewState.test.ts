import { describe, expect, it } from "vitest";
import { deriveWiredPreviewState } from "./previewState";
import type { PreviewManifest, WiredPreview } from "./types";

const basePreview: WiredPreview = {
  id: "preview-1",
  name: "Fixture App",
  wiringSessionId: "session-1",
  projectDirectory: "/tmp/app",
  target: { name: "App", url: "http://127.0.0.1:5173/" },
  dependencyServices: [],
  commands: [],
  requestedPublishedOrigins: [],
  publishedOrigins: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString()
};

const baseManifest: PreviewManifest = {
  id: "manifest-1",
  status: "pending",
  wiredPreviewId: "preview-1",
  wiringSessionId: "session-1",
  approvedWiredPreviewId: null,
  proposedName: "Fixture App",
  projectDirectory: "/tmp/app",
  target: { name: "App", url: "http://127.0.0.1:5173/" },
  dependencyServices: [],
  commands: [],
  requestedPublishedOrigins: [],
  materialHash: "hash",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  approvedAt: null
};

describe("Wired Preview state", () => {
  it("marks previews with pending manifests for review first", () => {
    expect(deriveWiredPreviewState({ preview: basePreview, pendingManifest: baseManifest })).toMatchObject({
      kind: "manifest-pending-approval",
      label: "Manifest pending approval",
      recoveryAction: "review-manifest"
    });
  });

  it("marks unreachable previews for wiring-session recovery", () => {
    expect(deriveWiredPreviewState({ preview: basePreview, reachability: "unreachable" })).toMatchObject({
      kind: "unreachable",
      actionLabel: "Open Wiring",
      recoveryAction: "open-wiring-session"
    });
  });

  it("marks previews with requested private origins as needing publish", () => {
    expect(deriveWiredPreviewState({
      preview: {
        ...basePreview,
        requestedPublishedOrigins: [{ name: "API", url: "http://127.0.0.1:8788/" }]
      }
    })).toMatchObject({
      kind: "needs-publish",
      nextAction: "Publish the missing private origins from OpenCozy.",
      recoveryAction: "publish"
    });
  });

  it("marks browser-local targets as needing publish for enrolled device preview", () => {
    expect(deriveWiredPreviewState({ preview: basePreview })).toMatchObject({
      kind: "needs-publish",
      recoveryAction: "publish"
    });
  });

  it("marks browser-direct dependencies as needing publish until each has an origin", () => {
    expect(deriveWiredPreviewState({
      preview: {
        ...basePreview,
        dependencyServices: [
          { name: "API", url: "http://127.0.0.1:3000/", browserDirect: true },
          { name: "Database", url: "http://127.0.0.1:5432/", browserDirect: false }
        ]
      }
    })).toMatchObject({
      kind: "needs-publish",
      recoveryAction: "publish"
    });
  });

  it("treats a requested target origin as ready after it is published", () => {
    expect(deriveWiredPreviewState({
      preview: {
        ...basePreview,
        requestedPublishedOrigins: [{ name: "App", url: "http://127.0.0.1:5173/" }],
        publishedOrigins: [{
          id: "origin-1",
          source: "target",
          dependencyServiceName: null,
          dependencyServiceIndex: null,
          name: "App",
          provider: "tailscale-serve",
          sourceUrl: "http://127.0.0.1:5173/",
          publishedUrl: "https://jarvis.tailnet.test:8443/",
          httpsPort: 8443,
          status: "published",
          error: null,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString()
        }]
      }
    })).toMatchObject({
      kind: "ready",
      recoveryAction: "attach"
    });
  });

  it("keeps reachable previews ready even when they store start commands", () => {
    expect(deriveWiredPreviewState({
      reachability: "reachable",
      preview: {
        ...basePreview,
        commands: [{ label: "Start app", cwd: "/tmp/app", command: "npm run dev" }],
        requestedPublishedOrigins: [{ name: "App", url: "http://127.0.0.1:5173/" }],
        publishedOrigins: [{
          id: "origin-1",
          source: "target",
          dependencyServiceName: null,
          dependencyServiceIndex: null,
          name: "App",
          provider: "tailscale-serve",
          sourceUrl: "http://127.0.0.1:5173/",
          publishedUrl: "https://jarvis.tailnet.test:8443/",
          httpsPort: 8443,
          status: "published",
          error: null,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString()
        }]
      }
    })).toMatchObject({
      kind: "ready",
      recoveryAction: "attach"
    });
  });


  it("marks previews with stored commands as needing start without executing commands", () => {
    expect(deriveWiredPreviewState({
      preview: {
        ...basePreview,
        target: { name: "App", url: "http://192.168.1.20:5173/" },
        commands: [{ label: "Start app", cwd: "/tmp/app", command: "npm run dev" }]
      }
    })).toMatchObject({
      kind: "needs-start",
      nextAction: "Open the wiring session and ask before running the stored commands.",
      recoveryAction: "open-wiring-session"
    });
  });

  it("marks simple target-only previews ready to attach", () => {
    expect(deriveWiredPreviewState({
      preview: {
        ...basePreview,
        target: { name: "App", url: "http://192.168.1.20:5173/" }
      }
    })).toMatchObject({
      kind: "ready",
      recoveryAction: "attach"
    });
  });
});
