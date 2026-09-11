import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "../src/db/store.js";
import { createTimelineHub } from "../src/events/timelineHub.js";
import type { HarnessAdapter } from "../src/harnesses/types.js";
import { registerApiRoutes } from "../src/routes/api.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function fixture(overrides: Partial<HarnessAdapter> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "lh-reliability-"));
  const store = createStore(join(directory, "test.sqlite"));
  const app = Fastify();
  await app.register(websocket);
  const adapter: HarnessAdapter = {
    type: "codex", label: "Codex",
    capabilities: { approvals: true, fastMode: true, resume: true, streaming: true, userInput: true },
    async discoverWorkspace() { throw new Error("unused"); },
    async startThread() { return { harnessThreadId: null }; },
    async *run() { yield { type: "run.completed", text: "Done" }; },
    async respondToApproval() {}, async respondToInput() {}, async sendUserInput() {},
    ...overrides,
  };
  await registerApiRoutes(app, { harnesses: new Map([["codex", adapter]]), hub: createTimelineHub(), store });
  const thread = store.createThread({ deviceId: "owner", harnessThreadId: null, harnessType: "codex", title: "Test", workspacePath: directory });
  cleanups.push(async () => { await app.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { app, store, thread, headers: { "x-liteharness-device-id": "owner" } };
}

describe("run and thread reliability", () => {
  it("makes the preserved thread usable immediately when its previous backend has exited", async () => {
    const previousBackend = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await once(previousBackend, "exit");
    const { app, store, thread, headers } = await fixture();
    store.updateThread({ id: thread.id, harnessThreadId: "saved-context", status: "running" });
    const interrupted = store.createRun({ threadId: thread.id, prompt: "Restart" });
    store.updateRunStatus(interrupted.id, "running");
    store.claimRunOwner(interrupted.id, `liteharness:${previousBackend.pid}:previous-instance`);
    const snapshot = await app.inject({ url: `/api/threads/${thread.id}/state`, headers });
    expect(snapshot.json().thread).toMatchObject({ id: thread.id, status: "idle", harnessThreadId: "saved-context" });
    expect(store.getRun(interrupted.id)?.status).toBe("failed");
    expect(store.listTimeline(thread.id)).toEqual([]);
  });

  it("retains a fresh lease while its backend process is still alive", async () => {
    const { app, store, thread, headers } = await fixture();
    const run = store.createRun({ threadId: thread.id, prompt: "Still working" });
    store.updateRunStatus(run.id, "running");
    store.claimRunOwner(run.id, `liteharness:${process.pid}:other-instance`);
    store.updateThread({ id: thread.id, status: "running" });
    const snapshot = await app.inject({ url: `/api/threads/${thread.id}/state`, headers });
    expect(snapshot.json().thread.status).toBe("running");
    expect(store.getRun(run.id)?.status).toBe("running");
  });

  it("releases a restarted run through the reconnected socket without another snapshot request", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const { app, store, thread, headers } = await fixture();
    const interrupted = store.createRun({ threadId: thread.id, prompt: "Restart" });
    store.updateRunStatus(interrupted.id, "running");
    store.claimRunOwner(interrupted.id, "previous-backend");
    store.updateThread({ id: thread.id, status: "running" });
    store.recordTimelineEvent({ threadId: thread.id, runId: interrupted.id, type: "run.submitted", payload: { text: "Restart" } });
    const snapshot = await app.inject({ url: `/api/threads/${thread.id}/state`, headers });
    expect(snapshot.json().thread.status).toBe("running");
    const socket = await app.injectWS(`/api/ws?threadId=${thread.id}&deviceId=owner`);
    const messages: Array<{ type: string; threadStatus?: string }> = [];
    socket.on("message", data => messages.push(JSON.parse(String(data))));
    try {
      await vi.advanceTimersByTimeAsync(63_000);
      expect(store.getThread(thread.id)?.status).toBe("idle");
      expect(store.getRun(interrupted.id)?.status).toBe("failed");
      expect(messages.at(-1)).toMatchObject({ type: "heartbeat", threadStatus: "idle" });
      expect(store.listTimeline(thread.id).map(event => event.type)).toEqual(["run.submitted"]);
      const continued = await app.inject({ method: "POST", url: `/api/threads/${thread.id}/runs`, headers, payload: { prompt: "Continue here" } });
      expect(continued.statusCode).toBe(202);
    } finally {
      socket.terminate();
      vi.useRealTimers();
    }
  });

  it("delivers directed child input only to an owned active run and records its branch", async () => {
    const release = deferred<void>();
    const sendAgentInput = vi.fn(async () => undefined);
    const { app, store, thread, headers } = await fixture({
      sendAgentInput,
      async *run() {
        yield { type: "run.started", text: "Started" };
        await release.promise;
        yield { type: "run.completed", text: "Done" };
      },
    });
    const started = await app.inject({ method: "POST", url: `/api/threads/${thread.id}/runs`, headers, payload: { prompt: "work" } });
    const run = started.json() as { id: string };

    const accepted = await app.inject({
      method: "POST",
      url: `/api/threads/${thread.id}/runs/agents/child-1/input`,
      headers,
      payload: { prompt: "Check the failing test." },
    });
    expect(accepted.statusCode).toBe(202);
    expect(sendAgentInput).toHaveBeenCalledWith({ agentThreadId: "child-1", prompt: "Check the failing test.", runId: run.id });
    expect(accepted.json()).toMatchObject({ event: { payload: { agentThreadId: "child-1", liteharnessType: "user-prompt" } } });
    expect((await app.inject({
      method: "POST",
      url: `/api/threads/${thread.id}/runs/agents/child-1/input`,
      headers: { "x-liteharness-device-id": "other" },
      payload: { prompt: "foreign" },
    })).statusCode).toBe(404);

    const upload = await app.inject({ method: "POST", url: `/api/threads/${thread.id}/attachments?name=notes.txt`, headers: { ...headers, "content-type": "application/octet-stream" }, payload: Buffer.from("child input") });
    expect(upload.statusCode).toBe(201);
    const attachment = upload.json();
    const attached = await app.inject({ method: "POST", url: `/api/threads/${thread.id}/runs/agents/child-1/input`, headers, payload: { prompt: "", attachmentIds: [attachment.id] } });
    expect(attached.statusCode).toBe(202);
    expect(sendAgentInput).toHaveBeenLastCalledWith({ agentThreadId: "child-1", prompt: "", runId: run.id, attachments: [{ ...attachment, path: expect.any(String) }] });
    expect(attached.json().event.payload.attachments).toEqual([attachment]);

    release.resolve();
    await vi.waitFor(() => expect(store.getRun(run.id)?.status).toBe("completed"));
    expect((await app.inject({
      method: "POST",
      url: `/api/threads/${thread.id}/runs/agents/child-1/input`,
      headers,
      payload: { prompt: "too late" },
    })).statusCode).toBe(409);
  });

  it("keeps cancellation active until cleanup prevents a colliding next run", async () => {
    const abortSeen = deferred<void>();
    const releaseCleanup = deferred<void>();
    const { app, store, thread, headers } = await fixture({
      async *run(input) {
        yield { type: "run.started", text: "Started" };
        await new Promise<void>((resolve) => input.signal?.addEventListener("abort", () => {
          abortSeen.resolve();
          resolve();
        }, { once: true }));
        await releaseCleanup.promise;
      },
    });
    const first = await app.inject({ method: "POST", url: `/api/threads/${thread.id}/runs`, headers, payload: { prompt: "first" } });
    const firstRun = first.json() as { id: string };
    const cancel = app.inject({ method: "POST", url: `/api/threads/${thread.id}/runs/cancel`, headers });
    await abortSeen.promise;

    expect((await app.inject({ method: "POST", url: `/api/threads/${thread.id}/runs`, headers, payload: { prompt: "second" } })).statusCode).toBe(409);
    releaseCleanup.resolve();
    await cancel;
    await vi.waitFor(() => expect(store.getRun(firstRun.id)?.status).toBe("canceled"));
    expect((await app.inject({ method: "POST", url: `/api/threads/${thread.id}/runs`, headers, payload: { prompt: "second" } })).statusCode).toBe(202);
    const timeline = store.listTimeline(thread.id);
    expect(timeline.filter(event => event.type === "run.canceled" && event.runId === firstRun.id)).toHaveLength(1);
    expect(timeline.filter(event => event.type === "run.failed" && event.runId === firstRun.id)).toHaveLength(0);
  });

  it("keeps native canceled runs canceled without a second failure", async () => {
    const { app, store, thread, headers } = await fixture({ async *run() { yield { type: "run.canceled", text: "Interrupted" }; } });
    const response = await app.inject({ method: "POST", url: `/api/threads/${thread.id}/runs`, headers, payload: { prompt: "work" } });
    await vi.waitFor(() => expect(store.getRun(response.json().id)?.status).toBe("canceled"));
    expect(store.getThread(thread.id)?.status).toBe("idle");
    expect(store.listTimeline(thread.id).filter(event => event.type === "run.failed")).toHaveLength(0);
  });

  it("keeps failed input delivery retryable and records only a successful answer", async () => {
    const respondToInput = vi.fn().mockRejectedValueOnce(new Error("transport offline")).mockResolvedValueOnce(undefined);
    const { app, store, thread, headers } = await fixture({ respondToInput });
    const run = store.createRun({ threadId: thread.id, prompt: "question" });
    store.updateRunStatus(run.id, "needs_input");
    store.updateThread({ id: thread.id, status: "needs_input" });
    store.recordTimelineEvent({ threadId: thread.id, runId: run.id, type: "input.requested", payload: {
      inputRequestId: "question", questions: [{ id: "q", header: "Name", question: "Name?", allowOther: true, isSecret: false, options: null }],
    } });
    const request = { method: "POST" as const, url: `/api/threads/${thread.id}/input/question`, headers, payload: { answers: { q: ["Test"] } } };
    expect((await app.inject(request)).statusCode).toBe(502);
    expect(store.listTimeline(thread.id).filter(event => event.type === "input.responded")).toHaveLength(0);
    expect((await app.inject(request)).statusCode).toBe(202);
    expect(store.listTimeline(thread.id).filter(event => event.type === "input.responded")).toHaveLength(1);
  });

  it("closes a device's idle tabs in one request and restores their history", async () => {
    const { app, store, thread, headers } = await fixture();
    const running = store.createThread({ deviceId: "owner", harnessThreadId: null, harnessType: "codex", title: "Running", workspacePath: thread.workspacePath });
    store.updateThread({ id: running.id, status: "running" });
    const foreign = store.createThread({ deviceId: "other", harnessThreadId: null, harnessType: "codex", title: "Other", workspacePath: thread.workspacePath });
    store.recordTimelineEvent({ threadId: thread.id, runId: null, type: "harness.output", payload: { text: "Keep this" } });
    const response = await app.inject({ method: "POST", url: "/api/threads/close", headers, payload: { threadIds: [thread.id, running.id, foreign.id] } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ closedIds: [thread.id], skippedIds: [running.id, foreign.id] });
    expect(store.listThreadsForDevice("owner").map(t => t.id)).toEqual([running.id]);
    expect(store.listTimeline(thread.id)[0]?.payload.text).toBe("Keep this");
    expect((await app.inject({ method: "POST", url: `/api/threads/${thread.id}/reopen`, headers: { "x-liteharness-device-id": "other" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/threads/${thread.id}/reopen`, headers })).statusCode).toBe(200);
    expect(store.listThreadsForDevice("owner")).toHaveLength(2);
  });
});
