import { afterEach, describe, expect, it, vi } from "vitest";
import { closeOpenCozySession, createOpenCozySession, listOpenCozySessions, updateOpenCozySession } from "./api";

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
});
