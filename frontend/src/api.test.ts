import { afterEach, describe, expect, it, vi } from "vitest";
import { closeOpenCozySession, createOpenCozySession } from "./api";

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

  it("sends JSON content type when a request has a body", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "session-1",
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

    await createOpenCozySession("new", "/tmp/opencozy-workspace");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init?.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("lets the backend use its configured default Codex cwd", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "session-1",
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
});
