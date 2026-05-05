import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProjectPreviewPicker, type ProjectPreviewPickerProps } from "./ProjectPreviewPicker";
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

function renderPicker(overrides: Partial<ProjectPreviewPickerProps> = {}): string {
  const props: ProjectPreviewPickerProps = {
    activePreview: null,
    busy: false,
    confirmDeletePreviewId: null,
    editingPreviewId: null,
    editingPreviewName: "",
    error: null,
    copiedPreviewLinkId: null,
    healthyPreviewId: null,
    loading: false,
    pendingManifestByPreviewId: new Map(),
    previewManifestNameDrafts: {},
    previewManifests: [],
    previews: [],
    search: "",
    wiringBrief: "",
    onApproveManifest: vi.fn(),
    onAttachPreview: vi.fn(),
    onCancelDeletePreview: vi.fn(),
    onCancelRenamePreview: vi.fn(),
    onConfirmDeletePreview: vi.fn(),
    onCopyPreviewLink: vi.fn(),
    onDeletePreview: vi.fn(),
    onDetachActivePreview: vi.fn(),
    onEditingPreviewNameChange: vi.fn(),
    onManifestNameDraftChange: vi.fn(),
    onOpenWiringSession: vi.fn(),
    onRunPreviewAction: vi.fn(),
    onSaveRenamePreview: vi.fn(),
    onSearchChange: vi.fn(),
    onStartNewWiringSession: vi.fn(),
    onStartRenamePreview: vi.fn(),
    onWiringBriefChange: vi.fn(),
    ...overrides
  };

  return renderToStaticMarkup(<ProjectPreviewPicker {...props} />);
}

describe("ProjectPreviewPicker", () => {
  it("renders the attached Wired Preview before searchable records", () => {
    const attached = wiredPreview({ id: "attached", name: "Attached Preview" });
    const other = wiredPreview({ id: "other", name: "Other Preview" });
    const markup = renderPicker({
      activePreview: attached,
      previews: [other, attached]
    });

    expect(markup).toContain("Attached to this session");
    expect(markup.indexOf("Attached Preview")).toBeLessThan(markup.indexOf("Other Preview"));
    expect(markup).not.toContain("Current Preview");
  });

  it("renders preview rows as display rows with explicit actions", () => {
    const markup = renderPicker({
      previews: [wiredPreview({ name: "Needs Publish" })]
    });

    expect(markup).toContain("Needs Publish");
    expect(markup).toContain(">Publish<");
    expect(markup).toContain(">Attach<");
    expect(markup).toContain("previewStateLabelButton");
    expect(markup).toContain("aria-label=\"Publish Needs Publish\"");
    expect(markup).not.toMatch(/<button[^>]*class="wiredPreviewRowMain"/);
    expect(markup).not.toContain("startSessionChevron");
  });

  it("shows a prominent copy link action for the healthy active preview", () => {
    const preview = wiredPreview({
      commands: [{ label: "Start app", cwd: "/Users/me/projects/mobile-app", command: "npm run dev" }],
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
    });
    const markup = renderPicker({
      activePreview: preview,
      healthyPreviewId: preview.id,
      previews: [preview]
    });

    expect(markup).toContain(">Ready<");
    expect(markup).toContain("Copy Preview Link");
    expect(markup).toContain("wiredPreviewCopyLinkButton");
    expect(markup).not.toContain("Needs start");
  });

  it("shows the searchable empty state and keeps wire-new available as a tab", () => {
    const markup = renderPicker();

    expect(markup).toContain("aria-label=\"Explain Wired Previews\"");
    expect(markup).toContain("No preview attached to this tab.");
    expect(markup).toContain("No Wired Previews yet.");
    expect(markup).toContain("Wire New");
    expect(markup).not.toContain("Start Wiring Session");
  });

  it("keeps the wire-new tab available when search has no results", () => {
    const markup = renderPicker({ search: "billing admin" });

    expect(markup).toContain("No matches for &quot;billing admin&quot;.");
    expect(markup).toContain("Wire New");
    expect(markup).not.toContain("Wire manually");
    expect(markup).not.toContain("Create and Attach");
    expect(markup).not.toContain("Target URL");
  });

  it("does not consult device-local preview URL storage while rendering", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("Project Preview must be backed by Wired Preview records");
      }
    });

    try {
      const markup = renderPicker({
        activePreview: wiredPreview({ name: "Stored Preview" })
      });
      expect(markup).toContain("Stored Preview");
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, "localStorage", descriptor);
      } else {
        delete (globalThis as { localStorage?: unknown }).localStorage;
      }
    }
  });
});
