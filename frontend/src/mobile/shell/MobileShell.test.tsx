import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileShell } from "./MobileShell";
import type { RunRecord, ThreadRecord, TimelineEventRecord } from "../api";

const api = vi.hoisted(() => {
  const state = {
    approvePreviewManifest: vi.fn(),
    attachWiredPreviewToThread: vi.fn(),
    connectTimeline: vi.fn((_threadId: string, onEvent: (event: TimelineEventRecord) => void) => {
      state.timelineListener = onEvent;
      return () => undefined;
    }),
    cancelRun: vi.fn(),
    closeThreads: vi.fn(),
    closeThread: vi.fn(),
    uploadAttachment: vi.fn(),
    createRun: vi.fn(),
    createThread: vi.fn(),
    deleteWiredPreview: vi.fn(),
    detachWiredPreviewFromThread: vi.fn(),
    discoverWorkspace: vi.fn(),
    discoverWorkspaceStream: vi.fn(),
    fetchAppConfig: vi.fn(),
    fetchClosedThreads: vi.fn(),
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
    reopenThread: vi.fn(),
    respondToApproval: vi.fn(),
    respondToInput: vi.fn(),
    sendRunInput: vi.fn(),
    timelineListener: null as ((event: TimelineEventRecord) => void) | null,
    updateThreadSettings: vi.fn(),
    updateWiredPreview: vi.fn(),
  };
  return state;
});

vi.mock("../api", () => api);

describe("MobileShell", () => {
  it("blocks sending while an upload is pending or failed and allows retrying it", async () => {
    let rejectUpload!: (error: Error) => void;
    api.uploadAttachment.mockImplementationOnce(() => new Promise((_, reject) => { rejectUpload = reject; }));
    render(<MobileShell />);
    await screen.findByRole("textbox", { name: "Prompt" });
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "Read this" } });
    fireEvent.change(screen.getByLabelText("Attach files"), { target: { files: [new File(["hello"], "notes.txt")] } });
    await screen.findByText("Uploading…");
    expect((screen.getByRole("button", { name: "Steer" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => rejectUpload(new Error("Upload connection lost")));
    await screen.findByText("Upload connection lost");
    expect((screen.getByRole("button", { name: "Steer" }) as HTMLButtonElement).disabled).toBe(true);
    api.uploadAttachment.mockResolvedValueOnce({ id: "retry-file", name: "notes.txt", size: 5, mediaType: "application/octet-stream" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Steer" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Remove notes.txt" }));
    expect(screen.queryByRole("list", { name: "Attached files" })).toBeNull();
    expect(api.sendRunInput).not.toHaveBeenCalled();
  });

  it("uploads a selected file and sends it with steering, preserving the draft after a rejected send", async () => {
    const attachment = { id: "attachment-one", name: "notes.txt", size: 5, mediaType: "application/octet-stream" };
    api.uploadAttachment.mockResolvedValue(attachment);
    api.sendRunInput.mockRejectedValueOnce(new Error("Try again"));
    render(<MobileShell />);
    await screen.findByRole("textbox", { name: "Prompt" });
    fireEvent.change(screen.getByLabelText("Attach files"), { target: { files: [new File(["hello"], "notes.txt")] } });
    await screen.findByRole("button", { name: "Remove notes.txt" });
    await waitFor(() => expect((screen.getByRole("button", { name: "Steer" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(api.sendRunInput).toHaveBeenCalledWith("thread-running", "", ["attachment-one"]));
    await screen.findByRole("button", { name: "Remove notes.txt" });
    expect(screen.getByText("Try again")).toBeTruthy();
    api.sendRunInput.mockResolvedValue({ event: null, ok: true });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove notes.txt" })).toBeNull());
    expect(api.uploadAttachment).toHaveBeenCalledTimes(1);
  });

  beforeEach(() => {
    api.timelineListener = null;
    api.fetchAppConfig.mockResolvedValue({
      defaultProfileId: "default",
      defaultWorkspacePath: "/workspaces/control-plane",
      profiles: [
        { id: "default", label: "Balance", model: "gpt-6-astra", reasoningEffort: "high", subagentModel: "gpt-6-astra", subagentReasoningEffort: "high", fastMode: true, description: "Astra subagents with high reasoning" },
        { id: "speed", label: "Speed", model: "gpt-6-astra", reasoningEffort: "medium", subagentModel: "gpt-6-astra", subagentReasoningEffort: "low", fastMode: true, description: "Astra subagents with low reasoning" },
        { id: "power", label: "Power", model: "gpt-6-astra", reasoningEffort: "max", subagentModel: "gpt-6-astra", subagentReasoningEffort: "xhigh", fastMode: false, description: "Astra subagents with xhigh reasoning" },
      ],
    });
    api.fetchHarnesses.mockResolvedValue([
      {
        capabilities: { approvals: false, fastMode: true, resume: true, streaming: true, userInput: true },
        label: "Codex",
        type: "codex",
      },
    ]);
    api.discoverWorkspace.mockResolvedValue({
      explanation: "Default workspace",
      title: "liteharness",
      workspacePath: "/workspaces/control-plane",
    });
    api.discoverWorkspaceStream.mockImplementation(async function* (input: { description: string }) {
      const discovery = await api.discoverWorkspace(input);
      yield { text: `Searching ${input.description}`, type: "workspace.search.started" };
      yield { discovery, text: `Found ${discovery.title}`, type: "workspace.search.found" };
    });
    api.fetchThreads.mockResolvedValue([
      thread({
        id: "thread-running",
        status: "running",
        title: "LiteHarness",
      }),
    ]);
    api.fetchTimeline.mockResolvedValue([]);
    api.fetchClosedThreads.mockResolvedValue([]);
    api.closeThreads.mockResolvedValue({ closedIds: [], skippedIds: [] });
    api.closeThread.mockResolvedValue(undefined);
    api.reopenThread.mockImplementation(async (threadId: string) => thread({ id: threadId }));
    api.listWiredPreviews.mockResolvedValue([]);
    api.listPreviewManifests.mockResolvedValue([]);
    api.fetchThreadState.mockResolvedValue({
      serverTime: "2026-05-12T00:00:00.000Z",
      thread: thread({ id: "thread-running", status: "running", title: "LiteHarness" }),
      timeline: [],
    });
    api.cancelRun.mockResolvedValue(undefined);
    api.respondToApproval.mockResolvedValue(undefined);
    api.respondToInput.mockResolvedValue(undefined);
    api.sendRunInput.mockResolvedValue({
      event: timelineEvent("event-steered", {
        payload: {
          liteharnessType: "user-prompt",
          text: "Keep the patch smaller",
        },
        type: "run.steered",
      }),
      ok: true,
    });
    api.detachWiredPreviewFromThread.mockImplementation(async (threadId: string) => thread({ id: threadId, wiredPreviewId: null }));
    api.updateThreadSettings.mockImplementation(async (threadId: string, update: Partial<ThreadRecord>) => (
      thread({
        id: threadId,
        status: "running",
        title: "LiteHarness",
        ...update,
        ...(update.profileId
          ? {
              fastMode: update.profileId !== "power",
              profileId: update.profileId,
            }
          : {}),
      })
    ));
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders the working note inline with the timeline", async () => {
    render(<MobileShell />);

    const working = await screen.findByText("Working");

    expect(screen.queryByText("Working...")).toBeNull();
    expect(working.closest(".lh-mobile-timeline-stack")).not.toBeNull();
    expect(working.closest(".lh-mobile-composer-footer")).toBeNull();
  });

  it("starts new tabs with the server's configured default profile", async () => {
    api.fetchAppConfig.mockResolvedValue({
      ...(await api.fetchAppConfig()), defaultProfileId: "power",
    });
    api.createThread.mockResolvedValueOnce(thread({ id: "new-power", profileId: "power", fastMode: false }));
    render(<MobileShell />);
    fireEvent.click(await screen.findByLabelText("New tab"));
    await screen.findByLabelText("Model and settings");
    const page = within(screen.getByRole("main", { name: "New thread workspace" }));
    fireEvent.click(page.getByRole("button", { name: /Home/ }));
    await waitFor(() => expect(api.createThread).toHaveBeenCalledWith(expect.objectContaining({ profileId: "power" })));
  });

  it("offers only the three Astra presets and creates a Balance tab", async () => {
    api.createThread.mockResolvedValueOnce(thread({ id: "new-balance", profileId: "default", fastMode: true }));
    render(<MobileShell />);
    fireEvent.click(await screen.findByLabelText("New tab"));
    fireEvent.click(await screen.findByLabelText("Model and settings"));
    const balance = screen.getByRole("button", { name: "Balance profile" });
    expect(balance.textContent).toContain("gpt-6-astra");
    expect(screen.getAllByRole("button", { name: / profile$/ })).toHaveLength(3);
    for (const [label, main, child] of [["Balance", "high", "high"], ["Speed", "medium", "low"], ["Power", "max", "xhigh"]]) {
      expect(screen.getByRole("button", { name: `${label} profile` }).textContent).toContain(`Main ${main} · Subagents ${child}`);
    }
    fireEvent.click(balance);
    expect(screen.getByLabelText("Model and settings").textContent).toContain("Balance");
    fireEvent.click(screen.getByRole("button", { name: /Home/ }));
    await waitFor(() => expect(api.createThread).toHaveBeenCalledWith(expect.objectContaining({ profileId: "default", fastMode: true })));
  });

  it("refreshes model settings when opening a new tab after configuration changes", async () => {
    const initialConfig = await api.fetchAppConfig();
    api.fetchAppConfig.mockResolvedValueOnce({ ...initialConfig, defaultProfileId: "speed" });
    render(<MobileShell />);
    await screen.findByText("Working");
    api.fetchAppConfig.mockResolvedValue({ ...initialConfig, profiles: initialConfig.profiles.map((profile: object) => ({
      ...profile, model: "gpt-updated", reasoningEffort: "xhigh",
    })) });
    fireEvent.click(screen.getByLabelText("New tab"));
    await screen.findByLabelText("Model and settings");
    expect(screen.getByLabelText("Model and settings").textContent).toContain("gpt-updated");
    expect(screen.getByLabelText("Model and settings").textContent).toContain("Balance");
  });

  it("blocks creation until failed model settings are retried", async () => {
    render(<MobileShell />);
    await screen.findByText("Working");
    api.fetchAppConfig.mockRejectedValueOnce(new Error("Request failed: 500"));
    fireEvent.click(screen.getByLabelText("New tab"));
    const home = screen.getByRole("button", { name: /Home/ }) as HTMLButtonElement;
    expect(home.disabled).toBe(true);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Request failed: 500");
    fireEvent.click(home);
    expect(api.createThread).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry settings" }));
    await screen.findByLabelText("Model and settings");
    expect(home.disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps background thread activity out of the new tab workspace flow", async () => {
    render(<MobileShell />);

    expect(await screen.findByText("Working")).toBeDefined();

    fireEvent.click(screen.getByLabelText("New tab"));
    await screen.findByLabelText("Model and settings");

    const page = within(screen.getByRole("main", { name: "New thread workspace" }));
    expect(page.queryByText("Working")).toBeNull();

    fireEvent.click(page.getByRole("tab", { name: "Find workspace" }));
    expect(page.queryByText("Working")).toBeNull();
    expect(screen.queryByLabelText("Prompt")).toBeNull();
  });

  it("renders the working note while workspace discovery is pending", async () => {
    const pendingDiscovery = deferred<{
      explanation: string;
      title: string;
      workspacePath: string;
    }>();
    api.fetchThreads.mockResolvedValueOnce([]);
    api.discoverWorkspaceStream.mockImplementationOnce(async function* (input: { description: string }) {
      yield { text: `Searching ${input.description}`, type: "workspace.search.started" };
      yield {
        discovery: await pendingDiscovery.promise,
        text: "Found liteharness",
        type: "workspace.search.found",
      };
    });
    render(<MobileShell />);

    fireEvent.click(await screen.findByLabelText("New tab"));
    await screen.findByLabelText("Model and settings");
    fireEvent.click(screen.getByRole("tab", { name: "Find workspace" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Workspace" }), {
      target: { value: "liteharness project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find workspace" }));

    const page = within(screen.getByRole("main", { name: "New thread workspace" }));
    await waitFor(() => {
      expect(page.getByText("Working").closest(".lh-mobile-workspace-working")).not.toBeNull();
    });
    expect(await screen.findByText("Searching liteharness project")).toBeDefined();

    pendingDiscovery.resolve({
      explanation: "Matched repo name",
      title: "liteharness",
      workspacePath: "/workspaces/control-plane",
    });
    expect(await screen.findByText("Matched repo name")).toBeDefined();
    expect(page.queryByText("Working")).toBeNull();
  });

  it("renders an elapsed counter in the working note", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T00:00:00.000Z"));
    api.fetchTimeline.mockResolvedValueOnce([
      timelineEvent("event-started", {
        createdAt: "2026-05-12T00:00:00.000Z",
        payload: { liteharnessType: "lifecycle" },
        type: "run.started",
      }),
    ]);
    render(<MobileShell />);

    await flushMobileShell();

    expect(screen.getByText("Working")).toBeDefined();
    expect(screen.getByText("•")).toBeDefined();
    expect(screen.getByText("0s")).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(screen.getByText("1s")).toBeDefined();
  });

  it("renders the worked duration after a terminal run event without a separator", async () => {
    api.fetchThreads.mockResolvedValueOnce([
      thread({ id: "thread-running", status: "idle", title: "LiteHarness" }),
    ]);
    const completedTimeline = [
      timelineEvent("event-started", {
        createdAt: "2026-05-12T00:00:00.000Z",
        payload: { liteharnessType: "lifecycle" },
        type: "run.started",
      }),
      timelineEvent("event-completed", {
        createdAt: "2026-05-12T00:00:04.000Z",
        payload: {
          liteharnessType: "lifecycle",
          stableKey: "run:run-1:lifecycle",
          text: "Codex run complete.",
        },
        sequence: 2,
        type: "run.completed",
      }),
    ];
    api.fetchTimeline.mockResolvedValueOnce(completedTimeline);
    api.fetchThreadState.mockResolvedValue({
      serverTime: "2026-05-12T00:00:04.000Z",
      thread: thread({ id: "thread-running", status: "idle", title: "LiteHarness" }),
      timeline: completedTimeline,
    });
    const { container } = render(<MobileShell />);

    expect(await screen.findByText("Worked for")).toBeDefined();
    expect(screen.getByText("4s")).toBeDefined();
    expect(container.querySelector(".lh-mobile-run-separator")).toBeNull();
    expect(container.querySelector(".lh-mobile-worked-separator")).toBeNull();
  });

  it("does not render a separator when a new run starts after existing timeline content", async () => {
    const idleThread = thread({ id: "thread-idle", status: "idle", title: "LiteHarness" });
    const pendingRun = deferred<RunRecord>();
    api.fetchThreads.mockResolvedValueOnce([idleThread]);
    api.fetchTimeline.mockResolvedValueOnce([
      timelineEvent("event-first-submitted", {
        payload: {
          liteharnessType: "user-prompt",
          text: "First run",
        },
        threadId: "thread-idle",
        type: "run.submitted",
      }),
      timelineEvent("event-first-completed", {
        createdAt: "2026-05-12T00:00:04.000Z",
        payload: { liteharnessType: "lifecycle" },
        threadId: "thread-idle",
        type: "run.completed",
      }),
    ]);
    api.fetchThreadState.mockResolvedValue({
      serverTime: "2026-05-12T00:00:04.000Z",
      thread: idleThread,
      timeline: [],
    });
    api.createRun.mockReturnValueOnce(pendingRun.promise);
    const { container } = render(<MobileShell />);

    await screen.findByText("First run");
    expect(container.querySelector(".lh-mobile-run-separator")).toBeNull();

    const promptInput = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
    fireEvent.change(promptInput, {
      target: { value: "Second run" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(screen.getByText("Second run")).toBeDefined();
    expect(container.querySelector(".lh-mobile-run-separator")).toBeNull();

    pendingRun.resolve(run({
      id: "run-second",
      prompt: "Second run",
      status: "running",
      threadId: "thread-idle",
    }));
    await flushMobileShell();
  });

  it("keeps the working counter when an optimistic new run is committed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T00:00:00.000Z"));
    const idleThread = thread({ id: "thread-idle", status: "idle", title: "LiteHarness" });
    const pendingRun = deferred<RunRecord>();
    api.fetchThreads.mockResolvedValueOnce([idleThread]);
    api.fetchThreadState.mockResolvedValue({
      serverTime: "2026-05-12T00:00:03.000Z",
      thread: thread({ id: "thread-idle", status: "running", title: "LiteHarness" }),
      timeline: [],
    });
    api.createRun.mockReturnValueOnce(pendingRun.promise);
    render(<MobileShell />);

    await flushMobileShell();
    const promptInput = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
    fireEvent.change(promptInput, {
      target: { value: "Start timed run" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(screen.getByText("0s")).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByText("3s")).toBeDefined();

    pendingRun.resolve(run({
      id: "run-timed",
      prompt: "Start timed run",
      status: "running",
      threadId: "thread-idle",
    }));
    await flushMobileShell();
    expect(screen.getByText("3s")).toBeDefined();

    act(() => {
      api.timelineListener?.(timelineEvent("event-timed-submitted", {
        createdAt: "2026-05-12T00:00:03.000Z",
        payload: {
          liteharnessType: "user-prompt",
          text: "Start timed run",
        },
        runId: "run-timed",
        threadId: "thread-idle",
        type: "run.submitted",
      }));
    });
    expect(screen.getByText("3s")).toBeDefined();
  });

  it("renders thread tabs in the header with workspace menu actions", async () => {
    api.fetchThreads.mockResolvedValueOnce([
      thread({
        id: "thread-active",
        status: "idle",
        title: "LiteHarness",
      }),
      thread({
        id: "thread-other",
        status: "idle",
        title: "Other",
      }),
    ]);
    const { container } = render(<MobileShell />);

    expect(await screen.findByRole("tab", { name: "Active thread LiteHarness" })).toBeDefined();
    expect(screen.queryByLabelText("Thread context")).toBeNull();
    expect(container.querySelector(".lh-mobile-toolbar")).toBeNull();
    expect(screen.queryByLabelText("Thread menu for Other")).toBeNull();

    fireEvent.click(screen.getByLabelText("Thread menu for LiteHarness"));

    const menu = screen.getByRole("dialog", { name: "LiteHarness thread options" });
    const renameInput = within(menu).getByLabelText("Rename") as HTMLInputElement;
    expect(document.activeElement).not.toBe(renameInput);
    expect(within(menu).getByText("~")).toBeDefined();
    expect(within(menu).getByRole("button", { name: "Save thread name" })).toBeDefined();
    expect(within(menu).getByRole("button", { name: "Close thread" })).toBeDefined();
    expect(within(menu).queryByText("Cancel")).toBeNull();

    fireEvent.click(within(menu).getByRole("button", { name: "Close thread" }));
    await waitFor(() => expect(api.closeThread).toHaveBeenCalledWith("thread-active"));
    expect(screen.queryByLabelText("Rename")).toBeNull();
  });

  it("opens a subagent timeline and returns to the main line", async () => {
    api.fetchThreads.mockResolvedValueOnce([
      thread({ id: "thread-idle", status: "idle", title: "LiteHarness" }),
    ]);
    api.fetchTimeline.mockResolvedValueOnce([
      timelineEvent("main-prompt", {
        payload: {
          liteharnessType: "user-prompt",
          text: "Build it",
        },
        threadId: "thread-idle",
        type: "run.submitted",
      }),
      timelineEvent("spawn", {
        payload: {
          collabTool: "spawnAgent",
          liteharnessType: "subagent",
          receiverThreadIds: ["agent-1"],
          text: "Spawn 1 agent",
        },
        threadId: "thread-idle",
      }),
      timelineEvent("agent-start", {
        payload: {
          agentNickname: "Scout",
          agentRole: "explorer",
          agentStatus: "running",
          agentThreadId: "agent-1",
          liteharnessType: "subagent",
          parentThreadId: "thread-idle",
          text: "Scout started",
        },
        threadId: "thread-idle",
      }),
      timelineEvent("agent-output", {
        payload: {
          agentNickname: "Scout",
          agentRole: "explorer",
          agentThreadId: "agent-1",
          liteharnessType: "assistant-message",
          parentThreadId: "thread-idle",
          text: "Mapped the code",
        },
        threadId: "thread-idle",
        type: "harness.output",
      }),
    ]);

    render(<MobileShell />);

    expect(await screen.findByRole("navigation", { name: "Agent timelines" })).toBeDefined();
    expect(screen.getByText("Build it")).toBeDefined();
    expect(screen.queryByText("Mapped the code")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show agents" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Scout, running" }));

    expect(await screen.findByText("Mapped the code")).toBeDefined();
    expect(screen.queryByText("Build it")).toBeNull();
    expect(screen.getByRole("button", { name: "Back to Main" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Back to Main" }));

    expect(await screen.findByText("Build it")).toBeDefined();
    expect(screen.queryByText("Mapped the code")).toBeNull();
  });

  it("switches to an existing thread when the active thread disappears", async () => {
    api.fetchThreads.mockResolvedValueOnce([
      thread({ id: "thread-stale", status: "idle", title: "Stale" }),
      thread({ id: "thread-live", status: "idle", title: "Live" }),
    ]);
    api.fetchTimeline
      .mockRejectedValueOnce(new Error("Thread not found"))
      .mockResolvedValue([]);

    render(<MobileShell />);

    await waitFor(() => {
      expect(api.fetchTimeline).toHaveBeenCalledWith("thread-stale");
      expect(api.fetchTimeline).toHaveBeenCalledWith("thread-live");
    });
    expect(screen.getByRole("tab", { name: "Active thread Live" })).toBeDefined();
    expect(screen.queryByText("Thread not found")).toBeNull();
  });

  it("opens the settings page from the top bar gear button", async () => {
    render(<MobileShell />);

    fireEvent.click(await screen.findByLabelText("Open settings"));

    expect(screen.getByRole("heading", { name: "Settings" })).toBeDefined();
    expect(screen.getByRole("main", { name: "Settings" })).toBeDefined();
    expect(screen.getByText("Workspace")).toBeDefined();
    expect(screen.getByText("Harness")).toBeDefined();
    expect(screen.queryByLabelText("Prompt")).toBeNull();

    fireEvent.click(screen.getByLabelText("Back to threads"));

    expect(await screen.findByLabelText("Prompt")).toBeDefined();
  });

  it("renders composer tools without a voice control", async () => {
    render(<MobileShell />);

    const promptInput = await screen.findByLabelText("Prompt");
    const toolsBar = screen.getByRole("toolbar", { name: "Composer tools" });
    const stopButton = screen.getByRole("button", { name: "Stop run" });
    const fastButton = screen.getByRole("button", { name: "Fast mode" });
    const previewButton = screen.getByRole("button", { name: "Preview" });

    expect(toolsBar.closest(".lh-mobile-composer-footer")?.firstElementChild).toBe(toolsBar);
    expect(toolsBar.compareDocumentPosition(promptInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(Array.from(toolsBar.querySelectorAll("button")).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Stop run",
      "Fast mode",
      "Preview",
    ]);
    expect(stopButton.textContent).toBe("Stop");
    expect(fastButton.textContent).toBe("Fast");
    expect(fastButton.getAttribute("aria-pressed")).toBe("true");
    expect(previewButton.classList.contains("lh-mobile-tool-button-preview")).toBe(true);
    expect(previewButton.querySelector("svg")).not.toBeNull();
  });

  it("persists Fast mode and profile changes on the active thread", async () => {
    render(<MobileShell />);

    const fastButton = await screen.findByRole("button", { name: "Fast mode" });
    expect(fastButton.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(fastButton);
    await waitFor(() => {
      expect(api.updateThreadSettings).toHaveBeenCalledWith("thread-running", { fastMode: false });
    });

    fireEvent.click(screen.getByLabelText("Thread menu for LiteHarness"));
    const menu = screen.getByRole("dialog", { name: "LiteHarness thread options" });
    fireEvent.click(within(menu).getByRole("button", { name: "Power profile" }));

    await waitFor(() => {
      expect(api.updateThreadSettings).toHaveBeenCalledWith("thread-running", { profileId: "power" });
    });
    expect(screen.getByRole("button", { name: "Fast mode" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("uses the thread's persistent default Fast mode for new runs", async () => {
    const idleThread = thread({ id: "thread-idle", status: "idle", title: "LiteHarness" });
    api.fetchThreads.mockResolvedValueOnce([idleThread]);
    api.fetchThreadState.mockResolvedValue({
      serverTime: "2026-05-12T00:00:00.000Z",
      thread: idleThread,
      timeline: [],
    });
    api.createRun.mockResolvedValueOnce(run({
      id: "run-fast",
      prompt: "Use fast mode",
      status: "running",
      threadId: "thread-idle",
    }));
    render(<MobileShell />);

    const promptInput = await screen.findByLabelText("Prompt") as HTMLTextAreaElement;
    expect(screen.getByRole("button", { name: "Fast mode" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(promptInput, {
      target: { value: "Use fast mode" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(api.createRun).toHaveBeenCalledWith("thread-idle", "Use fast mode");
    });
  });

  it("disables the fast toggle when the active Harness does not support fast mode", async () => {
    api.fetchHarnesses.mockResolvedValueOnce([
      {
        capabilities: { approvals: false, fastMode: false, resume: true, streaming: true, userInput: true },
        label: "Codex",
        type: "codex",
      },
    ]);
    render(<MobileShell />);

    const fastButton = await screen.findByRole("button", { name: "Fast mode" });

    expect((fastButton as HTMLButtonElement).disabled).toBe(true);
    expect(fastButton.getAttribute("aria-pressed")).toBe("false");
  });

  it("opens the project preview picker from the composer", async () => {
    api.listWiredPreviews.mockResolvedValueOnce([
      wiredPreview({ id: "preview-1", name: "LiteHarness Preview" }),
    ]);
    render(<MobileShell />);

    fireEvent.click(await screen.findByRole("button", { name: "Preview" }));

    expect(await screen.findByRole("dialog", { name: "App preview" })).toBeDefined();
    expect(await screen.findByText("LiteHarness Preview")).toBeDefined();
    expect(api.listWiredPreviews).toHaveBeenCalled();
    expect(api.listPreviewManifests).toHaveBeenCalledWith("pending");
  });

  it('leaves Escape to an open native dialog even if its focused button disappeared', async () => {
    render(<MobileShell />);
    expect(await screen.findByText('Working')).toBeDefined();
    const dialog = document.createElement('dialog');
    dialog.open = true;
    document.body.append(dialog);
    try {
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      window.dispatchEvent(escape);
      expect(escape.defaultPrevented).toBe(false);
      expect(api.cancelRun).not.toHaveBeenCalled();
    } finally { dialog.remove(); }
  });

  it("cancels the active run when Escape is pressed", async () => {
    api.fetchThreadState.mockResolvedValue({
      serverTime: "2026-05-12T00:00:00.000Z",
      thread: thread({ id: "thread-running", status: "idle", title: "LiteHarness" }),
      timeline: [
        timelineEvent("event-canceled", {
          payload: { liteharnessType: "lifecycle", text: "Run canceled." },
          type: "run.canceled",
        }),
      ],
    });
    render(<MobileShell />);

    expect(await screen.findByText("Working")).toBeDefined();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(api.cancelRun).toHaveBeenCalledWith("thread-running");
    });
    await waitFor(() => {
      expect(screen.queryByText("Working")).toBeNull();
    });
  });

  it("does not let a completed child event mark the Main thread idle", async () => {
    render(<MobileShell />);
    expect(await screen.findByText("Working")).toBeDefined();
    await waitFor(() => expect(api.timelineListener).not.toBeNull());

    act(() => {
      api.timelineListener?.(timelineEvent("child-complete", {
        payload: {
          agentThreadId: "child-thread",
          liteharnessType: "lifecycle",
          text: "Child completed",
        },
        type: "run.completed",
      }));
    });

    expect(screen.getByText("Working")).toBeDefined();
  });

  it("keeps the composer active during a running run and sends steering input", async () => {
    const steerEvent = timelineEvent("event-steered", {
      payload: {
        liteharnessType: "user-prompt",
        text: "Keep the patch smaller",
      },
      type: "run.steered",
    });
    api.sendRunInput.mockResolvedValueOnce({ event: steerEvent, ok: true });
    api.fetchThreadState.mockResolvedValueOnce({
      serverTime: "2026-05-12T00:00:00.000Z",
      thread: thread({ id: "thread-running", status: "running", title: "LiteHarness" }),
      timeline: [steerEvent],
    });
    render(<MobileShell />);

    const promptInput = await screen.findByLabelText("Prompt") as HTMLTextAreaElement;
    expect(promptInput.disabled).toBe(false);
    expect(promptInput.placeholder).toBe("Steer Codex");

    fireEvent.change(promptInput, {
      target: { value: "Keep the patch smaller" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));

    await waitFor(() => {
      expect(api.sendRunInput).toHaveBeenCalledWith("thread-running", "Keep the patch smaller");
    });
    expect(api.createRun).not.toHaveBeenCalled();
    expect(await screen.findByText("Keep the patch smaller")).toBeDefined();
  });

  it("renders steering input before the active input request finishes", async () => {
    const pendingInput = deferred<{ event: TimelineEventRecord | null; ok: true }>();
    api.sendRunInput.mockReturnValueOnce(pendingInput.promise);
    render(<MobileShell />);

    const promptInput = await screen.findByLabelText("Prompt") as HTMLTextAreaElement;
    fireEvent.change(promptInput, {
      target: { value: "Render this immediately" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));

    expect(screen.getByText("Render this immediately")).toBeDefined();

    pendingInput.resolve({ event: null, ok: true });
    await waitFor(() => {
      expect(api.sendRunInput).toHaveBeenCalledWith("thread-running", "Render this immediately");
    });
  });

  it("renders the working note while a steering input is optimistic", async () => {
    const pendingInput = deferred<{ event: TimelineEventRecord | null; ok: true }>();
    api.fetchThreads.mockResolvedValueOnce([
      thread({ id: "thread-running", status: "needs_input", title: "LiteHarness" }),
    ]);
    api.fetchThreadState.mockResolvedValue({
      serverTime: "2026-05-12T00:00:00.000Z",
      thread: thread({ id: "thread-running", status: "needs_input", title: "LiteHarness" }),
      timeline: [],
    });
    api.sendRunInput.mockReturnValueOnce(pendingInput.promise);
    render(<MobileShell />);

    const promptInput = await screen.findByLabelText("Prompt") as HTMLTextAreaElement;
    expect(screen.queryByText("Working")).toBeNull();

    fireEvent.change(promptInput, {
      target: { value: "Proceed with the selected option" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));

    expect(screen.getByText("Proceed with the selected option")).toBeDefined();
    expect(screen.getByText("Working")).toBeDefined();

    pendingInput.resolve({ event: null, ok: true });
    await waitFor(() => {
      expect(api.sendRunInput).toHaveBeenCalledWith("thread-running", "Proceed with the selected option");
    });
  });

  it("renders repeated steering input even when the same text already exists", async () => {
    const pendingInput = deferred<{ event: TimelineEventRecord | null; ok: true }>();
    api.fetchTimeline.mockResolvedValueOnce([
      timelineEvent("event-existing", {
        payload: {
          liteharnessType: "user-prompt",
          text: "Continue",
        },
        type: "run.steered",
      }),
    ]);
    api.sendRunInput.mockReturnValueOnce(pendingInput.promise);
    render(<MobileShell />);

    expect(await screen.findByText("Continue")).toBeDefined();

    const promptInput = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
    fireEvent.change(promptInput, {
      target: { value: "Continue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));

    expect(screen.getAllByText("Continue")).toHaveLength(2);

    pendingInput.resolve({ event: null, ok: true });
    await waitFor(() => {
      expect(api.sendRunInput).toHaveBeenCalledWith("thread-running", "Continue");
    });
  });

  it("keeps composer drafts isolated per thread while another thread is steered", async () => {
    const pendingInput = deferred<{ event: TimelineEventRecord | null; ok: true }>();
    api.fetchThreads.mockResolvedValueOnce([
      thread({ id: "thread-running", status: "running", title: "Running" }),
      thread({ id: "thread-idle", status: "idle", title: "Draft" }),
    ]);
    api.fetchThreadState.mockImplementation(async (threadId: string) => ({
      serverTime: "2026-05-12T00:00:00.000Z",
      thread: thread({
        id: threadId,
        status: threadId === "thread-running" ? "running" : "idle",
        title: threadId === "thread-running" ? "Running" : "Draft",
      }),
      timeline: [],
    }));
    api.sendRunInput.mockReturnValueOnce(pendingInput.promise);
    render(<MobileShell />);

    fireEvent.click(await screen.findByRole("tab", { name: "Switch to Draft" }));
    const promptInput = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
    fireEvent.change(promptInput, {
      target: { value: "Draft for idle thread" },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Switch to Running" }));
    const runningPromptInput = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
    fireEvent.change(runningPromptInput, {
      target: { value: "Nudge active run" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));

    fireEvent.click(screen.getByRole("tab", { name: "Switch to Draft" }));
    expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe("Draft for idle thread");

    pendingInput.resolve({ event: null, ok: true });
    await waitFor(() => {
      expect(api.sendRunInput).toHaveBeenCalledWith("thread-running", "Nudge active run");
    });
  });

  it("never renders another thread timeline while the selected tab is loading", async () => {
    const pendingDraftTimeline = deferred<TimelineEventRecord[]>();
    api.fetchThreads.mockResolvedValueOnce([
      thread({ id: "thread-running", status: "running", title: "Running" }),
      thread({ id: "thread-idle", status: "idle", title: "Draft" }),
    ]);
    api.fetchTimeline.mockImplementation((threadId: string) => {
      if (threadId === "thread-idle") {
        return pendingDraftTimeline.promise;
      }
      return Promise.resolve([
        timelineEvent("running-message", {
          payload: {
            liteharnessType: "assistant-message",
            text: "Running thread only",
          },
          threadId: "thread-running",
        }),
      ]);
    });
    render(<MobileShell />);

    expect(await screen.findByText("Running thread only")).toBeDefined();

    fireEvent.click(screen.getByRole("tab", { name: "Switch to Draft" }));

    expect(screen.queryByText("Running thread only")).toBeNull();

    pendingDraftTimeline.resolve([
      timelineEvent("draft-message", {
        payload: {
          liteharnessType: "assistant-message",
          text: "Draft thread only",
        },
        threadId: "thread-idle",
      }),
    ]);
    expect(await screen.findByText("Draft thread only")).toBeDefined();
  });

  it("keeps events streamed while the selected thread snapshot is loading", async () => {
    const pendingTimeline = deferred<TimelineEventRecord[]>();
    api.fetchTimeline.mockReturnValueOnce(pendingTimeline.promise);
    render(<MobileShell />);

    await waitFor(() => {
      expect(api.timelineListener).not.toBeNull();
    });
    act(() => {
      api.timelineListener?.(timelineEvent("live-message", {
        payload: {
          liteharnessType: "assistant-message",
          text: "Arrived live",
        },
        sequence: 2,
      }));
    });
    expect(await screen.findByText("Arrived live")).toBeDefined();

    pendingTimeline.resolve([
      timelineEvent("snapshot-message", {
        payload: {
          liteharnessType: "assistant-message",
          text: "Loaded from snapshot",
        },
        sequence: 1,
      }),
    ]);

    expect(await screen.findByText("Loaded from snapshot")).toBeDefined();
    expect(screen.getByText("Arrived live")).toBeDefined();
  });

  it("renders new run input before the create run request finishes", async () => {
    const idleThread = thread({ id: "thread-idle", status: "idle", title: "LiteHarness" });
    const pendingRun = deferred<RunRecord>();
    api.fetchThreads.mockResolvedValueOnce([idleThread]);
    api.fetchThreadState.mockResolvedValue({
      serverTime: "2026-05-12T00:00:00.000Z",
      thread: idleThread,
      timeline: [],
    });
    api.createRun.mockReturnValueOnce(pendingRun.promise);
    render(<MobileShell />);

    const promptInput = await screen.findByLabelText("Prompt") as HTMLTextAreaElement;
    fireEvent.change(promptInput, {
      target: { value: "Start this immediately" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(screen.getByText("Start this immediately")).toBeDefined();

    pendingRun.resolve(run({
      id: "run-new",
      prompt: "Start this immediately",
      status: "running",
      threadId: "thread-idle",
    }));
    await waitFor(() => {
      expect(api.createRun).toHaveBeenCalledWith("thread-idle", "Start this immediately");
    });
  });

  it("creates new threads from a header-tab workspace flow and then the recent list", async () => {
    const exampleWorkspace = "/workspaces/example-project";
    const pendingDiscovery = deferred<{
      explanation: string;
      title: string;
      workspacePath: string;
    }>();
    api.fetchThreads.mockResolvedValueOnce([]);
    api.discoverWorkspaceStream.mockImplementationOnce(async function* (input: { description: string }) {
      yield { text: `Searching ${input.description}`, type: "workspace.search.started" };
      yield {
        discovery: await pendingDiscovery.promise,
        text: "Found example-project",
        type: "workspace.search.found",
      };
    });
    api.createThread
      .mockResolvedValueOnce(thread({
        id: "thread-discovered",
        title: "example-project",
        workspacePath: exampleWorkspace,
      }))
      .mockResolvedValueOnce(thread({
        id: "thread-recent",
        title: "example-project",
        workspacePath: exampleWorkspace,
      }));
    render(<MobileShell />);

    fireEvent.click(await screen.findByLabelText("New tab"));
    await screen.findByLabelText("Model and settings");

    expect(api.createThread).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "New thread workspace" })).toBeNull();
    let page = within(screen.getByRole("main", { name: "New thread workspace" }));
    const header = within(document.querySelector(".lh-mobile-header") as HTMLElement);
    expect(header.getByRole("heading", { name: "New tab" })).toBeDefined();
    expect(page.getByRole("heading", { name: "Workspace" })).toBeDefined();
    expect(page.getByRole("tab", { name: "Recent" }).getAttribute("aria-selected")).toBe("true");
    expect(page.getByRole("tab", { name: "Find workspace" })).toBeDefined();
    expect(page.getByRole("button", { name: /Home/ })).toBeDefined();
    expect(screen.queryByLabelText("Prompt")).toBeNull();
    expect(screen.queryByLabelText("Workspace")).toBeNull();

    fireEvent.click(page.getByRole("tab", { name: "Find workspace" }));
    const workspaceInput = screen.getByRole("textbox", { name: "Workspace" });
    const findWorkspace = screen.getByRole("button", { name: "Find workspace" }) as HTMLButtonElement;
    expect(findWorkspace.disabled).toBe(true);
    fireEvent.change(workspaceInput, {
      target: { value: "liteharness project" },
    });
    expect(findWorkspace.disabled).toBe(false);
    fireEvent.click(findWorkspace);

    await waitFor(() => {
      expect(api.discoverWorkspaceStream).toHaveBeenCalledWith({ description: "liteharness project" }, { signal: expect.any(AbortSignal) });
    });
    expect(await screen.findByText("Searching liteharness project")).toBeDefined();
    expect(api.createThread).not.toHaveBeenCalled();
    pendingDiscovery.resolve({
      explanation: "Matched repo name",
      title: "example-project",
      workspacePath: exampleWorkspace,
    });
    expect(await screen.findByText("Matched repo name")).toBeDefined();

    page = within(screen.getByRole("main", { name: "New thread workspace" }));
    fireEvent.click(page.getByRole("button", { name: /Create thread in example-project/ }));

    await waitFor(() => {
      expect(api.createThread).toHaveBeenCalledWith({
        profileId: "default",
        fastMode: true,
        title: "example-project",
        workspacePath: exampleWorkspace,
      });
    });
    expect(screen.queryByRole("main", { name: "New thread workspace" })).toBeNull();

    cleanup();
    api.fetchThreads.mockResolvedValueOnce([]);
    render(<MobileShell />);

    fireEvent.click(await screen.findByLabelText("New tab"));
    await screen.findByLabelText("Model and settings");

    page = within(await screen.findByRole("main", { name: "New thread workspace" }));
    expect(page.getByRole("tab", { name: "Recent" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(page.getByRole("button", { name: /example-project/ }));

    await waitFor(() => {
      expect(api.createThread).toHaveBeenLastCalledWith({
        profileId: "default",
        fastMode: true,
        title: "example-project",
        workspacePath: exampleWorkspace,
      });
    });
    expect(api.discoverWorkspaceStream).toHaveBeenCalledTimes(1);
  });

  it("preserves the selected profile and Fast override when creation fails and retries", async () => {
    api.createThread.mockRejectedValueOnce(new Error("Workspace path must exist and be a directory"))
      .mockResolvedValueOnce(thread({ id: "new-power", profileId: "power", fastMode: true }));
    render(<MobileShell />);
    fireEvent.click(await screen.findByLabelText("New tab"));
    await screen.findByLabelText("Model and settings");
    const page = within(screen.getByRole("main", { name: "New thread workspace" }));
    fireEvent.click(page.getByLabelText("Model and settings"));
    fireEvent.click(page.getByRole("button", { name: "Power profile" }));
    const fast = page.getByRole("switch", { name: "Fast mode for new tab" });
    expect(fast.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(fast);
    fireEvent.click(page.getByRole("button", { name: /Home/ }));
    expect(await page.findByRole("alert")).toHaveProperty("textContent", "Workspace path must exist and be a directory");
    expect(fast.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(page.getByRole("button", { name: /Home/ }));
    await waitFor(() => expect(api.createThread).toHaveBeenCalledTimes(2));
    expect(api.createThread).toHaveBeenLastCalledWith(expect.objectContaining({ profileId: "power", fastMode: true }));
    await waitFor(() => expect(screen.queryByRole("main", { name: "New thread workspace" })).toBeNull());
  });

  it("aborts a dismissed search and ignores late results while a new search is pending", async () => {
    const oldSearch = deferred<{ explanation: string; title: string; workspacePath: string }>();
    const newSearch = deferred<{ explanation: string; title: string; workspacePath: string }>();
    for (const search of [oldSearch, newSearch]) {
      api.discoverWorkspaceStream.mockImplementationOnce(async function* () {
        yield { discovery: await search.promise, text: "Found workspace", type: "workspace.search.found" };
      });
    }
    render(<MobileShell />);
    fireEvent.click(await screen.findByLabelText("New tab"));
    await screen.findByLabelText("Model and settings");
    fireEvent.click(screen.getByRole("tab", { name: "Find workspace" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Workspace" }), { target: { value: "old" } });
    fireEvent.click(screen.getByRole("button", { name: "Find workspace" }));
    const oldSignal = api.discoverWorkspaceStream.mock.calls[0]![1].signal as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "Back to threads" }));
    expect(oldSignal.aborted).toBe(true);
    fireEvent.click(screen.getByLabelText("New tab"));
    await screen.findByLabelText("Model and settings");
    fireEvent.click(screen.getByRole("tab", { name: "Find workspace" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Workspace" }), { target: { value: "new" } });
    fireEvent.click(screen.getByRole("button", { name: "Find workspace" }));
    await act(async () => oldSearch.resolve({ title: "Old result", workspacePath: "/old", explanation: "Stale" }));
    expect(screen.queryByText("Old result")).toBeNull();
    expect(screen.getByText("Working")).toBeDefined();
    await act(async () => newSearch.resolve({ title: "New result", workspacePath: "/new", explanation: "Current" }));
    expect(await screen.findByText("New result")).toBeDefined();
    expect(screen.queryByText("Working")).toBeNull();
  });

  it("removes an idle tab immediately and restores it when close fails", async () => {
    const close = deferred<void>();
    api.fetchThreads.mockResolvedValueOnce([
      thread({ id: "thread-idle", status: "idle", title: "Idle" }),
      thread({ id: "thread-other", status: "idle", title: "Other" }),
    ]);
    api.closeThread.mockReturnValueOnce(close.promise);
    render(<MobileShell />);

    fireEvent.click(await screen.findByRole("button", { name: "Thread menu for Idle" }));
    fireEvent.click(screen.getByRole("button", { name: "Close thread" }));
    expect(screen.queryByRole("tab", { name: "Active thread Idle" })).toBeNull();
    close.reject(new Error("close failed"));
    expect(await screen.findByRole("tab", { name: "Switch to Idle" })).toBeDefined();
    expect(screen.getByText("close failed")).toBeDefined();
  });

  it("bulk-closes only idle tabs and makes them undoable", async () => {
    api.fetchThreads.mockResolvedValueOnce([
      thread({ id: "thread-running", status: "running", title: "Running" }),
      thread({ id: "thread-idle-a", status: "idle", title: "Idle A" }),
      thread({ id: "thread-idle-b", status: "idle", title: "Idle B" }),
    ]);
    api.closeThreads.mockResolvedValueOnce({ closedIds: ["thread-idle-a", "thread-idle-b"], skippedIds: [] });
    render(<MobileShell />);

    fireEvent.click(await screen.findByRole("button", { name: "Manage tabs" }));
    fireEvent.click(await screen.findByRole("button", { name: "Close idle (2)" }));
    await waitFor(() => expect(api.closeThreads).toHaveBeenCalledWith(["thread-idle-a", "thread-idle-b"]));
    expect(screen.getByRole("tab", { name: "Active thread Running" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Done managing tabs" }));
    expect(await screen.findByText("2 threads closed")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(api.reopenThread).toHaveBeenCalledWith("thread-idle-a");
      expect(api.reopenThread).toHaveBeenCalledWith("thread-idle-b");
    });
  });

  it("restores the selected tab and per-thread draft after a reload", async () => {
    api.fetchThreads.mockResolvedValue([
      thread({ id: "thread-running", status: "running", title: "Running" }),
      thread({ id: "thread-idle", status: "idle", title: "Draft" }),
    ]);
    const first = render(<MobileShell />);
    fireEvent.click(await screen.findByRole("tab", { name: "Switch to Draft" }));
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Keep this draft" } });
    first.unmount();

    render(<MobileShell />);
    expect(await screen.findByRole("tab", { name: "Active thread Draft" })).toBeDefined();
    expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe("Keep this draft");
  });

  it("dismisses a menu or keyboard with Escape before stopping a run", async () => {
    render(<MobileShell />);
    fireEvent.click(await screen.findByLabelText("Thread menu for LiteHarness"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "LiteHarness thread options" })).toBeNull();

    const prompt = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
    prompt.focus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).not.toBe(prompt);
    expect(api.cancelRun).not.toHaveBeenCalled();
  });

  it("does not submit while the IME is composing", async () => {
    api.fetchThreads.mockResolvedValueOnce([thread({ id: "thread-idle", status: "idle", title: "Idle" })]);
    render(<MobileShell />);
    const prompt = await screen.findByLabelText("Prompt");
    fireEvent.change(prompt, { target: { value: "日本語" } });
    fireEvent.keyDown(prompt, { isComposing: true, key: "Enter", keyCode: 229 });
    expect(api.createRun).not.toHaveBeenCalled();
  });

  it("shows the latest reasoning event while an open reasoning row has no active child", async () => {
    api.fetchTimeline.mockResolvedValueOnce([
      timelineEvent("event-completed", {
        payload: {
          command: "npm run check",
          exitCode: 0,
          liteharnessType: "execution",
          stableKey: "codex:item:exec-1",
          status: "completed",
        },
      }),
    ]);
    const { container } = render(<MobileShell />);

    await screen.findByText("explored 1");

    const current = container.querySelector(".lh-mobile-reasoning-current");
    expect(current?.textContent).toContain("npm run check");
    expect(current?.textContent).toContain("Completed successfully");
  });

  it("renders and submits normalized input requests", async () => {
    api.fetchThreads.mockResolvedValueOnce([
      thread({
        id: "thread-running",
        status: "needs_input",
        title: "LiteHarness",
      }),
    ]);
    api.fetchTimeline.mockResolvedValueOnce([
      timelineEvent("input-event", {
        payload: {
          inputRequestId: "input-1",
          liteharnessType: "input",
          questions: [{
            allowOther: true,
            header: "Mode",
            id: "mode",
            isSecret: false,
            options: [
              { description: "Keep changes small", label: "Small" },
              { description: "Allow broader cleanup", label: "Broad" },
            ],
            question: "How should Codex proceed?",
          }],
          text: "Choose a mode",
        },
        type: "input.requested",
      }),
    ]);
    render(<MobileShell />);

    expect(await screen.findByText("How should Codex proceed?")).toBeDefined();
    expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).disabled).toBe(false);

    fireEvent.click(screen.getByLabelText("Small"));
    fireEvent.click(screen.getByRole("button", { name: "Send input" }));

    await waitFor(() => {
      expect(api.respondToInput).toHaveBeenCalledWith("thread-running", "input-1", { mode: ["Small"] });
    });
  });

  it.each([["Yes", true], ["No", false]])("renders and submits an approval decision: %s", async (label, approved) => {
    api.fetchThreads.mockResolvedValueOnce([
      thread({
        id: "thread-running",
        status: "needs_approval",
        title: "LiteHarness",
      }),
    ]);
    api.fetchTimeline.mockResolvedValueOnce([
      timelineEvent("approval-event", {
        payload: {
          approvalId: "approval-1",
          connectorName: "Gmail",
          liteharnessType: "approval",
          text: "Allow Gmail to send this email?",
          toolTitle: "Send email",
        },
        type: "approval.requested",
      }),
    ]);
    render(<MobileShell />);

    expect(await screen.findByText("Allow Gmail to send this email?")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: label }));

    await waitFor(() => {
      expect(api.respondToApproval).toHaveBeenCalledWith("thread-running", "approval-1", approved);
    });
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

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    completedAt: null,
    createdAt: "2026-05-12T00:00:00.000Z",
    id: "run-1",
    prompt: "Run Codex",
    startedAt: null,
    status: "queued",
    threadId: "thread-1",
    ...overrides,
  };
}

function wiredPreview(overrides: Partial<import("../api").WiredPreview> = {}): import("../api").WiredPreview {
  return {
    commands: [],
    createdAt: "2026-05-12T00:00:00.000Z",
    dependencyServices: [],
    id: "preview-1",
    name: "Preview",
    projectDirectory: "/workspaces/control-plane",
    publishedOrigins: [],
    requestedPublishedOrigins: [],
    target: { name: "App", url: "https://liteharness.example/" },
    updatedAt: "2026-05-12T00:00:00.000Z",
    wiringThreadId: null,
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function flushMobileShell() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
