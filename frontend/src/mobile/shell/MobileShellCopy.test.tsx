import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileShell } from "./MobileShell";
import type { ThreadRecord, TimelineConnectionOptions, TimelineEventRecord } from "../api";

const mobileStyles = readFileSync("src/mobile/styles/mobile.css", "utf8");

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

describe("MobileShell turns", () => {
  beforeEach(() => {
    const style = document.createElement("style");
    style.textContent = mobileStyles;
    document.head.append(style);

    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });

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
        id: "thread-copy",
        status: "idle",
        title: "LiteHarness",
      }),
    ]);
    api.listWiredPreviews.mockResolvedValue([]);
    api.listPreviewManifests.mockResolvedValue([]);
    api.fetchTimeline.mockResolvedValue([
      timelineEvent("event-user", {
        payload: {
          liteharnessType: "user-prompt",
          text: "Sent prompt\nwith two lines",
        },
        type: "run.submitted",
      }),
      timelineEvent("event-assistant", {
        payload: {
          liteharnessType: "assistant-message",
          text: "<p>Received reply</p><ul><li>first item</li></ul>",
        },
        sequence: 2,
        type: "harness.output",
      }),
      timelineEvent("event-error", {
        payload: {
          liteharnessType: "error",
          text: "Copyable failure",
        },
        sequence: 3,
        type: "run.failed",
      }),
    ]);
    api.fetchThreadState.mockImplementation(async (threadId: string) => ({
      serverTime: "2026-05-12T00:00:00.000Z",
      thread: thread({
        id: threadId,
        status: "idle",
        title: "LiteHarness",
      }),
      timeline: [],
    }));
  });

  afterEach(() => {
    cleanup();
    document.head.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders sent and received turn text without copy controls", async () => {
    render(<MobileShell />);

    expect(await screen.findByText(/Sent prompt/)).toBeDefined();
    expect(await screen.findByText("Received reply")).toBeDefined();
    expect(await screen.findByText("first item")).toBeDefined();
    expect(screen.queryByLabelText(/Copy/)).toBeNull();
    expect(screen.queryByLabelText("Copied")).toBeNull();
  });

  it("allows native selection and copy from rendered assistant and error text", async () => {
    render(<MobileShell />);

    const assistantText = await screen.findByText("Received reply");
    const errorText = await screen.findByText("Copyable failure");

    for (const text of [assistantText, errorText]) {
      const styles = getComputedStyle(text);
      expect(styles.userSelect).toBe("text");
    }
    expect(mobileStyles).toContain("-webkit-touch-callout: default");
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
    threadId: "thread-copy",
    type: "harness.status",
    ...overrides,
  };
}
