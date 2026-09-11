import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileShell } from "./MobileShell";
import type { ThreadRecord, TimelineConnectionOptions, TimelineEventRecord } from "../api";

const api = vi.hoisted(() => {
  const state = {
    approvePreviewManifest: vi.fn(),
    attachWiredPreviewToThread: vi.fn(),
    cancelRun: vi.fn(),
    closeThread: vi.fn(),
    connectTimeline: vi.fn((
      _threadId: string,
      onEvent: (event: TimelineEventRecord) => void,
      options?: TimelineConnectionOptions,
    ) => {
      state.timelineListener = onEvent;
      state.timelineOptions = options ?? null;
      return () => undefined;
    }),
    createRun: vi.fn(),
    createThread: vi.fn(),
    deleteWiredPreview: vi.fn(),
    detachWiredPreviewFromThread: vi.fn(),
    discoverWorkspace: vi.fn(),
    discoverWorkspaceStream: vi.fn(),
    fetchAppConfig: vi.fn(),
    fetchHarnesses: vi.fn(),
    fetchThreadState: vi.fn(),
    fetchThreads: vi.fn(),
    fetchTimeline: vi.fn(),
    getWiredPreview: vi.fn(),
    launchPreviewWiringThread: vi.fn(),
    listPreviewManifests: vi.fn(),
    listWiredPreviews: vi.fn(),
    publishBrowserDirectPreviewServices: vi.fn(),
    publishPreviewTarget: vi.fn(),
    renameThread: vi.fn(),
    respondToInput: vi.fn(),
    sendRunInput: vi.fn(),
    timelineListener: null as ((event: TimelineEventRecord) => void) | null,
    timelineOptions: null as TimelineConnectionOptions | null,
    updateWiredPreview: vi.fn(),
  };
  return state;
});

vi.mock("../api", () => api);

describe("MobileShell heartbeat recovery", () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });

    api.timelineListener = null;
    api.timelineOptions = null;
    api.fetchThreadState.mockReset();
    localStorage.clear();
    api.fetchAppConfig.mockResolvedValue({ defaultWorkspacePath: "/workspaces/control-plane" });
    api.fetchHarnesses.mockResolvedValue([
      {
        capabilities: { approvals: false, fastMode: true, resume: true, streaming: true, userInput: true },
        label: "Codex",
        type: "codex",
      },
    ]);
    api.fetchThreads.mockResolvedValue([
      thread({
        id: "thread-running",
        status: "running",
        title: "LiteHarness",
      }),
    ]);
    api.listWiredPreviews.mockResolvedValue([]);
    api.listPreviewManifests.mockResolvedValue([]);
    api.fetchTimeline.mockResolvedValue([]);
    api.fetchThreadState.mockImplementation(async (threadId: string) => ({
      serverTime: "2026-05-12T00:00:00.000Z",
      thread: thread({
        id: threadId,
        status: "running",
        title: "LiteHarness",
      }),
      timeline: [],
    }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("does not fetch Thread snapshots while websocket heartbeats stay healthy", async () => {
    vi.useFakeTimers();

    render(<MobileShell />);
    await flushMicrotasks();

    for (let pulse = 0; pulse < 5; pulse += 1) {
      await act(async () => {
        api.timelineOptions?.onHeartbeat?.("2026-05-12T00:00:00.000Z");
        await vi.advanceTimersByTimeAsync(2_000);
      });
    }

    expect(api.fetchThreadState).not.toHaveBeenCalled();
    expect(api.connectTimeline).toHaveBeenCalledTimes(1);
  });

  it("clears stale Working state from the backend heartbeat snapshot", async () => {
    vi.useFakeTimers();
    api.fetchThreadState.mockResolvedValue({
      serverTime: "2026-05-12T00:00:02.000Z",
      thread: thread({
        id: "thread-running",
        status: "idle",
        title: "LiteHarness",
      }),
      timeline: [
        timelineEvent("submitted", {
          payload: {
            liteharnessType: "user-prompt",
            text: "finish this",
          },
          type: "run.submitted",
        }),
        timelineEvent("completed", {
          payload: {
            liteharnessType: "lifecycle",
            text: "complete",
          },
          type: "run.completed",
        }),
      ],
    });

    render(<MobileShell />);
    await flushMicrotasks();

    expect(screen.getByText("Working")).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(screen.queryByText("Working")).toBeNull();
    expect(api.fetchThreadState).toHaveBeenCalledWith("thread-running");
  });

  it("reconnects the timeline socket after missed websocket heartbeats", async () => {
    vi.useFakeTimers();

    render(<MobileShell />);
    await flushMicrotasks();

    expect(api.connectTimeline).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(api.connectTimeline).toHaveBeenCalledTimes(2);
    expect(api.fetchThreadState).toHaveBeenCalledWith("thread-running");
  });

  it("clears a restart connection error after recovering the same thread", async () => {
    vi.useFakeTimers();
    api.fetchThreadState.mockRejectedValueOnce(new Error("Failed to fetch"));
    render(<MobileShell />);
    await flushMicrotasks();
    await act(async () => {
      api.timelineOptions?.onDisconnect?.();
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByText("Failed to fetch")).toBeDefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(api.fetchThreadState).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Failed to fetch")).toBeNull();
    expect(screen.getByRole("tab", { name: "Active thread LiteHarness" })).toBeDefined();
  });

  it("retries a failed timeline load even when the socket recovers before HTTP", async () => {
    vi.useFakeTimers();
    api.fetchTimeline.mockRejectedValueOnce(new Error("Request failed: 500"));
    api.fetchThreadState.mockResolvedValueOnce({
      serverTime: "2026-05-12T00:00:02.000Z",
      thread: thread({ id: "thread-running", status: "idle", title: "LiteHarness" }),
      timeline: [timelineEvent("history", {
        payload: { liteharnessType: "assistant-message", text: "Recovered history" },
        type: "harness.output",
      })],
    });
    render(<MobileShell />);
    await flushMicrotasks();
    expect(screen.getByText("Request failed: 500")).toBeDefined();
    for (let pulse = 0; pulse < 4; pulse += 1) {
      await act(async () => {
        api.timelineOptions?.onHeartbeat?.("2026-05-12T00:00:02.000Z", "idle");
        await vi.advanceTimersByTimeAsync(2_000);
      });
    }
    expect(screen.getByText("Recovered history")).toBeDefined();
    expect(screen.queryByText("Request failed: 500")).toBeNull();
    expect(api.fetchThreadState).toHaveBeenCalledTimes(1);
  });

  it.each([null, "thread-running"])("retries startup during restart with saved selection %s", async (savedThread) => {
    vi.useFakeTimers();
    if (savedThread) localStorage.setItem("liteharness.activeThread.v1", JSON.stringify(savedThread));
    localStorage.setItem("liteharness.promptDrafts.v1", JSON.stringify({ "thread-running": "Keep this draft" }));
    api.fetchAppConfig.mockRejectedValueOnce(new Error("Request failed: 500"));
    render(<MobileShell />);
    await flushMicrotasks();
    expect(screen.getByText("Request failed: 500")).toBeDefined();
    for (let pulse = 0; pulse < 4; pulse += 1) {
      await act(async () => {
        api.timelineOptions?.onHeartbeat?.("2026-05-12T00:00:02.000Z", "idle");
        await vi.advanceTimersByTimeAsync(2_000);
      });
    }
    expect(screen.queryByText("Request failed: 500")).toBeNull();
    expect(api.fetchAppConfig).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("tab", { name: "Active thread LiteHarness" })).toBeDefined();
    expect((screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement).value).toBe("Keep this draft");
    expect(api.createThread).not.toHaveBeenCalled();
  });

  it("uses heartbeat run recovery to submit the next message in the same tab", async () => {
    vi.useFakeTimers();
    api.createRun.mockResolvedValue({ id: "continued-run" });
    render(<MobileShell />);
    await flushMicrotasks();
    expect(screen.getByText("Working")).toBeDefined();
    await act(async () => {
      api.timelineOptions?.onDisconnect?.();
      await vi.advanceTimersByTimeAsync(2_000);
    });
    // The restart snapshot arrives before the previous owner's lease expires.
    expect(screen.getByText("Working")).toBeDefined();
    for (let pulse = 0; pulse < 32; pulse += 1) {
      await act(async () => {
        api.timelineOptions?.onHeartbeat?.("2026-05-12T00:01:05.000Z", pulse === 31 ? "idle" : "running");
        await vi.advanceTimersByTimeAsync(2_000);
      });
    }
    expect(screen.queryByText("Working")).toBeNull();
    expect(api.fetchThreadState).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "Continue here" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await flushMicrotasks();
    expect(api.createRun).toHaveBeenCalledWith("thread-running", "Continue here");
    expect(api.sendRunInput).not.toHaveBeenCalled();
    expect(api.createThread).not.toHaveBeenCalled();
  });

  it("bounds retries while offline, including duplicate socket error and close callbacks", async () => {
    vi.useFakeTimers();
    api.fetchThreadState.mockRejectedValue(new Error("Failed to fetch"));
    render(<MobileShell />);
    await flushMicrotasks();
    await act(async () => {
      api.timelineOptions?.onDisconnect?.();
      api.timelineOptions?.onDisconnect?.();
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(api.fetchThreadState).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(api.fetchThreadState.mock.calls.length).toBeLessThanOrEqual(6);
    expect(api.connectTimeline).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("tab", { name: "Active thread LiteHarness" })).toBeDefined();
  });

  it("does not erase an operation error when the connection recovers", async () => {
    api.sendRunInput.mockRejectedValueOnce(new Error("Message was not delivered"));
    render(<MobileShell />);
    await flushMicrotasks();
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await flushMicrotasks();
    expect(screen.getByText("Message was not delivered")).toBeDefined();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(screen.getByText("Message was not delivered")).toBeDefined();
    expect((screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement).value).toBe("Keep this draft");
  });

  it("keeps an accepted message sent when its follow-up snapshot fails", async () => {
    vi.useFakeTimers();
    api.sendRunInput.mockResolvedValueOnce({ ok: true, event: null });
    api.fetchThreadState.mockRejectedValueOnce(new Error("Request failed: 500"));
    render(<MobileShell />);
    await flushMicrotasks();
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "Already accepted" } });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await flushMicrotasks();
    expect(screen.getByText("Request failed: 500")).toBeDefined();
    expect((screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByText("Already accepted")).toBeDefined();
    await act(async () => {
      api.timelineOptions?.onHeartbeat?.("2026-05-12T00:00:02.000Z", "running");
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.queryByText("Request failed: 500")).toBeNull();
    expect(api.sendRunInput).toHaveBeenCalledTimes(1);
    expect(api.fetchThreadState).toHaveBeenCalledTimes(2);
  });

  it("coalesces focus, online, and visibility recovery into one snapshot and reconnect", async () => {
    let resolveRecovery!: (value: {
      serverTime: string;
      thread: ThreadRecord;
      timeline: TimelineEventRecord[];
    }) => void;
    api.fetchThreadState.mockImplementation(() => new Promise((resolve) => {
      resolveRecovery = resolve;
    }));

    render(<MobileShell />);
    await flushMicrotasks();

    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(api.fetchThreadState).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRecovery({
        serverTime: "2026-05-12T00:00:02.000Z",
        thread: thread({
          id: "thread-running",
          status: "running",
          title: "LiteHarness",
        }),
        timeline: [],
      });
      await Promise.resolve();
    });

    expect(api.connectTimeline).toHaveBeenCalledTimes(2);
  });
});

function thread(overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    createdAt: "2026-05-12T00:00:00.000Z",
    fastMode: true,
    harnessThreadId: null,
    harnessType: "codex",
    id: "thread-1",
    profileId: "default",
    status: "idle",
    title: "Thread",
    updatedAt: "2026-05-12T00:00:00.000Z",
    wiredPreviewId: null,
    workspacePath: "/workspaces/control-plane",
    ...overrides,
  };
}

function timelineEvent(id: string, overrides: Partial<TimelineEventRecord> = {}): TimelineEventRecord {
  return {
    createdAt: "2026-05-12T00:00:00.000Z",
    id,
    payload: {},
    runId: "run-1",
    sequence: 1,
    threadId: "thread-running",
    type: "harness.status",
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
