import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approvePreviewManifest,
  attachWiredPreviewToSession,
  closeOpenCozySession,
  createOpenCozySession,
  createWiredPreview,
  deleteWiredPreview,
  detachWiredPreviewFromSession,
  getWiredPreview,
  launchPreviewWiringSession,
  listPreviewManifests,
  listOpenCozySessions,
  listPreviewPublishedOrigins,
  publishBrowserDirectPreviewServices,
  publishPreviewDependencyService,
  listWiredPreviews,
  publishPreviewTarget,
  submitPreviewManifest,
  unpublishPreviewOrigin,
  updateOpenCozySession,
  updateWiredPreview
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API requests", () => {
  it("does not send JSON content type for bodyless DELETE requests", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await closeOpenCozySession("session-1");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init?.headers as Headers;
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("can request a device-scoped OpenCozy session list", async () => {
    const fetchMock = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);

    await listOpenCozySessions({ deviceId: "device-1" });

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toBe("/api/open-cozy-sessions?deviceId=device-1");
  });

  it("can request explicit device-local session tabs from other devices", async () => {
    const fetchMock = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);

    await listOpenCozySessions({ deviceId: "device-1", tabIds: ["session-1", "session/2"] });

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toBe("/api/open-cozy-sessions?deviceId=device-1&tabId=session-1&tabId=session%2F2");
  });

  it("sends JSON content type when a request has a body", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "session-1",
        name: "Workspace",
        codexThreadId: null,
        mode: "new",
        command: "codex",
        args: [],
        cwd: "/tmp/opencozy-workspace",
        status: "running",
        exitCode: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await createOpenCozySession("new", { cwd: "/tmp/opencozy-workspace", deviceId: "device-1", name: "Workspace" });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init?.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ mode: "new", cwd: "/tmp/opencozy-workspace", deviceId: "device-1", name: "Workspace" }));
  });

  it("can request a device-scoped Codex thread for resume-last", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "session-1",
        name: "Last Session",
        codexThreadId: "thread-1",
        deviceId: "device-1",
        mode: "resumeLast",
        command: "codex",
        args: [],
        cwd: "/home/opencozy",
        status: "running",
        exitCode: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await createOpenCozySession("resumeLast", { codexThreadId: "thread-1", deviceId: "device-1" });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ mode: "resumeLast", codexThreadId: "thread-1", deviceId: "device-1" }));
  });

  it("lets the backend use its configured default Codex cwd", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "session-1",
        name: "New Session",
        codexThreadId: null,
        mode: "new",
        command: "codex",
        args: [],
        cwd: "/home/opencozy",
        status: "running",
        exitCode: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await createOpenCozySession("new");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ mode: "new" }));
  });

  it("updates an OpenCozy session name with JSON content type", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "session-1",
        name: "PR Review",
        codexThreadId: "thread-1",
        mode: "new",
        command: "codex",
        args: [],
        cwd: "/home/opencozy",
        status: "running",
        exitCode: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateOpenCozySession("session-1", { name: "PR Review" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init?.headers as Headers;
    expect(url).toBe("/api/open-cozy-sessions/session-1");
    expect(init.method).toBe("PUT");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ name: "PR Review" }));
  });

  it("can search Wired Previews", async () => {
    const fetchMock = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);

    await listWiredPreviews("mobile app");

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toBe("/api/wired-previews?search=mobile+app");
  });

  it("can load one Wired Preview by id", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "preview-1",
        name: "Mobile App",
        projectDirectory: "/tmp/app",
        target: { name: "App", url: "http://127.0.0.1:5173/" },
        dependencyServices: [],
        commands: [],
        requestedPublishedOrigins: [],
        publishedOrigins: [],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await getWiredPreview("preview-1");

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toBe("/api/wired-previews/preview-1");
  });

  it("can create a Wired Preview", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "preview-1",
        name: "Mobile App",
        projectDirectory: "/tmp/app",
        target: { name: "App", url: "http://127.0.0.1:5173/" },
        dependencyServices: [],
        commands: [],
        requestedPublishedOrigins: [],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await createWiredPreview({
      name: "Mobile App",
      projectDirectory: "/tmp/app",
      target: { name: "App", url: "localhost:5173" },
      dependencyServices: [],
      commands: [],
      requestedPublishedOrigins: []
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init?.headers as Headers;
    expect(url).toBe("/api/wired-previews");
    expect(init.method).toBe("POST");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({
      name: "Mobile App",
      projectDirectory: "/tmp/app",
      target: { name: "App", url: "localhost:5173" },
      dependencyServices: [],
      commands: [],
      requestedPublishedOrigins: []
    }));
  });

  it("can attach a Wired Preview to a session", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "session-1",
        name: "App",
        codexThreadId: null,
        wiredPreviewId: "preview-1",
        mode: "new",
        command: "codex",
        args: [],
        cwd: "/tmp/app",
        status: "running",
        exitCode: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await attachWiredPreviewToSession("session-1", "preview-1");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/open-cozy-sessions/session-1/wired-preview");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify({ wiredPreviewId: "preview-1" }));
  });

  it("can detach a Wired Preview from a session", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "session-1",
        name: "App",
        codexThreadId: null,
        wiredPreviewId: null,
        mode: "new",
        command: "codex",
        args: [],
        cwd: "/tmp/app",
        status: "running",
        exitCode: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await detachWiredPreviewFromSession("session-1");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init?.headers as Headers;
    expect(url).toBe("/api/open-cozy-sessions/session-1/wired-preview");
    expect(init.method).toBe("DELETE");
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("can list, submit, and approve Preview Manifests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({
        id: "manifest-1",
        status: "pending",
        wiredPreviewId: null,
        approvedWiredPreviewId: null,
        proposedName: "Mobile App",
        projectDirectory: "/tmp/app",
        target: { name: "App", url: "http://127.0.0.1:5173/" },
        dependencyServices: [],
        commands: [],
        requestedPublishedOrigins: [],
        materialHash: "hash",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        approvedAt: null
      }))
      .mockResolvedValueOnce(Response.json({
        manifest: {
          id: "manifest-1",
          status: "approved",
          wiredPreviewId: null,
          approvedWiredPreviewId: "preview-1",
          proposedName: "Confirmed",
          projectDirectory: "/tmp/app",
          target: { name: "App", url: "http://127.0.0.1:5173/" },
          dependencyServices: [],
          commands: [],
          requestedPublishedOrigins: [],
          materialHash: "hash",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(1).toISOString(),
          approvedAt: new Date(1).toISOString()
        },
        wiredPreview: {
          id: "preview-1",
          name: "Confirmed",
          projectDirectory: "/tmp/app",
          target: { name: "App", url: "http://127.0.0.1:5173/" },
          dependencyServices: [],
          commands: [],
          requestedPublishedOrigins: [],
          createdAt: new Date(1).toISOString(),
          updatedAt: new Date(1).toISOString()
        }
      }));
    vi.stubGlobal("fetch", fetchMock);

    await listPreviewManifests("pending");
    await submitPreviewManifest({
      name: "Mobile App",
      projectDirectory: "/tmp/app",
      target: { name: "App", url: "localhost:5173" },
      dependencyServices: [],
      commands: [],
      requestedPublishedOrigins: []
    });
    await approvePreviewManifest("manifest-1", "Confirmed");

    const [listUrl] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(listUrl).toBe("/api/preview-manifests?status=pending");

    const [submitUrl, submitInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(submitUrl).toBe("/api/preview-manifests");
    expect(submitInit.method).toBe("POST");
    expect(submitInit.body).toBe(JSON.stringify({
      name: "Mobile App",
      projectDirectory: "/tmp/app",
      target: { name: "App", url: "localhost:5173" },
      dependencyServices: [],
      commands: [],
      requestedPublishedOrigins: []
    }));

    const [approveUrl, approveInit] = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect(approveUrl).toBe("/api/preview-manifests/manifest-1/approve");
    expect(approveInit.method).toBe("PUT");
    expect(approveInit.body).toBe(JSON.stringify({ name: "Confirmed" }));
  });

  it("can launch a Preview Wiring Session", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        session: {
          id: "session-1",
          name: "Wire Preview",
          codexThreadId: null,
          wiredPreviewId: null,
          deviceId: "device-1",
          mode: "new",
          command: "codex",
          args: [],
          cwd: "/tmp/app",
          status: "running",
          exitCode: null,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString()
        },
        prompt: "wire prompt",
        reused: false,
        wiredPreview: null
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await launchPreviewWiringSession({
      deviceId: "device-1",
      projectSearchBrief: "mobile app",
      wiredPreviewId: "preview-1"
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/preview-wiring-sessions");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({
      deviceId: "device-1",
      projectSearchBrief: "mobile app",
      wiredPreviewId: "preview-1"
    }));
  });

  it("can update and delete a Wired Preview", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({
        id: "preview-1",
        name: "Renamed",
        projectDirectory: "/tmp/app",
        target: { name: "App", url: "http://127.0.0.1:5173/" },
        dependencyServices: [],
        commands: [],
        requestedPublishedOrigins: [],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(1).toISOString()
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await updateWiredPreview("preview-1", {
      name: "Renamed",
      projectDirectory: "/tmp/app",
      target: { name: "App", url: "http://127.0.0.1:5173/" },
      dependencyServices: [],
      commands: [],
      requestedPublishedOrigins: []
    });
    await deleteWiredPreview("preview-1");

    const [updateUrl, updateInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(updateUrl).toBe("/api/wired-previews/preview-1");
    expect(updateInit.method).toBe("PUT");
    expect(updateInit.body).toBe(JSON.stringify({
      name: "Renamed",
      projectDirectory: "/tmp/app",
      target: { name: "App", url: "http://127.0.0.1:5173/" },
      dependencyServices: [],
      commands: [],
      requestedPublishedOrigins: []
    }));

    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const deleteHeaders = deleteInit?.headers as Headers;
    expect(deleteUrl).toBe("/api/wired-previews/preview-1");
    expect(deleteInit.method).toBe("DELETE");
    expect(deleteHeaders.has("Content-Type")).toBe(false);
  });

  it("can publish, list, and unpublish Preview Published Origins", async () => {
    const response = {
      origin: {
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
      },
      origins: [],
      wiredPreview: {
        id: "preview-1",
        name: "App",
        projectDirectory: "/tmp/app",
        target: { name: "App", url: "http://127.0.0.1:5173/" },
        dependencyServices: [],
        commands: [],
        requestedPublishedOrigins: [],
        publishedOrigins: [],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString()
      }
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([response.origin]))
      .mockResolvedValueOnce(Response.json(response))
      .mockResolvedValueOnce(Response.json(response))
      .mockResolvedValueOnce(Response.json(response))
      .mockResolvedValueOnce(Response.json(response));
    vi.stubGlobal("fetch", fetchMock);

    await listPreviewPublishedOrigins("preview-1");
    await publishPreviewTarget("preview-1", 8443);
    await publishPreviewDependencyService("preview-1", 0, 8444);
    await publishBrowserDirectPreviewServices("preview-1");
    await unpublishPreviewOrigin("preview-1", "origin-1");

    const [listUrl] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(listUrl).toBe("/api/wired-previews/preview-1/published-origins");

    const [publishUrl, publishInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(publishUrl).toBe("/api/wired-previews/preview-1/published-origins");
    expect(publishInit.method).toBe("POST");
    expect(publishInit.body).toBe(JSON.stringify({ source: "target", httpsPort: 8443 }));

    const [dependencyUrl, dependencyInit] = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect(dependencyUrl).toBe("/api/wired-previews/preview-1/published-origins");
    expect(dependencyInit.method).toBe("POST");
    expect(dependencyInit.body).toBe(JSON.stringify({ source: "dependencyService", dependencyServiceIndex: 0, httpsPort: 8444 }));

    const [bulkUrl, bulkInit] = fetchMock.mock.calls[3] as unknown as [string, RequestInit];
    expect(bulkUrl).toBe("/api/wired-previews/preview-1/published-origins");
    expect(bulkInit.method).toBe("POST");
    expect(bulkInit.body).toBe(JSON.stringify({ source: "browserDirectDependencyServices" }));

    const [unpublishUrl, unpublishInit] = fetchMock.mock.calls[4] as unknown as [string, RequestInit];
    const unpublishHeaders = unpublishInit?.headers as Headers;
    expect(unpublishUrl).toBe("/api/wired-previews/preview-1/published-origins/origin-1");
    expect(unpublishInit.method).toBe("DELETE");
    expect(unpublishHeaders.has("Content-Type")).toBe(false);
  });
});
