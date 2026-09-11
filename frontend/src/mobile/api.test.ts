import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectTimeline, createThread, discoverWorkspaceStream, fetchThreads } from "./api";

describe("mobile api device identity", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", {
      headers: { "content-type": "application/json" },
      status: 200,
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("sends one stable device id on thread HTTP requests", async () => {
    await fetchThreads();
    await createThread({
      title: "LiteHarness",
      workspacePath: "/workspaces/control-plane",
    });

    const calls = vi.mocked(fetch).mock.calls;
    const firstHeaders = new Headers(calls[0]?.[1]?.headers);
    const secondHeaders = new Headers(calls[1]?.[1]?.headers);
    const firstDeviceId = firstHeaders.get("x-liteharness-device-id");

    expect(firstDeviceId).toMatch(/^pwa:/);
    expect(secondHeaders.get("x-liteharness-device-id")).toBe(firstDeviceId);
  });

  it("sends the same device id on websocket timeline subscriptions", () => {
    const urls: string[] = [];
    class MockWebSocket {
      constructor(url: string) {
        urls.push(url);
      }

      addEventListener() {
        return undefined;
      }

      close() {
        return undefined;
      }
    }
    vi.stubGlobal("WebSocket", MockWebSocket);

    void fetchThreads();
    const disconnect = connectTimeline("thread-1", vi.fn());
    disconnect();

    const httpHeaders = new Headers(vi.mocked(fetch).mock.calls[0]?.[1]?.headers);
    const url = new URL(urls[0] ?? "");

    expect(url.searchParams.get("deviceId")).toBe(httpHeaders.get("x-liteharness-device-id"));
  });

  it("reads workspace discovery stream events", async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("{\"text\":\"Searching liteharness\",\"type\":\"workspace.search.started\"}\n{\"discovery\":"));
        controller.enqueue(encoder.encode("{\"explanation\":\"Matched repo name\",\"title\":\"liteharness\",\"workspacePath\":\"/repo\"},\"text\":\"Found liteharness\",\"type\":\"workspace.search.found\"}\n"));
        controller.close();
      },
    }), {
      headers: { "content-type": "application/x-ndjson" },
      status: 200,
    })));

    const controller = new AbortController();
    const events = [];
    for await (const event of discoverWorkspaceStream({ description: "liteharness project" }, { signal: controller.signal })) {
      events.push(event);
    }

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call?.[0]).toBe("/api/workspaces/discover/stream");
    expect(call?.[1]?.signal).toBe(controller.signal);
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      description: "liteharness project",
      harnessType: "codex",
    });
    expect(events).toEqual([
      { text: "Searching liteharness", type: "workspace.search.started" },
      {
        discovery: {
          explanation: "Matched repo name",
          title: "liteharness",
          workspacePath: "/repo",
        },
        text: "Found liteharness",
        type: "workspace.search.found",
      },
    ]);
  });
});
