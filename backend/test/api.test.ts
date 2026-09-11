import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore, type LiteHarnessStore } from "../src/db/store.js";
import { createThreadCompactor } from "../src/compaction/threadCompactor.js";
import { createTimelineHub } from "../src/events/timelineHub.js";
import type { HarnessAdapter, RunHarnessInput } from "../src/harnesses/types.js";
import { createCodexAdapter, codexRunThreadOptions } from "../src/harnesses/codex/codexAdapter.js";
import { registerApiRoutes } from "../src/routes/api.js";
import type { EventTranscriber } from "../src/transcription/eventTranscriber.js";
import type { PreviewPublishedOrigin, ThreadRecord, TimelineEventRecord, WiredPreview } from "../src/types.js";

let cleanupPaths: string[] = [];
let store: LiteHarnessStore | null = null;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  store?.close();
  store = null;
  for (const cleanupPath of cleanupPaths) {
    rmSync(cleanupPath, { recursive: true, force: true });
  }
  cleanupPaths = [];
});

function makeStore(): LiteHarnessStore {
  const storePath = makeTempDir("liteharness-api-");
  store = createStore(join(storePath, "liteharness.sqlite"));
  return store;
}

describe("API routes", () => {
  it("uploads exact bytes, scopes attachments to their device/thread, and sends durable metadata with a Run", async () => {
    const currentStore = makeStore();
    let captured: RunHarnessInput | null = null;
    const app = Fastify();
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", makeAdapter({ async *run(input) { captured = input; yield { type: "run.completed", text: "done" }; } })]]),
      hub: createTimelineHub(), store: currentStore, transcriber: passthroughTranscriber,
    });
    try {
      const headers = { "x-liteharness-device-id": "upload-owner" };
      const thread = (await app.inject({ method: "POST", url: "/api/threads", headers, payload: { workspacePath: makeTempDir("upload-workspace-") } })).json();
      const url = `/api/threads/${thread.id}/attachments`;
      const bytes = Buffer.from("a,b\n1,2\n");
      const upload = await app.inject({ method: "POST", url: `${url}?name=report.csv`, headers: { ...headers, "content-type": "application/octet-stream" }, payload: bytes });
      expect(upload.statusCode).toBe(201);
      const attachment = upload.json();
      expect(attachment).toMatchObject({ name: "report.csv", size: bytes.length });
      expect(attachment).not.toHaveProperty("path");
      const download = await app.inject({ method: "GET", url: `${url}/${attachment.id}`, headers });
      expect(download.rawPayload).toEqual(bytes);
      expect((await app.inject({ method: "GET", url: `${url}/${attachment.id}`, headers: { "x-liteharness-device-id": "someone-else" } })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `/api/threads/${thread.id}/runs`, headers, payload: { prompt: "Read this", attachmentIds: ["../bad"] } })).statusCode).toBe(400);
      const otherThread = (await app.inject({ method: "POST", url: "/api/threads", headers, payload: { workspacePath: makeTempDir("other-upload-workspace-") } })).json();
      expect((await app.inject({ method: "POST", url: `/api/threads/${otherThread.id}/runs`, headers, payload: { prompt: "Read", attachmentIds: [attachment.id] } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: `${url}?name=too-big.bin`, headers: { ...headers, "content-type": "application/octet-stream" }, payload: Buffer.alloc(20 * 1024 * 1024 + 1) })).statusCode).toBe(413);
      expect((await app.inject({ method: "POST", url: `/api/threads/${thread.id}/runs`, headers, payload: { prompt: "Read", attachmentIds: Array(11).fill(attachment.id) } })).statusCode).toBe(400);
      const run = await app.inject({ method: "POST", url: `/api/threads/${thread.id}/runs`, headers, payload: { prompt: "", attachmentIds: [attachment.id] } });
      expect(run.statusCode).toBe(202);
      await eventually(() => expect(captured).not.toBeNull());
      expect(captured).toMatchObject({ attachments: [{ ...attachment, path: expect.any(String) }] });
      const timeline = (await app.inject({ method: "GET", url: `/api/threads/${thread.id}/timeline`, headers })).json();
      expect(timeline.find((event: TimelineEventRecord) => event.type === "run.submitted").payload.attachments).toEqual([attachment]);
    } finally { await app.close(); }
  });

  it("accepts a retired Astra selection as Balance with its Fast preference", async () => {
    const currentStore = makeStore();
    const app = Fastify();
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", makeAdapter()]]), hub: createTimelineHub(), store: currentStore,
      transcriber: passthroughTranscriber,
    });
    try {
      const response = await app.inject({ method: "POST", url: "/api/threads", payload: {
        workspacePath: makeTempDir("liteharness-astra-"), profileId: "astra", fastMode: false,
      } });
      expect(response.statusCode).toBe(201);
      expect(currentStore.getThread(response.json().id)).toMatchObject({ profileId: "default", fastMode: false });
    } finally { await app.close(); }
  });

  it.each([
    { model: "gpt-6-astra", effort: "xhigh", specificModel: "", specificEffort: "" },
    { model: "gpt-6-astra", effort: "xhigh", specificModel: "gpt-5.6-sol", specificEffort: "high" },
    { model: "", effort: "invalid", specificModel: "", specificEffort: "invalid" },
  ])("publishes the model and effort actually used for each profile: $specificModel/$model", async ({ model, effort, specificModel, specificEffort }) => {
    vi.stubEnv("LITEHARNESS_MODEL", model);
    vi.stubEnv("LITEHARNESS_MODEL_REASONING_EFFORT", effort);
    vi.stubEnv("LITEHARNESS_CODEX_MODEL", specificModel);
    vi.stubEnv("LITEHARNESS_CODEX_REASONING_EFFORT", specificEffort);
    const app = Fastify();
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", createCodexAdapter()]]),
      hub: createTimelineHub(), store: makeStore(), transcriber: passthroughTranscriber,
    });
    try {
      const response = await app.inject({ method: "GET", url: "/api/config" });
      expect(response.statusCode).toBe(200);
      for (const profile of response.json().profiles) {
        const run = codexRunThreadOptions("/tmp", profile.id);
        expect(profile.model).toBe(run.model);
        expect(profile.reasoningEffort).toBe(run.modelReasoningEffort);
        expect(profile.fastMode).toBe(run.fastMode);
        expect(profile).not.toHaveProperty("developerInstructions");
      }
    } finally {
      await app.close();
    }
  });

  it("does not expose Voice Partner routes", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const app = Fastify();
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", makeAdapter()]]),
      hub: createTimelineHub(),
      store: makeStore(),
      transcriber: passthroughTranscriber,
    });
    const threadResponse = await app.inject({
      method: "POST",
      payload: { workspacePath },
      url: "/api/threads",
    });
    const thread = threadResponse.json() as ThreadRecord;

    const response = await app.inject({
      method: "POST",
      payload: { offerSdp: "v=0\r\n" },
      url: `/api/threads/${thread.id}/voice/session`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      message: expect.stringContaining("Route POST:"),
    });
    await app.close();
  });

  it("publishes only Balance, Speed, and Power with main and subagent settings", async () => {
    const app = Fastify();
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", createCodexAdapter()]]), hub: createTimelineHub(),
      store: makeStore(), transcriber: passthroughTranscriber,
    });
    try {
      const response = await app.inject({ method: "GET", url: "/api/config" });
      expect(response.statusCode).toBe(200);
      const config = response.json();
      expect(config.defaultProfileId).toBe("default");
      expect(config.profiles.map((profile: { label: string }) => profile.label)).toEqual(["Balance", "Speed", "Power"]);
      expect(config.profiles).toMatchObject([
        { id: "default", model: "gpt-6-astra", reasoningEffort: "high", subagentModel: "gpt-6-astra", subagentReasoningEffort: "high" },
        { id: "speed", model: "gpt-6-astra", reasoningEffort: "medium", subagentModel: "gpt-6-astra", subagentReasoningEffort: "low" },
        { id: "power", model: "gpt-6-astra", reasoningEffort: "max", subagentModel: "gpt-6-astra", subagentReasoningEffort: "xhigh" },
      ]);
    } finally { await app.close(); }
  });

  it("runs new threads with the persistent Balance default profile and Fast mode", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const currentStore = makeStore();
    let capturedRunInput: RunHarnessInput | null = null;
    const startThread = vi.fn(async () => ({ harnessThreadId: "empty-codex-thread" }));
    const app = Fastify();
    const adapter = makeAdapter({
      capabilities: { approvals: false, fastMode: true, resume: true, streaming: true, userInput: false },
      startThread,
      async *run(input) {
        capturedRunInput = input;
        yield {
          payload: { harnessThreadId: "codex-thread-1", liteharnessType: "lifecycle" },
          text: "started",
          type: "thread.started",
        };
        yield { text: "complete", type: "run.completed" };
      },
    });
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", adapter]]),
      hub: createTimelineHub(),
      store: currentStore,
      transcriber: passthroughTranscriber,
    });

    const threadResponse = await app.inject({
      method: "POST",
      payload: { workspacePath },
      url: "/api/threads",
    });
    const thread = threadResponse.json() as ThreadRecord;
    await app.inject({
      method: "POST",
      payload: { prompt: "Ship it" },
      url: `/api/threads/${thread.id}/runs`,
    });

    expect(thread).toMatchObject({
      fastMode: true,
      harnessThreadId: null,
      profileId: "default",
    });
    expect(startThread).not.toHaveBeenCalled();
    await eventually(() => {
      expect(capturedRunInput).not.toBeNull();
    });
    expect(requireCapturedRunInput(capturedRunInput)).toMatchObject({
      fastMode: true,
      harnessThreadId: null,
      profileId: "default",
    });
    await eventually(() => {
      expect(currentStore.getThread(thread.id)?.harnessThreadId).toBe("codex-thread-1");
    });
    await app.close();
  });

  it("resets stale Codex thread ids after no-rollout failures", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const currentStore = makeStore();
    let capturedRunInput: RunHarnessInput | null = null;
    const app = Fastify();
    const adapter = makeAdapter({
      async *run(input) {
        capturedRunInput = input;
        yield {
          payload: { harnessThreadId: "new-codex-thread", liteharnessType: "lifecycle" },
          text: "started",
          type: "thread.started",
        };
        yield { text: "complete", type: "run.completed" };
      },
    });
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", adapter]]),
      hub: createTimelineHub(),
      store: currentStore,
      transcriber: passthroughTranscriber,
    });
    const thread = currentStore.createThread({
      deviceId: "liteharness-default-device",
      harnessThreadId: "missing-codex-thread",
      harnessType: "codex",
      title: "stale",
      workspacePath,
    });
    const failedRun = currentStore.createRun({ prompt: "failed", threadId: thread.id });
    currentStore.recordTimelineEvent({
      payload: { liteharnessType: "error", text: "no rollout found for thread id missing-codex-thread" },
      runId: failedRun.id,
      threadId: thread.id,
      type: "run.failed",
    });
    currentStore.updateRunStatus(failedRun.id, "failed");
    currentStore.updateThread({ id: thread.id, status: "failed" });

    const runResponse = await app.inject({
      method: "POST",
      payload: { prompt: "Try again" },
      url: `/api/threads/${thread.id}/runs`,
    });

    expect(runResponse.statusCode).toBe(202);
    await eventually(() => {
      expect(capturedRunInput).not.toBeNull();
    });
    expect(requireCapturedRunInput(capturedRunInput).harnessThreadId).toBeNull();
    await eventually(() => {
      expect(currentStore.getThread(thread.id)?.harnessThreadId).toBe("new-codex-thread");
    });
    await app.close();
  });

  it("persists profile and Fast changes for an existing thread", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const app = Fastify();
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", makeAdapter()]]),
      hub: createTimelineHub(),
      store: makeStore(),
      transcriber: passthroughTranscriber,
    });
    const created = (await app.inject({
      method: "POST",
      payload: { workspacePath },
      url: "/api/threads",
    })).json() as ThreadRecord;

    const powered = await app.inject({
      method: "PATCH",
      payload: { profileId: "power" },
      url: `/api/threads/${created.id}`,
    });
    const fast = await app.inject({
      method: "PATCH",
      payload: { fastMode: true },
      url: `/api/threads/${created.id}`,
    });

    expect(powered.statusCode).toBe(200);
    expect(powered.json()).toMatchObject({
      fastMode: false,
      profileId: "power",
    });
    expect(fast.statusCode).toBe(200);
    expect(fast.json()).toMatchObject({
      fastMode: true,
      profileId: "power",
    });
    await app.close();
  });

  it("discovers a workspace through the selected harness", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const app = Fastify();
    const adapter = makeAdapter({
      discoverWorkspace: vi.fn().mockResolvedValue({
        explanation: "Matched repo name",
        title: "liteharness",
        workspacePath,
      }),
    });
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", adapter]]),
      hub: createTimelineHub(),
      store: makeStore(),
      transcriber: passthroughTranscriber,
    });

    const response = await app.inject({
      method: "POST",
      payload: { description: "liteharness project" },
      url: "/api/workspaces/discover",
    });

    expect(response.statusCode).toBe(200);
    expect(adapter.discoverWorkspace).toHaveBeenCalledWith({
      defaultWorkspacePath: expect.any(String),
      description: "liteharness project",
    });
    expect(response.json()).toEqual({
      explanation: "Matched repo name",
      title: "liteharness",
      workspacePath,
    });
    await app.close();
  });

  it("streams workspace discovery progress and result", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const app = Fastify();
    const adapter = makeAdapter({
      discoverWorkspace: vi.fn().mockResolvedValue({
        explanation: "Matched repo name",
        title: "liteharness",
        workspacePath,
      }),
    });
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", adapter]]),
      hub: createTimelineHub(),
      store: makeStore(),
      transcriber: passthroughTranscriber,
    });

    const response = await app.inject({
      method: "POST",
      payload: { description: "liteharness project" },
      url: "/api/workspaces/discover/stream",
    });
    const events = response.body.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/x-ndjson");
    expect(events.map((event) => event.type)).toEqual([
      "workspace.search.started",
      "workspace.search.status",
      "workspace.search.found",
    ]);
    expect(events[2]).toMatchObject({
      discovery: {
        explanation: "Matched repo name",
        title: "liteharness",
        workspacePath,
      },
      text: "Found liteharness",
    });
    await app.close();
  });

  it("rejects empty workspace discovery descriptions", async () => {
    const app = Fastify();
    const adapter = makeAdapter({ discoverWorkspace: vi.fn() });
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", adapter]]),
      hub: createTimelineHub(),
      store: makeStore(),
      transcriber: passthroughTranscriber,
    });

    const response = await app.inject({
      method: "POST",
      payload: { description: "" },
      url: "/api/workspaces/discover",
    });

    expect(response.statusCode).toBe(400);
    expect(adapter.discoverWorkspace).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns unique thread titles when the requested title already exists", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const app = Fastify();
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", makeAdapter()]]),
      hub: createTimelineHub(),
      store: makeStore(),
      transcriber: passthroughTranscriber,
    });

    const firstResponse = await app.inject({
      method: "POST",
      payload: { title: "Opencozy", workspacePath },
      url: "/api/threads",
    });
    const secondResponse = await app.inject({
      method: "POST",
      payload: { title: "Opencozy", workspacePath },
      url: "/api/threads",
    });
    const first = firstResponse.json() as ThreadRecord;
    const second = secondResponse.json() as ThreadRecord;
    const renameResponse = await app.inject({
      method: "PATCH",
      payload: { title: "Opencozy" },
      url: `/api/threads/${second.id}`,
    });

    expect(firstResponse.statusCode).toBe(201);
    expect(secondResponse.statusCode).toBe(201);
    expect(renameResponse.statusCode).toBe(200);
    expect(first.title).toBe("Opencozy");
    expect(second.title).toBe("Opencozy 2");
    expect((renameResponse.json() as ThreadRecord).title).toBe("Opencozy 2");
    await app.close();
  });

  it("shows threads only to the device that created them", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const app = Fastify();
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", makeAdapter()]]),
      hub: createTimelineHub(),
      store: makeStore(),
      transcriber: passthroughTranscriber,
    });

    const firstResponse = await app.inject({
      headers: { "x-liteharness-device-id": "device-a" },
      method: "POST",
      payload: { title: "Opencozy", workspacePath },
      url: "/api/threads",
    });
    const secondResponse = await app.inject({
      headers: { "x-liteharness-device-id": "device-b" },
      method: "POST",
      payload: { title: "Opencozy", workspacePath },
      url: "/api/threads",
    });
    const first = firstResponse.json() as ThreadRecord;
    const second = secondResponse.json() as ThreadRecord;

    const firstListResponse = await app.inject({
      headers: { "x-liteharness-device-id": "device-a" },
      method: "GET",
      url: "/api/threads",
    });
    const secondListResponse = await app.inject({
      headers: { "x-liteharness-device-id": "device-b" },
      method: "GET",
      url: "/api/threads",
    });
    const otherDeviceStateResponse = await app.inject({
      headers: { "x-liteharness-device-id": "device-b" },
      method: "GET",
      url: `/api/threads/${first.id}/state`,
    });
    const otherDeviceRunResponse = await app.inject({
      headers: { "x-liteharness-device-id": "device-b" },
      method: "POST",
      payload: { prompt: "Wrong device" },
      url: `/api/threads/${first.id}/runs`,
    });

    expect(firstResponse.statusCode).toBe(201);
    expect(secondResponse.statusCode).toBe(201);
    expect(first.title).toBe("Opencozy");
    expect(second.title).toBe("Opencozy");
    expect((firstListResponse.json() as ThreadRecord[]).map((thread) => thread.id)).toEqual([first.id]);
    expect((secondListResponse.json() as ThreadRecord[]).map((thread) => thread.id)).toEqual([second.id]);
    expect(otherDeviceStateResponse.statusCode).toBe(404);
    expect(otherDeviceRunResponse.statusCode).toBe(404);
    await app.close();
  });

  it("approves a preview manifest and attaches the Wired Preview to a thread", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const app = Fastify();
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", makeAdapter()]]),
      hub: createTimelineHub(),
      previewConfig: testPreviewConfig(),
      store: makeStore(),
      transcriber: passthroughTranscriber,
    });

    const threadResponse = await app.inject({
      method: "POST",
      payload: { workspacePath },
      url: "/api/threads",
    });
    const thread = threadResponse.json() as ThreadRecord;
    const manifestResponse = await app.inject({
      method: "POST",
      payload: {
        commands: [{ command: "npm run dev", cwd: workspacePath, label: "Start app" }],
        dependencyServices: [],
        name: "Opencozy Preview",
        projectDirectory: workspacePath,
        requestedPublishedOrigins: [{ name: "App", url: "http://127.0.0.1:5173/" }],
        target: { name: "App", url: "127.0.0.1:5173" },
        wiringThreadId: thread.id,
      },
      url: "/api/preview-manifests",
    });
    const manifest = manifestResponse.json() as { id: string; status: string; target: { url: string } };
    const approvalResponse = await app.inject({
      method: "PUT",
      payload: { name: "Mobile Preview" },
      url: `/api/preview-manifests/${manifest.id}/approve`,
    });
    const approval = approvalResponse.json() as { wiredPreview: WiredPreview };
    const attachResponse = await app.inject({
      method: "PUT",
      payload: { wiredPreviewId: approval.wiredPreview.id },
      url: `/api/threads/${thread.id}/wired-preview`,
    });
    const attachedThread = attachResponse.json() as ThreadRecord;

    expect(manifestResponse.statusCode).toBe(201);
    expect(manifest.status).toBe("pending");
    expect(manifest.target.url).toBe("http://127.0.0.1:5173/");
    expect(approvalResponse.statusCode).toBe(200);
    expect(approval.wiredPreview.name).toBe("Mobile Preview");
    expect(approval.wiredPreview.wiringThreadId).toBe(thread.id);
    expect(attachedThread.wiredPreviewId).toBe(approval.wiredPreview.id);

    await app.close();
  });

  it("launches a visible preview wiring thread through the Harness adapter", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    let capturedRunInput: RunHarnessInput | null = null;
    const app = Fastify();
    const adapter = makeAdapter({
      async *run(input) {
        capturedRunInput = input;
        yield { text: "complete", type: "run.completed" };
      },
    });
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", adapter]]),
      hub: createTimelineHub(),
      previewConfig: testPreviewConfig(),
      store: makeStore(),
      transcriber: passthroughTranscriber,
    });

    const sourceThreadResponse = await app.inject({
      method: "POST",
      payload: { title: "Source", workspacePath },
      url: "/api/threads",
    });
    const sourceThread = sourceThreadResponse.json() as ThreadRecord;
    const launchResponse = await app.inject({
      method: "POST",
      payload: { projectSearchBrief: "liteharness app", sourceThreadId: sourceThread.id },
      url: "/api/preview-wiring-threads",
    });
    const launch = launchResponse.json() as { prompt: string; thread: ThreadRecord };

    expect(launchResponse.statusCode).toBe(201);
    expect(launch.thread.title).toBe("Wire Preview");
    expect(launch.thread.workspacePath).toBe(workspacePath);
    expect(launch.prompt).toContain("Project Preview wiring instructions");
    await eventually(() => {
      expect(capturedRunInput).not.toBeNull();
    });
    const runInput = requireCapturedRunInput(capturedRunInput);
    expect(runInput.workspacePath).toBe(workspacePath);
    expect(runInput.prompt).toBe(launch.prompt);
    expect(runInput.harnessPrompt).toContain("Project Preview wiring instructions");
    expect(runInput.harnessPrompt).toBe(launch.prompt);

    await app.close();
  });

  it("publishes a Wired Preview target through the preview proxy publisher", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const app = Fastify();
    const publisher = {
      publishProxyTarget: vi.fn().mockResolvedValue({ ok: true, stderr: "", stdout: "" }),
      publishTarget: vi.fn(async (input: {
        httpsPort: number;
        localProxyPort: number;
        originId?: string;
        preview: WiredPreview;
      }) => {
        const timestamp = "2026-05-12T00:00:00.000Z";
        const origin: PreviewPublishedOrigin = {
          createdAt: timestamp,
          dependencyServiceIndex: null,
          dependencyServiceName: null,
          error: null,
          httpsPort: input.httpsPort,
          id: input.originId ?? "origin-1",
          localProxyPort: input.localProxyPort,
          name: input.preview.target.name,
          provider: "tailscale-serve",
          publishedUrl: `https://liteharness.test:${input.httpsPort}/`,
          source: "target",
          sourceUrl: "http://127.0.0.1:5173/",
          status: "published",
          updatedAt: timestamp,
        };
        return { ok: true, origin };
      }),
      unpublish: vi.fn().mockResolvedValue({ ok: true, stderr: "", stdout: "" }),
    };
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", makeAdapter()]]),
      hub: createTimelineHub(),
      previewConfig: testPreviewConfig(),
      previewPublisher: publisher,
      store: makeStore(),
      transcriber: passthroughTranscriber,
    });

    const createResponse = await app.inject({
      method: "POST",
      payload: {
        commands: [],
        dependencyServices: [],
        name: "Opencozy Preview",
        projectDirectory: workspacePath,
        requestedPublishedOrigins: [{ name: "App", url: "http://127.0.0.1:5173/" }],
        target: { name: "App", url: "http://127.0.0.1:5173/" },
      },
      url: "/api/wired-previews",
    });
    const preview = createResponse.json() as WiredPreview;
    const publishResponse = await app.inject({
      method: "POST",
      payload: { source: "target" },
      url: `/api/wired-previews/${preview.id}/published-origins`,
    });
    const published = publishResponse.json() as { origin: PreviewPublishedOrigin; wiredPreview: WiredPreview };

    expect(publishResponse.statusCode).toBe(201);
    expect(publisher.publishTarget).toHaveBeenCalledWith(expect.objectContaining({
      httpsPort: 9443,
      preview: expect.objectContaining({ id: preview.id }),
      source: { type: "target" },
    }));
    expect(published.origin.localProxyPort).toEqual(expect.any(Number));
    expect(published.wiredPreview.publishedOrigins[0]?.publishedUrl).toBe("https://liteharness.test:9443/");

    await app.close();
  });

  it("returns a backend-owned thread state snapshot for heartbeat recovery", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const app = Fastify();
    const adapter = makeAdapter({
      async *run() {
        yield { text: "started", type: "run.started" };
        yield {
          payload: { liteharnessType: "assistant-message" },
          text: "done",
          type: "harness.output",
        };
        yield { text: "complete", type: "run.completed" };
      },
    });
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", adapter]]),
      hub: createTimelineHub(),
      store: makeStore(),
      transcriber: passthroughTranscriber,
    });

    const threadResponse = await app.inject({
      method: "POST",
      payload: { workspacePath },
      url: "/api/threads",
    });
    const thread = threadResponse.json() as ThreadRecord;

    await app.inject({
      method: "POST",
      payload: { prompt: "finish this" },
      url: `/api/threads/${thread.id}/runs`,
    });

    await eventually(async () => {
      const stateResponse = await app.inject({
        method: "GET",
        url: `/api/threads/${thread.id}/state`,
      });
      const state = stateResponse.json() as ThreadState;

      expect(stateResponse.statusCode).toBe(200);
      expect(state.thread.status).toBe("idle");
      expect(state.serverTime).toEqual(expect.any(String));
      expect(state.timeline.map((event) => event.type)).toEqual([
        "run.submitted",
        "run.started",
        "harness.output",
        "run.completed",
      ]);
    });

    await app.close();
  });

  it("passes fast mode to the Harness adapter when the selected Harness supports it", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    let capturedRunInput: RunHarnessInput | null = null;
    const app = Fastify();
    const adapter = makeAdapter({
      capabilities: { approvals: false, fastMode: true, resume: true, streaming: true, userInput: false },
      async *run(input) {
        capturedRunInput = input;
        yield { text: "complete", type: "run.completed" };
      },
    });
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", adapter]]),
      hub: createTimelineHub(),
      store: makeStore(),
      transcriber: passthroughTranscriber,
    });

    const threadResponse = await app.inject({
      method: "POST",
      payload: { workspacePath },
      url: "/api/threads",
    });
    const thread = threadResponse.json() as ThreadRecord;
    const runResponse = await app.inject({
      method: "POST",
      payload: { fastMode: true, prompt: "finish this" },
      url: `/api/threads/${thread.id}/runs`,
    });

    expect(runResponse.statusCode).toBe(202);
    await eventually(() => {
      expect(capturedRunInput).not.toBeNull();
    });
    expect(requireCapturedRunInput(capturedRunInput).fastMode).toBe(true);

    await app.close();
  });

  it("ignores requested fast mode when the Harness does not support it", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    let capturedRunInput: RunHarnessInput | null = null;
    const app = Fastify();
    const adapter = makeAdapter({
      async *run(input) {
        capturedRunInput = input;
        yield { text: "complete", type: "run.completed" };
      },
    });
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", adapter]]),
      hub: createTimelineHub(),
      store: makeStore(),
      transcriber: passthroughTranscriber,
    });

    const threadResponse = await app.inject({
      method: "POST",
      payload: { workspacePath },
      url: "/api/threads",
    });
    const thread = threadResponse.json() as ThreadRecord;
    const runResponse = await app.inject({
      method: "POST",
      payload: { fastMode: true, prompt: "finish this" },
      url: `/api/threads/${thread.id}/runs`,
    });

    expect(runResponse.statusCode).toBe(202);
    await eventually(() => {
      expect(capturedRunInput).not.toBeNull();
    });
    expect(requireCapturedRunInput(capturedRunInput).fastMode).toBe(false);

    await app.close();
  });

  it("fails a run instead of leaving it running when the adapter throws", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const app = Fastify();
    const adapter = makeAdapter({
      async *run() {
        yield { text: "started", type: "run.started" };
        throw new Error("adapter stream broke");
      },
    });
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", adapter]]),
      hub: createTimelineHub(),
      store: makeStore(),
      transcriber: passthroughTranscriber,
    });

    const threadResponse = await app.inject({
      method: "POST",
      payload: { workspacePath },
      url: "/api/threads",
    });
    const thread = threadResponse.json() as ThreadRecord;

    const runResponse = await app.inject({
      method: "POST",
      payload: { prompt: "break" },
      url: `/api/threads/${thread.id}/runs`,
    });

    expect(runResponse.statusCode).toBe(202);
    await eventually(async () => {
      const stateResponse = await app.inject({
        method: "GET",
        url: `/api/threads/${thread.id}/state`,
      });
      const state = stateResponse.json() as ThreadState;
      const failedEvent = state.timeline.find((event) => event.type === "run.failed");

      expect(state.thread.status).toBe("failed");
      expect(failedEvent?.payload.text).toBe("adapter stream broke");
    });

    await app.close();
  });

  it("cancels the active run through a generic adapter abort signal", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const currentStore = makeStore();
    const abortSeen = deferred<void>();
    const app = Fastify();
    const adapter = makeAdapter({
      async *run(input) {
        yield { text: "started", type: "run.started" };
        if (!input.signal) {
          throw new Error("missing abort signal");
        }
        await new Promise<void>((resolve) => {
          if (input.signal?.aborted) {
            abortSeen.resolve();
            resolve();
            return;
          }
          input.signal?.addEventListener("abort", () => {
            abortSeen.resolve();
            resolve();
          }, { once: true });
        });
        yield {
          payload: { liteharnessType: "assistant-message" },
          text: "should not be recorded",
          type: "harness.output",
        };
      },
    });
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", adapter]]),
      hub: createTimelineHub(),
      store: currentStore,
      transcriber: passthroughTranscriber,
    });

    const threadResponse = await app.inject({
      method: "POST",
      payload: { workspacePath },
      url: "/api/threads",
    });
    const thread = threadResponse.json() as ThreadRecord;
    await app.inject({
      method: "POST",
      payload: { prompt: "long task" },
      url: `/api/threads/${thread.id}/runs`,
    });
    await eventually(() => {
      expect(currentStore.listTimeline(thread.id).some((event) => event.type === "run.started")).toBe(true);
    });

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/api/threads/${thread.id}/runs/cancel`,
    });

    expect(cancelResponse.statusCode).toBe(202);
    await abortSeen.promise;
    await eventually(async () => {
      const stateResponse = await app.inject({
        method: "GET",
        url: `/api/threads/${thread.id}/state`,
      });
      const state = stateResponse.json() as ThreadState;
      const activeRuns = currentStore.listActiveRuns();
      const cancelEvent = state.timeline.find((event) => event.type === "run.canceled");

      expect(state.thread.status).toBe("idle");
      expect(activeRuns).toHaveLength(0);
      expect(cancelEvent?.payload.text).toBe("Run canceled.");
      expect(state.timeline.map((event) => event.payload.text)).not.toContain("should not be recorded");
    });

    await app.close();
  });

  it("sends user input into an active run without starting a new run", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const currentStore = makeStore();
    const steerGate = deferred<void>();
    let capturedInput: { prompt: string; runId: string; threadId: string } | null = null;
    const app = Fastify();
    const adapter = makeAdapter({
      capabilities: { approvals: false, fastMode: false, resume: true, streaming: true, userInput: true },
      async *run() {
        yield { text: "started", type: "run.started" };
        await steerGate.promise;
        yield {
          payload: { liteharnessType: "assistant-message" },
          text: "I will keep the patch smaller.",
          type: "harness.output",
        };
        yield { text: "complete", type: "run.completed" };
      },
      async sendUserInput(input) {
        capturedInput = input;
        steerGate.resolve();
      },
    });
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", adapter]]),
      hub: createTimelineHub(),
      store: currentStore,
      transcriber: passthroughTranscriber,
    });

    const threadResponse = await app.inject({
      method: "POST",
      payload: { workspacePath },
      url: "/api/threads",
    });
    const thread = threadResponse.json() as ThreadRecord;
    const runResponse = await app.inject({
      method: "POST",
      payload: { prompt: "Build the feature" },
      url: `/api/threads/${thread.id}/runs`,
    });
    const run = runResponse.json() as { id: string };

    await eventually(() => {
      expect(currentStore.listTimeline(thread.id).some((event) => event.type === "run.started")).toBe(true);
    });

    const inputResponse = await app.inject({
      method: "POST",
      payload: { prompt: "Keep the patch smaller." },
      url: `/api/threads/${thread.id}/runs/input`,
    });

    expect(inputResponse.statusCode).toBe(202);
    expect(capturedInput).toEqual({
      prompt: "Keep the patch smaller.",
      runId: run.id,
      threadId: thread.id,
    });
    await eventually(async () => {
      const stateResponse = await app.inject({
        method: "GET",
        url: `/api/threads/${thread.id}/state`,
      });
      const state = stateResponse.json() as ThreadState;
      const steerEvent = state.timeline.find((event) => event.type === "run.steered");

      expect(state.thread.status).toBe("idle");
      expect(steerEvent?.runId).toBe(run.id);
      expect(steerEvent?.payload.text).toBe("Keep the patch smaller.");
      expect(state.timeline.map((event) => event.type)).toEqual([
        "run.submitted",
        "run.started",
        "run.steered",
        "harness.output",
        "run.completed",
      ]);
    });

    await app.close();
  });

  it("keeps a newly ownerless active run during the startup grace window", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const currentStore = makeStore();
    const thread = currentStore.createThread({
      deviceId: "liteharness-default-device",
      harnessThreadId: null,
      harnessType: "codex",
      title: "Opencozy",
      workspacePath,
    });
    const run = currentStore.createRun({ prompt: "interrupted", threadId: thread.id });
    currentStore.updateRunStatus(run.id, "running");
    currentStore.updateThread({ id: thread.id, status: "running" });

    const app = Fastify();
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", makeAdapter()]]),
      hub: createTimelineHub(),
      store: currentStore,
      transcriber: passthroughTranscriber,
    });

    const stateResponse = await app.inject({
      method: "GET",
      url: `/api/threads/${thread.id}/state`,
    });
    const state = stateResponse.json() as ThreadState;

    expect(state.thread.status).toBe("running");
    expect(state.timeline.map((event) => event.type)).not.toContain("run.failed");
    await app.close();
  });

  it("soft-releases stale ownerless active runs without publishing timeline noise", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T00:00:00.000Z"));
    const workspacePath = makeTempDir("liteharness-workspace-");
    const currentStore = makeStore();
    const thread = currentStore.createThread({
      deviceId: "liteharness-default-device",
      harnessThreadId: null,
      harnessType: "codex",
      title: "Opencozy",
      workspacePath,
    });
    const run = currentStore.createRun({ prompt: "interrupted", threadId: thread.id });
    currentStore.updateRunStatus(run.id, "running");
    currentStore.updateThread({ id: thread.id, status: "running" });

    vi.setSystemTime(new Date("2026-05-12T00:01:01.000Z"));
    const app = Fastify();
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", makeAdapter()]]),
      hub: createTimelineHub(),
      store: currentStore,
      transcriber: passthroughTranscriber,
    });

    const stateResponse = await app.inject({
      method: "GET",
      url: `/api/threads/${thread.id}/state`,
    });
    const state = stateResponse.json() as ThreadState;

    expect(state.thread.status).toBe("idle");
    expect(currentStore.getRun(run.id)?.status).toBe("failed");
    expect(state.timeline.map((event) => event.type)).not.toContain("run.failed");
    expect(state.timeline.map((event) => event.payload.text)).not.toContain("Backend lost contact with this run. Start another run to continue.");
    await app.close();
  });

  it("preserves every Thread when the backend restarts", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const currentStore = makeStore();
    const restartThread = currentStore.createThread({
      deviceId: "liteharness-default-device",
      harnessThreadId: null,
      harnessType: "codex",
      title: "Opencozy",
      workspacePath,
    });
    const otherThread = currentStore.createThread({
      deviceId: "liteharness-default-device",
      harnessThreadId: null,
      harnessType: "codex",
      title: "Home",
      workspacePath,
    });
    const restartRun = currentStore.createRun({
      prompt: "Restart the Opencozy backend",
      threadId: restartThread.id,
    });
    const otherRun = currentStore.createRun({
      prompt: "Keep working",
      threadId: otherThread.id,
    });
    currentStore.updateRunStatus(restartRun.id, "running");
    currentStore.updateRunStatus(otherRun.id, "running");
    currentStore.updateThread({ id: restartThread.id, status: "running" });
    currentStore.updateThread({ id: otherThread.id, status: "running" });

    const restartedApp = Fastify();
    await registerApiRoutes(restartedApp, {
      harnesses: new Map([["codex", makeAdapter()]]),
      hub: createTimelineHub(),
      store: currentStore,
      transcriber: passthroughTranscriber,
    });
    await restartedApp.ready();

    expect(currentStore.getThread(restartThread.id)).not.toBeNull();
    expect(currentStore.getThread(otherThread.id)).not.toBeNull();
    expect(currentStore.listThreads().map((thread) => thread.id)).toEqual(expect.arrayContaining([
      restartThread.id,
      otherThread.id,
    ]));
    expect(currentStore.getRun(restartRun.id)?.status).toBe("running");
    expect(currentStore.getRun(otherRun.id)?.status).toBe("running");
    await restartedApp.close();
  });

  it("recovers stale listed threads without releasing another device’s runs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T00:00:00.000Z"));
    const workspacePath = makeTempDir("liteharness-workspace-");
    const currentStore = makeStore();
    const firstThread = currentStore.createThread({
      deviceId: "liteharness-default-device",
      harnessThreadId: null,
      harnessType: "codex",
      title: "Opencozy",
      workspacePath,
    });
    const secondThread = currentStore.createThread({
      deviceId: "another-device",
      harnessThreadId: null,
      harnessType: "codex",
      title: "Home",
      workspacePath,
    });
    const firstRun = currentStore.createRun({ prompt: "first", threadId: firstThread.id });
    const secondRun = currentStore.createRun({ prompt: "second", threadId: secondThread.id });
    currentStore.updateRunStatus(firstRun.id, "running");
    currentStore.updateRunStatus(secondRun.id, "running");
    currentStore.updateThread({ id: firstThread.id, status: "running" });
    currentStore.updateThread({ id: secondThread.id, status: "running" });

    vi.setSystemTime(new Date("2026-05-12T00:01:01.000Z"));
    const app = Fastify();
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", makeAdapter()]]),
      hub: createTimelineHub(),
      store: currentStore,
      transcriber: passthroughTranscriber,
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/threads",
    });
    const listedThreads = listResponse.json() as ThreadRecord[];

    expect(listedThreads.map((thread) => thread.status)).toEqual(["idle"]);
    expect(currentStore.getRun(firstRun.id)?.status).toBe("failed");
    expect(currentStore.getRun(secondRun.id)?.status).toBe("running");

    const firstStateResponse = await app.inject({
      method: "GET",
      url: `/api/threads/${firstThread.id}/state`,
    });
    const firstState = firstStateResponse.json() as ThreadState;

    expect(firstState.thread.status).toBe("idle");
    expect(currentStore.getRun(firstRun.id)?.status).toBe("failed");
    expect(currentStore.getRun(secondRun.id)?.status).toBe("running");
    expect(currentStore.getThread(secondThread.id)?.status).toBe("running");
    await app.close();
  });

  it("hides legacy backend recovery status rows from timeline responses", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const currentStore = makeStore();
    const thread = currentStore.createThread({
      deviceId: "liteharness-default-device",
      harnessThreadId: null,
      harnessType: "codex",
      title: "Opencozy",
      workspacePath,
    });
    const run = currentStore.createRun({ prompt: "stale", threadId: thread.id });
    currentStore.recordTimelineEvent({
      payload: {
        liteharnessType: "lifecycle",
        stableKey: `run:${run.id}:backend-recovery`,
        text: "Backend lost contact with this run. Start another run to continue.",
      },
      runId: run.id,
      threadId: thread.id,
      type: "harness.status",
    });
    currentStore.recordTimelineEvent({
      payload: {
        liteharnessType: "lifecycle",
        text: "Visible status",
      },
      runId: run.id,
      threadId: thread.id,
      type: "harness.status",
    });

    const app = Fastify();
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", makeAdapter()]]),
      hub: createTimelineHub(),
      store: currentStore,
      transcriber: passthroughTranscriber,
    });

    const stateResponse = await app.inject({
      method: "GET",
      url: `/api/threads/${thread.id}/state`,
    });
    const state = stateResponse.json() as ThreadState;

    expect(state.timeline.map((event) => event.payload.text)).toEqual(["Visible status"]);
    await app.close();
  });

  it("does not interrupt a run owned by another live backend route instance", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const currentStore = makeStore();
    const runGate = deferred<void>();
    const appA = Fastify();
    const adapterA = makeAdapter({
      async *run() {
        yield { text: "started", type: "run.started" };
        await runGate.promise;
        yield { text: "complete", type: "run.completed" };
      },
    });
    await registerApiRoutes(appA, {
      harnesses: new Map([["codex", adapterA]]),
      hub: createTimelineHub(),
      store: currentStore,
      transcriber: passthroughTranscriber,
    });

    const threadResponse = await appA.inject({
      method: "POST",
      payload: { workspacePath },
      url: "/api/threads",
    });
    const thread = threadResponse.json() as ThreadRecord;
    const runResponse = await appA.inject({
      method: "POST",
      payload: { prompt: "long task" },
      url: `/api/threads/${thread.id}/runs`,
    });

    expect(runResponse.statusCode).toBe(202);
    await eventually(() => {
      const started = currentStore.listTimeline(thread.id).find((event) => event.type === "run.started");
      expect(started).toBeDefined();
    });

    const appB = Fastify();
    await registerApiRoutes(appB, {
      harnesses: new Map([["codex", makeAdapter()]]),
      hub: createTimelineHub(),
      store: currentStore,
      transcriber: passthroughTranscriber,
    });

    const liveStateResponse = await appB.inject({
      method: "GET",
      url: `/api/threads/${thread.id}/state`,
    });
    const liveState = liveStateResponse.json() as ThreadState;

    expect(liveState.thread.status).toBe("running");
    expect(liveState.timeline.map((event) => event.type)).not.toContain("run.failed");

    runGate.resolve();
    await eventually(async () => {
      const stateResponse = await appB.inject({
        method: "GET",
        url: `/api/threads/${thread.id}/state`,
      });
      const state = stateResponse.json() as ThreadState;
      expect(state.thread.status).toBe("idle");
      expect(state.timeline.map((event) => event.type)).toContain("run.completed");
    });

    await appB.close();
    await appA.close();
  });

  it("preserves prior history and the Harness thread when new messages exceed the compaction threshold", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const currentStore = makeStore();
    let capturedRunInput: RunHarnessInput | null = null;
    const app = Fastify();
    const adapter = makeAdapter({
      async *run(input) {
        capturedRunInput = input;
        yield { text: "complete", type: "run.completed" };
      },
    });
    await registerApiRoutes(app, {
      compactor: createThreadCompactor({
        config: {
          enabled: true,
          protectFirstEvents: 1,
          protectLastEvents: 2,
          tailTokenBudget: 0,
          thresholdTokens: 1,
        },
        runModelJson: async <T>() => {
          throw new Error("automatic compaction must stay on the deterministic hot path");
        },
        store: currentStore,
      }),
      harnesses: new Map([["codex", adapter]]),
      hub: createTimelineHub(),
      store: currentStore,
      transcriber: passthroughTranscriber,
    });

    const threadResponse = await app.inject({
      method: "POST",
      payload: { workspacePath },
      url: "/api/threads",
    });
    const thread = threadResponse.json() as ThreadRecord;
    const olderRun = currentStore.createRun({ prompt: "older prompt", threadId: thread.id });
    currentStore.recordTimelineEvent({
      payload: { liteharnessType: "user-prompt", text: "first prompt" },
      runId: olderRun.id,
      threadId: thread.id,
      type: "run.submitted",
    });
    currentStore.recordTimelineEvent({
      payload: { command: "sed -n '1,20p' backend/src/routes/api.ts", liteharnessType: "execution" },
      runId: olderRun.id,
      threadId: thread.id,
      type: "harness.status",
    });
    currentStore.recordTimelineEvent({
      payload: { liteharnessType: "assistant-message", text: "May I restart the backend now?" },
      runId: olderRun.id,
      threadId: thread.id,
      type: "harness.output",
    });
    currentStore.recordTimelineEvent({
      payload: { liteharnessType: "lifecycle", text: "Older run complete" },
      runId: olderRun.id,
      threadId: thread.id,
      type: "run.completed",
    });
    currentStore.updateRunStatus(olderRun.id, "completed");
    currentStore.updateThread({ id: thread.id, harnessThreadId: "codex-thread-1" });
    const previousTimeline = JSON.stringify(currentStore.listTimeline(thread.id));

    const runResponse = await app.inject({
      method: "POST",
      payload: { prompt: "Yes" },
      url: `/api/threads/${thread.id}/runs`,
    });

    expect(runResponse.statusCode).toBe(202);
    await eventually(() => {
      expect(capturedRunInput).not.toBeNull();
    });
    const runInput = requireCapturedRunInput(capturedRunInput);
    expect(runInput.harnessThreadId).toBe("codex-thread-1");
    expect(runInput.prompt).toBe("Yes");
    expect(runInput.harnessPrompt).toBe("Yes");

    await eventually(async () => {
      const stateResponse = await app.inject({
        method: "GET",
        url: `/api/threads/${thread.id}/state`,
      });
      const state = stateResponse.json() as ThreadState;
      const submittedEvents = state.timeline.filter((event) => event.type === "run.submitted");
      const latestSubmitted = submittedEvents.at(-1);

      expect(state.timeline.map((event) => event.type)).not.toContain("thread.compacted");
      const previousIds = new Set((JSON.parse(previousTimeline) as TimelineEventRecord[]).map(event => event.id));
      expect(JSON.stringify(state.timeline.filter(event => previousIds.has(event.id)))).toBe(previousTimeline);
      expect(latestSubmitted?.payload.text).toBe("Yes");
      expect(String(latestSubmitted?.payload.text)).not.toContain("liteharness-context-compaction");
      expect(state.thread.harnessThreadId).toBe("codex-thread-1");
      expect(state.thread.status).toBe("idle");
    });

    await app.close();
  });

  it("uses a compaction handoff only for the fresh run after a thread reset", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const currentStore = makeStore();
    const thread = currentStore.createThread({
      deviceId: "liteharness-default-device",
      harnessThreadId: "codex-thread-1",
      harnessType: "codex",
      title: "Opencozy",
      workspacePath,
    });
    const olderRun = currentStore.createRun({ prompt: "older prompt", threadId: thread.id });
    currentStore.recordTimelineEvent({
      payload: { liteharnessType: "user-prompt", text: "first prompt" },
      runId: olderRun.id,
      threadId: thread.id,
      type: "run.submitted",
    });
    currentStore.recordTimelineEvent({
      payload: { liteharnessType: "assistant-message", text: "older answer" },
      runId: olderRun.id,
      threadId: thread.id,
      type: "harness.output",
    });
    currentStore.updateRunStatus(olderRun.id, "completed");
    await createThreadCompactor({
      config: {
        enabled: true,
        protectFirstEvents: 0,
        protectLastEvents: 0,
        tailTokenBudget: 0,
        thresholdTokens: 1,
      },
      runModelJson: async <T>() => ({
        activeTask: "Continue after reset.",
        blocked: [],
        constraints: ["Keep Harness SDK details behind backend adapters."],
        criticalContext: ["Use the handoff only to seed the fresh Harness thread."],
        decisions: ["Do not resend handoff once the Harness thread has resumed."],
        done: ["Compacted prior timeline."],
        goal: "Avoid duplicated compaction handoff.",
        remainingWork: [],
        relevantFiles: [{ note: "Run dispatch", path: "backend/src/routes/api.ts" }],
      }) as T,
      store: currentStore,
    }).compactThread({ force: true, thread, trigger: "manual" });

    const capturedRunInputs: RunHarnessInput[] = [];
    const app = Fastify();
    const adapter = makeAdapter({
      async *run(input) {
        capturedRunInputs.push(input);
        if (capturedRunInputs.length === 1) {
          yield {
            payload: { harnessThreadId: "codex-thread-2", liteharnessType: "lifecycle" },
            text: "started",
            type: "thread.started",
          };
        }
        yield { text: "complete", type: "run.completed" };
      },
    });
    await registerApiRoutes(app, {
      compactor: createThreadCompactor({
        config: { enabled: false },
        store: currentStore,
      }),
      harnesses: new Map([["codex", adapter]]),
      hub: createTimelineHub(),
      store: currentStore,
      transcriber: passthroughTranscriber,
    });

    const firstResponse = await app.inject({
      method: "POST",
      payload: { prompt: "Continue" },
      url: `/api/threads/${thread.id}/runs`,
    });

    expect(firstResponse.statusCode).toBe(202);
    await eventually(async () => {
      expect(capturedRunInputs).toHaveLength(1);
      const stateResponse = await app.inject({
        method: "GET",
        url: `/api/threads/${thread.id}/state`,
      });
      const state = stateResponse.json() as ThreadState;
      expect(state.thread.harnessThreadId).toBe("codex-thread-2");
      expect(state.thread.status).toBe("idle");
    });
    const firstInput = capturedRunInputs[0];
    expect(firstInput?.harnessThreadId).toBeNull();
    expect(firstInput?.harnessPrompt).toContain("<liteharness-context-compaction>");
    expect(firstInput?.harnessPrompt).toContain("Goal: Avoid duplicated compaction handoff.");

    const secondResponse = await app.inject({
      method: "POST",
      payload: { prompt: "Next" },
      url: `/api/threads/${thread.id}/runs`,
    });

    expect(secondResponse.statusCode).toBe(202);
    await eventually(() => {
      expect(capturedRunInputs).toHaveLength(2);
    });
    const secondInput = capturedRunInputs[1];
    expect(secondInput?.harnessThreadId).toBe("codex-thread-2");
    expect(secondInput?.harnessPrompt).not.toContain("<liteharness-context-compaction>");
    expect(secondInput?.harnessPrompt).toContain("Next");

    await app.close();
  });

  it("pauses a run for approval and resumes after recording the decision", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const responseGate = deferred<void>();
    let capturedDecision: { approvalId: string; approved: boolean } | null = null;
    const app = Fastify();
    const adapter = makeAdapter({
      capabilities: { approvals: true, fastMode: false, resume: true, streaming: true, userInput: false },
      async *run() {
        yield { text: "started", type: "run.started" };
        yield {
          approvalId: "approval-1",
          payload: {
            liteharnessType: "approval",
            requestMethod: "mcpServer/elicitation/request",
          },
          text: "Allow Gmail to send this email?",
          type: "approval.requested",
        };
        await responseGate.promise;
        yield {
          payload: { liteharnessType: "assistant-message" },
          text: "Email sent",
          type: "harness.output",
        };
        yield { text: "complete", type: "run.completed" };
      },
      async respondToApproval(input) {
        capturedDecision = input;
        responseGate.resolve();
      },
    });
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", adapter]]),
      hub: createTimelineHub(),
      store: makeStore(),
      transcriber: passthroughTranscriber,
    });

    const threadResponse = await app.inject({
      method: "POST",
      payload: { workspacePath },
      url: "/api/threads",
    });
    const thread = threadResponse.json() as ThreadRecord;

    const runResponse = await app.inject({
      method: "POST",
      payload: { prompt: "Send the email" },
      url: `/api/threads/${thread.id}/runs`,
    });

    expect(runResponse.statusCode).toBe(202);
    await eventually(async () => {
      const stateResponse = await app.inject({
        method: "GET",
        url: `/api/threads/${thread.id}/state`,
      });
      const state = stateResponse.json() as ThreadState;
      const request = state.timeline.find((event) => event.type === "approval.requested");

      expect(state.thread.status).toBe("needs_approval");
      expect(request?.payload.approvalId).toBe("approval-1");
    });

    const approvalResponse = await app.inject({
      method: "POST",
      payload: { approved: true },
      url: `/api/threads/${thread.id}/approval/approval-1`,
    });

    expect(approvalResponse.statusCode).toBe(202);
    expect(capturedDecision).toEqual({
      approvalId: "approval-1",
      approved: true,
    });
    await eventually(async () => {
      const stateResponse = await app.inject({
        method: "GET",
        url: `/api/threads/${thread.id}/state`,
      });
      const state = stateResponse.json() as ThreadState;
      const response = state.timeline.find((event) => event.type === "approval.responded");

      expect(state.thread.status).toBe("idle");
      expect(response?.payload.approvalId).toBe("approval-1");
      expect(response?.payload.approved).toBe(true);
      expect(state.timeline.map((event) => event.type)).toContain("run.completed");
    });

    await app.close();
  });

  it("pauses a run for normalized harness input and resumes after the response", async () => {
    const workspacePath = makeTempDir("liteharness-workspace-");
    const responseGate = deferred<void>();
    let capturedAnswers: Record<string, string[]> | null = null;
    const app = Fastify();
    const adapter = makeAdapter({
      async *run() {
        yield { text: "started", type: "run.started" };
        yield {
          inputRequestId: "input-1",
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
          type: "input.requested",
        };
        await responseGate.promise;
        yield {
          payload: { liteharnessType: "assistant-message" },
          text: "Continuing with Small",
          type: "harness.output",
        };
        yield { text: "complete", type: "run.completed" };
      },
      async respondToInput(input) {
        capturedAnswers = input.answers;
        responseGate.resolve();
      },
    });
    await registerApiRoutes(app, {
      harnesses: new Map([["codex", adapter]]),
      hub: createTimelineHub(),
      store: makeStore(),
      transcriber: passthroughTranscriber,
    });

    const threadResponse = await app.inject({
      method: "POST",
      payload: { workspacePath },
      url: "/api/threads",
    });
    const thread = threadResponse.json() as ThreadRecord;

    const runResponse = await app.inject({
      method: "POST",
      payload: { prompt: "continue" },
      url: `/api/threads/${thread.id}/runs`,
    });

    expect(runResponse.statusCode).toBe(202);
    await eventually(async () => {
      const stateResponse = await app.inject({
        method: "GET",
        url: `/api/threads/${thread.id}/state`,
      });
      const state = stateResponse.json() as ThreadState;
      const request = state.timeline.find((event) => event.type === "input.requested");

      expect(state.thread.status).toBe("needs_input");
      expect(request?.payload.inputRequestId).toBe("input-1");
      expect(request?.payload.questions).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "mode", question: "How should Codex proceed?" }),
      ]));
    });

    const inputResponse = await app.inject({
      method: "POST",
      payload: { answers: { mode: "Small" } },
      url: `/api/threads/${thread.id}/input/input-1`,
    });

    expect(inputResponse.statusCode).toBe(202);
    expect(capturedAnswers).toEqual({ mode: ["Small"] });
    await eventually(async () => {
      const stateResponse = await app.inject({
        method: "GET",
        url: `/api/threads/${thread.id}/state`,
      });
      const state = stateResponse.json() as ThreadState;
      const response = state.timeline.find((event) => event.type === "input.responded");

      expect(state.thread.status).toBe("idle");
      expect(response?.payload.inputRequestId).toBe("input-1");
      expect(response?.payload.answers).toEqual({ mode: ["Small"] });
      expect(state.timeline.map((event) => event.type)).toContain("run.completed");
    });

    await app.close();
  });
});

type ThreadState = {
  serverTime: string;
  thread: ThreadRecord;
  timeline: TimelineEventRecord[];
};

const passthroughTranscriber: EventTranscriber = {
  transcribe(event) {
    return event;
  },
};

function makeTempDir(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  cleanupPaths.push(path);
  return path;
}

function makeAdapter(overrides: Partial<HarnessAdapter> = {}): HarnessAdapter {
  return {
    capabilities: { approvals: false, fastMode: false, resume: true, streaming: true, userInput: false },
    async discoverWorkspace() {
      throw new Error("not implemented");
    },
    label: "Codex",
    type: "codex",
    async startThread() {
      return { harnessThreadId: null };
    },
    async *run() {
      return;
    },
    async respondToApproval() {
      throw new Error("not implemented");
    },
    async respondToInput() {
      throw new Error("not implemented");
    },
    async sendUserInput() {
      throw new Error("not implemented");
    },
    ...overrides,
  };
}

function testPreviewConfig() {
  return {
    backendPort: 8787,
    previewProxyPortEnd: 0,
    previewProxyPortStart: 0,
    previewPublishPortEnd: 9443,
    previewPublishPortStart: 9443,
    tailscaleBin: "tailscale",
  };
}

function requireCapturedRunInput(input: RunHarnessInput | null): RunHarnessInput {
  if (!input) {
    throw new Error("Expected the adapter to receive run input");
  }
  return input;
}

async function eventually(assertion: () => void | Promise<void>, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await delay(10);
    }
  }
  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred<T>(): {
  promise: Promise<T>;
  reject(error: unknown): void;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}
