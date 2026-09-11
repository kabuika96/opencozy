import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appServerThreadStartParams,
  appServerThreadResumeParams,
  appServerTurnStartParams,
  codexRunThreadOptions,
  createCodexAdapter,
  mapAppServerNotification,
} from "../src/harnesses/codex/codexAdapter.js";
import { CodexAppServerPool } from "../src/harnesses/codex/appServerPool.js";
import type {
  AppServerMessage,
  CodexAppServerConnection,
  CodexAppServerPoolLike,
} from "../src/harnesses/codex/appServerPool.js";

const trackedEnv = [
  "LITEHARNESS_CODEX_APPROVAL_POLICY",
  "LITEHARNESS_CODEX_MODE",
  "LITEHARNESS_CODEX_MODEL",
  "LITEHARNESS_CODEX_REASONING_EFFORT",
  "LITEHARNESS_CODEX_NETWORK_ACCESS",
  "LITEHARNESS_CODEX_SANDBOX_MODE",
  "LITEHARNESS_MODEL",
  "LITEHARNESS_MODEL_REASONING_EFFORT",
] as const;
const originalEnv = new Map(trackedEnv.map((key) => [key, process.env[key]]));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

beforeEach(() => {
  for (const key of trackedEnv) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of trackedEnv) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("Codex adapter", () => {
  it("delivers attachment steering and restores the user's prompt and files in echoed history", async () => {
    const started = deferred<void>();
    const steered = deferred<void>();
    let content: unknown;
    const connection = fakeRunConnection([]);
    connection.request = async <T = unknown>(method: string, params: unknown): Promise<T> => {
      if (method === "thread/start") return { thread: { id: "thread-1" } } as T;
      if (method === "turn/start") return { turn: { id: "turn-1" } } as T;
      if (method === "turn/steer") { content = (params as { input: unknown }).input; steered.resolve(); }
      return {} as T;
    };
    connection.notifications = async function* () {
      yield { method: "item/started", params: { threadId: "thread-1", turnId: "turn-1", item: { id: "initial", type: "userMessage", content: [{ type: "text", text: "Start" }] } } };
      started.resolve();
      await steered.promise;
      yield { method: "item/started", params: { threadId: "thread-1", turnId: "turn-1", item: { id: "steering", type: "userMessage", content } } };
      yield { method: "item/completed", params: { threadId: "thread-1", turnId: "turn-1", item: { id: "steering", type: "userMessage", content } } };
      yield { method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } };
    };
    const adapter = createCodexAdapter({ pool: fakePool(connection) });
    const events: Array<{ type: string; text: string; payload?: Record<string, unknown> }> = [];
    const run = (async () => { for await (const event of adapter.run({ prompt: "Start", runId: "run-files", harnessThreadId: null, workspacePath: "/tmp" })) events.push(event); })();
    await started.promise;
    const attachment = { id: "file-id", name: "photo.png", size: 42, mediaType: "image/png", path: "/data/photo.png" };
    await adapter.sendUserInput({ prompt: "Inspect this", attachments: [attachment], runId: "run-files", threadId: "local-thread" });
    await run;
    expect(content).toContainEqual({ type: "localImage", path: attachment.path });
    expect(events.filter(event => event.type === "run.steered")).toEqual([expect.objectContaining({ text: "Inspect this", payload: expect.objectContaining({ attachments: [{ id: attachment.id, name: attachment.name, size: 42, mediaType: attachment.mediaType }] }) })]);
  });

  it("sends images as native input and other uploads as local file references alongside the exact prompt", () => {
    const params = appServerTurnStartParams({
      harnessThreadId: null, prompt: "Compare these", runId: "run-files", workspacePath: "/tmp",
      attachments: [
        { id: "image-id", name: "photo.png", mediaType: "image/png", size: 42, path: "/data/photo.png" },
        { id: "file-id", name: "report.pdf", mediaType: "application/octet-stream", size: 100, path: "/data/report.pdf" },
      ],
    }, "thread-files");
    const items = params.input as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({ type: "text", text: "Compare these" });
    expect(items).toContainEqual({ type: "localImage", path: "/data/photo.png" });
    expect(items.some(item => item.type === "text" && String(item.text).includes("/data/report.pdf"))).toBe(true);
  });

  it("discovers a nested project directory from its name", async () => {
    const homePath = await mkdtemp(join(tmpdir(), "liteharness-workspace-discovery-"));
    const projectPath = join(homePath, "Documents", "projects", "babyfeed");
    await mkdir(projectPath, { recursive: true });

    try {
      const discovery = await createCodexAdapter().discoverWorkspace({
        defaultWorkspacePath: homePath,
        description: "babyfeed",
      });

      expect(discovery).toEqual({
        explanation: "Matched nested directory name",
        title: "babyfeed",
        workspacePath: projectPath,
      });
    } finally {
      await rm(homePath, { force: true, recursive: true });
    }
  });

  it("exposes a mock run loop for local shell validation", async () => {
    process.env.LITEHARNESS_CODEX_MODE = "mock";
    const adapter = createCodexAdapter();
    const events = [];
    for await (const event of adapter.run({
      harnessThreadId: null,
      harnessPrompt: "hello\n\n<liteharness-system-config>hidden</liteharness-system-config>",
      prompt: "hello",
      runId: "run-1",
      workspacePath: "/tmp",
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toContain("run.started");
    expect(events.map((event) => event.type)).toContain("run.completed");
    expect(events.find((event) => event.type === "harness.output")?.text).toBe("Received prompt: hello");
  });

  it("defaults to Astra with high reasoning for owner-local Codex work", () => {
    expect(codexRunThreadOptions("/tmp/liteharness")).toMatchObject({
      approvalPolicy: "on-request",
      fastMode: true,
      model: "gpt-6-astra",
      modelReasoningEffort: "high",
      profileId: "default",
      sandboxMode: "danger-full-access",
      skipGitRepoCheck: true,
      workingDirectory: "/tmp/liteharness",
    });
  });

  it.each([
    { id: "default", label: "Balance", main: "high", child: "high", fast: true },
    { id: "speed", label: "Speed", main: "medium", child: "low", fast: true },
    { id: "power", label: "Power", main: "max", child: "xhigh", fast: false },
  ])("uses the exact $label preset for main and all subagents despite global overrides", ({ id, label, main, child, fast }) => {
    process.env.LITEHARNESS_MODEL = "obsolete-utility-model";
    process.env.LITEHARNESS_MODEL_REASONING_EFFORT = "ultra";
    process.env.LITEHARNESS_CODEX_MODEL = "obsolete-main-model";
    process.env.LITEHARNESS_CODEX_REASONING_EFFORT = "high";
    const profile = createCodexAdapter().listExecutionProfiles!().find(profile => profile.id === id);
    expect(profile).toMatchObject({ id, label, model: "gpt-6-astra", reasoningEffort: main,
      subagentModel: "gpt-6-astra", subagentReasoningEffort: child, fastMode: fast });
    const input = { profileId: id, harnessThreadId: "thread-1", prompt: "Build it", runId: "run-1", workspacePath: "/tmp/liteharness" };
    for (const params of [appServerThreadStartParams(input), appServerThreadResumeParams(input)]) {
      expect(params).toMatchObject({ model: "gpt-6-astra", config: {
        model_reasoning_effort: main,
        agents: { default_subagent_model: "gpt-6-astra", default_subagent_reasoning_effort: child },
      } });
      expect(params.developerInstructions).toContain(`reasoning effort ${child}`);
      expect(params.developerInstructions).not.toMatch(/gpt-5\.6-(sol|terra)/);
      expect(params.developerInstructions).toContain("session's collaboration policy");
    }
    expect(appServerTurnStartParams(input, "thread-1")).toMatchObject({ model: "gpt-6-astra", effort: main, serviceTier: fast ? "fast" : null });
  });

  it("runs two previously created threads concurrently without competing for a writer", async () => {
    const owners = new Map<string, CodexAppServerConnection>();
    const finishFirst = deferred<void>();
    let nextThread = 0;
    const pool = new CodexAppServerPool(async () => {
      let activeThread = "";
      const connection: CodexAppServerConnection = {
        async close() {
          for (const [id, owner] of owners) if (owner === connection) owners.delete(id);
        },
        notify() {},
        respond() {},
        async request<T>(method: string, value: unknown): Promise<T> {
          const params = value as { threadId?: string };
          if (method === "thread/start" || method === "thread/resume") {
            const id = params.threadId ?? `thread-${++nextThread}`;
            if (owners.has(id) && owners.get(id) !== connection) throw new Error(`thread ${id} already has an active writer`);
            owners.set(id, connection);
            return { thread: { id } } as T;
          }
          if (method === "turn/start") {
            activeThread = params.threadId!;
            return { turn: { id: "turn-1" } } as T;
          }
          return {} as T;
        },
        async *notifications() {
          if (activeThread === "thread-1") await finishFirst.promise;
          yield { method: "turn/completed", params: { threadId: activeThread, turn: { id: "turn-1", status: "completed" } } };
        },
      };
      return connection;
    });
    const adapter = createCodexAdapter({ pool });
    const workspacePath = "/tmp/liteharness";
    const first = await adapter.startThread({ workspacePath });
    const second = await adapter.startThread({ workspacePath });
    const running = adapter.run({ ...first, workspacePath, prompt: "First device", runId: "first" })[Symbol.asyncIterator]();
    try {
      expect((await running.next()).value?.type).toBe("thread.started");
      expect((await running.next()).value?.type).toBe("run.started");
      for (const prompt of ["Second device", "Second device follow-up"]) {
        const events = [];
        for await (const event of adapter.run({ ...second, workspacePath, prompt, runId: "second" })) events.push(event);
        expect(events.at(-1)).toMatchObject({ type: "run.completed" });
      }
      finishFirst.resolve();
      expect((await running.next()).value?.type).toBe("run.completed");
    } finally {
      finishFirst.resolve();
      await running.return?.();
      await pool.close();
    }
  });

  it("appends follow-ups to the loaded thread without resuming or replacing its context", async () => {
    const connection = fakeRunConnection([completedTurnNotification()]);
    const request = vi.spyOn(connection, "request");
    const adapter = createCodexAdapter({ pool: fakePool(connection) });
    const { harnessThreadId } = await adapter.startThread({ workspacePath: "/tmp/liteharness" });
    const prompts = ["First message\nKeep this spacing.", "Next message", "One more"];

    for (const [index, prompt] of prompts.entries()) {
      const events = [];
      for await (const event of adapter.run({ harnessThreadId, prompt, runId: `run-${index}`, workspacePath: "/tmp/liteharness" })) events.push(event);
      expect(events.at(-1)?.type).toBe("run.completed");
    }

    expect(request.mock.calls.map(([method]) => method)).toEqual(["thread/start", "turn/start", "turn/start", "turn/start"]);
    expect(request.mock.calls.slice(1).map(([, params]) => params)).toEqual(prompts.map(prompt => ({
      effort: "high", input: [{ text: prompt, text_elements: [], type: "text" }], model: "gpt-6-astra", serviceTier: "fast", threadId: harnessThreadId,
    })));
  });

  it("resumes persisted history once after connection recovery without supplying replacement history", async () => {
    const first = fakeRunConnection([completedTurnNotification()]);
    const recovered = fakeRunConnection([completedTurnNotification()]);
    const request = vi.spyOn(recovered, "request");
    const pool = fakePool(first);
    const adapter = createCodexAdapter({ pool });
    const input = { harnessThreadId: null, prompt: "First", runId: "run-1", workspacePath: "/tmp/liteharness" };
    for await (const _ of adapter.run(input)) { /* Drain the first turn. */ }
    pool.acquire = fakePool(recovered).acquire;
    for (const prompt of ["Second", "Third"]) {
      for await (const _ of adapter.run({ ...input, harnessThreadId: "thread-1", prompt, runId: prompt })) { /* Drain follow-ups. */ }
    }
    expect(request.mock.calls.map(([method]) => method)).toEqual(["thread/resume", "turn/start", "turn/start"]);
    const resume = request.mock.calls[0]![1] as Record<string, unknown>;
    expect(resume).toMatchObject({ threadId: "thread-1", excludeTurns: true });
    expect(resume).not.toHaveProperty("history");
    expect(resume).not.toHaveProperty("path");
    expect(resume).not.toHaveProperty("dynamicTools");
    expect(resume.developerInstructions).toBe(appServerThreadStartParams(input).developerInstructions);
  });

  it("applies explicit profile and Fast changes even when a thread is loaded", async () => {
    const connection = fakeRunConnection([completedTurnNotification()]);
    const request = vi.spyOn(connection, "request");
    const adapter = createCodexAdapter({ pool: fakePool(connection) });
    const input = { harnessThreadId: null, prompt: "First", runId: "run-1", workspacePath: "/tmp/liteharness" };
    for await (const _ of adapter.run(input)) { /* Drain the first turn. */ }
    for await (const _ of adapter.run({ ...input, harnessThreadId: "thread-1", profileId: "power", fastMode: false, prompt: "Think harder", runId: "run-2" })) { /* Drain the next turn. */ }
    expect(request.mock.calls.map(([method]) => method)).toEqual(["thread/start", "turn/start", "thread/resume", "turn/start"]);
    expect(request.mock.calls.at(-1)?.[1]).toMatchObject({ effort: "max", model: "gpt-6-astra", serviceTier: null, threadId: "thread-1" });
  });

  it("forgets loaded state when a turn fails before it starts", async () => {
    const connection = fakeRunConnection([completedTurnNotification()]);
    const originalRequest = connection.request;
    let failNextTurn = true;
    const request = vi.spyOn(connection, "request").mockImplementation(async (method, params) => {
      if (method === "turn/start" && failNextTurn) {
        failNextTurn = false;
        throw new Error("turn start failed");
      }
      return originalRequest(method, params);
    });
    const adapter = createCodexAdapter({ pool: fakePool(connection) });
    const input = { harnessThreadId: null, prompt: "First", runId: "run-1", workspacePath: "/tmp/liteharness" };
    const failed = [];
    for await (const event of adapter.run(input)) failed.push(event);
    expect(failed.at(-1)?.type).toBe("run.failed");
    for await (const _ of adapter.run({ ...input, harnessThreadId: "thread-1", runId: "run-2" })) { /* Retry on a healthy lease. */ }
    expect(request.mock.calls.map(([method]) => method)).toEqual(["thread/start", "turn/start", "thread/resume", "turn/start"]);
  });

  it("resumes an unloaded warm thread before retrying its unaccepted turn", async () => {
    const connection = fakeRunConnection([completedTurnNotification()]);
    const request = vi.spyOn(connection, "request");
    const adapter = createCodexAdapter({ pool: fakePool(connection) });
    const input = { harnessThreadId: null, prompt: "First", runId: "run-1", workspacePath: "/tmp/liteharness" };
    for await (const _ of adapter.run(input)) { /* Load the thread. */ }
    request.mockRejectedValueOnce(new Error("thread not found: thread-1"));
    const events = [];
    for await (const event of adapter.run({ ...input, harnessThreadId: "thread-1", prompt: "Next", runId: "run-2" })) events.push(event);
    expect(events.at(-1)?.type).toBe("run.completed");
    expect(request.mock.calls.slice(2).map(([method]) => method)).toEqual(["turn/start", "thread/resume", "turn/start"]);
    expect(request.mock.calls[2]?.[1]).toEqual(request.mock.calls[4]?.[1]);
  });

  it("never retries an ambiguous warm turn-start failure", async () => {
    const connection = fakeRunConnection([completedTurnNotification()]);
    const request = vi.spyOn(connection, "request");
    const adapter = createCodexAdapter({ pool: fakePool(connection) });
    const input = { harnessThreadId: null, prompt: "First", runId: "run-1", workspacePath: "/tmp/liteharness" };
    for await (const _ of adapter.run(input)) { /* Load the thread. */ }
    request.mockRejectedValueOnce(new Error("Codex app-server request timed out: turn/start"));
    const events = [];
    for await (const event of adapter.run({ ...input, harnessThreadId: "thread-1", prompt: "Next", runId: "run-2" })) events.push(event);
    expect(events.at(-1)?.type).toBe("run.failed");
    expect(request.mock.calls.slice(2).map(([method]) => method)).toEqual(["turn/start"]);
  });

  it("gives new Codex threads a fixed-recipient WhatsApp messaging tool", () => {
    const params = appServerThreadStartParams({
      harnessThreadId: null,
      liteHarnessThreadId: "liteharness-thread-1",
      prompt: "Text me when it is ready",
      runId: "run-1",
      workspacePath: "/tmp/liteharness",
    });

    expect(params.dynamicTools).toEqual(expect.arrayContaining([{
      description: "Send a text message to the owner through the local Hermes WhatsApp bridge.",
      name: "whatsapp",
      tools: [{
        description: "Send one WhatsApp message to the owner's fixed chat. The recipient is configured by Opencozy.",
        inputSchema: {
          additionalProperties: false,
          properties: {
            message: {
              maxLength: 4096,
              minLength: 1,
              type: "string",
            },
          },
          required: ["message"],
          type: "object",
        },
        name: "send_message",
        type: "function",
      }],
      type: "namespace",
    }]));
  });

  it.each([true, false])("waits for an explicit approval tool decision: %s", async approved => {
    const connection = fakeRunConnection([{
      id: "restart-approval", method: "item/tool/call",
      params: { namespace: "liteharness", tool: "request_approval", arguments: { action: "Restart Opencozy backend; active runs will stop." }, threadId: "thread-1", turnId: "turn-1" },
    }, completedTurnNotification()]);
    const adapter = createCodexAdapter({ pool: fakePool(connection) });
    const stream = adapter.run({ harnessThreadId: null, prompt: "Apply the update", runId: "run-1", workspacePath: "/tmp" })[Symbol.asyncIterator]();
    let request;
    for (let i = 0; i < 4; i++) {
      const next = await stream.next();
      if (next.value?.type === "approval.requested") { request = next.value; break; }
    }
    expect(request?.text).toBe("Restart Opencozy backend; active runs will stop.");
    expect(connection.respond).not.toHaveBeenCalled();
    await adapter.respondToApproval({ approvalId: request!.approvalId, approved });
    expect(connection.respond).toHaveBeenCalledWith("restart-approval", {
      contentItems: [{ type: "inputText", text: JSON.stringify({ approved, action: request!.text }) }], success: true,
    });
    await expect(adapter.respondToApproval({ approvalId: request!.approvalId, approved })).rejects.toThrow("no longer active");
    while (!(await stream.next()).done) { /* Finish cleanup. */ }
  });

  it.each([{}, { action: " " }, { action: "x".repeat(2001) }, { action: "Restart", approved: true }])("rejects malformed explicit approval arguments: %j", async args => {
    const connection = fakeRunConnection([{ id: "bad-approval", method: "item/tool/call", params: {
      namespace: "liteharness", tool: "request_approval", arguments: args, threadId: "thread-1", turnId: "turn-1",
    } }, completedTurnNotification()]);
    const adapter = createCodexAdapter({ pool: fakePool(connection) });
    const events = [];
    for await (const event of adapter.run({ harnessThreadId: null, prompt: "test", runId: "run-1", workspacePath: "/tmp" })) events.push(event);
    expect(events.some(event => event.type === "approval.requested")).toBe(false);
    expect(connection.respond).toHaveBeenCalledWith("bad-approval", expect.objectContaining({ success: false }));
  });

  it("keeps explicit approvals retryable and rejects concurrent decisions", async () => {
    const gate = deferred<void>();
    const connection = fakeRunConnection([{ id: "explicit", method: "item/tool/call", params: {
      namespace: "liteharness", tool: "request_approval", arguments: { action: "Restart backend" }, threadId: "thread-1", turnId: "turn-1",
    } }, completedTurnNotification()]);
    connection.respond = vi.fn().mockRejectedValueOnce(new Error("EPIPE")).mockImplementationOnce(() => gate.promise);
    const adapter = createCodexAdapter({ pool: fakePool(connection) });
    for await (const event of adapter.run({ harnessThreadId: null, prompt: "test", runId: "run-1", workspacePath: "/tmp" })) {
      if (event.type !== "approval.requested") continue;
      const decision = { approvalId: event.approvalId, approved: false };
      await expect(adapter.respondToApproval(decision)).rejects.toThrow("EPIPE");
      const retry = adapter.respondToApproval(decision);
      await expect(adapter.respondToApproval({ ...decision, approved: true })).rejects.toThrow("already being delivered");
      gate.resolve();
      await retry;
    }
    expect(connection.respond).toHaveBeenCalledTimes(2);
  });

  it("invalidates an unanswered explicit approval when its run ends", async () => {
    const connection = fakeRunConnection([{ id: "ended-approval", method: "item/tool/call", params: {
      namespace: "liteharness", tool: "request_approval", arguments: { action: "Restart backend" }, threadId: "thread-1", turnId: "turn-1",
    } }, completedTurnNotification()]);
    const adapter = createCodexAdapter({ pool: fakePool(connection) });
    let approvalId = "";
    for await (const event of adapter.run({ harnessThreadId: null, prompt: "test", runId: "run-1", workspacePath: "/tmp" })) {
      if (event.type === "approval.requested") approvalId = event.approvalId;
    }
    expect(approvalId).not.toBe("");
    await expect(adapter.respondToApproval({ approvalId, approved: true })).rejects.toThrow("no longer active");
    expect(connection.respond).not.toHaveBeenCalled();
  });

  it("exposes and dispatches file tools while preserving a fallback for existing histories", async () => {
    const invoke = vi.fn(async () => ({ assets: [{ id: "asset-1", title: "Insurance" }] }));
    const fileAssets = { invoke, contextPath: "/tmp/file-context.json", cliPath: "/app/scripts/file-assets.mjs" };
    const input = { harnessThreadId: null, prompt: "Find insurance", runId: "run-files", workspacePath: "/tmp", fileAssets };
    const start = appServerThreadStartParams(input);
    expect(start.dynamicTools).toEqual(expect.arrayContaining([expect.objectContaining({ name: "files", tools: expect.arrayContaining([expect.objectContaining({ name: "publish" }), expect.objectContaining({ name: "search" }), expect.objectContaining({ name: "show" }), expect.objectContaining({ name: "read" }), expect.objectContaining({ name: "search_records" }), expect.objectContaining({ name: "show_record" })]) })]));
    const resume = appServerThreadResumeParams({ ...input, harnessThreadId: "existing-thread" });
    expect(resume).not.toHaveProperty("dynamicTools");
    expect(resume.developerInstructions).toContain("/tmp/file-context.json");
    expect(resume.developerInstructions).not.toContain("run-files");
    const connection = fakeRunConnection([
      { id: "file-tool", method: "item/tool/call", params: { namespace: "files", tool: "search", arguments: { query: "insurance" }, threadId: "thread-1", turnId: "turn-1" } },
      { id: "wrong-thread", method: "item/tool/call", params: { namespace: "files", tool: "search", arguments: { query: "private" }, threadId: "foreign", turnId: "turn-1" } },
      completedTurnNotification(),
    ]);
    const adapter = createCodexAdapter({ pool: fakePool(connection) });
    for await (const _event of adapter.run(input)) { /* consume */ }
    expect(invoke).toHaveBeenCalledExactlyOnceWith("search", { query: "insurance" });
    expect(connection.respond).toHaveBeenCalledWith("file-tool", expect.objectContaining({ success: true }));
    expect(connection.respond).toHaveBeenCalledWith("wrong-thread", expect.objectContaining({ success: false }));
  });

  it("delivers a native WhatsApp tool call through the fixed-recipient bridge", async () => {
    const sendMessage = vi.fn(async () => ({ messageId: "wamid-1" }));
    const connection = fakeRunConnection([{
      id: "tool-request-1",
      method: "item/tool/call",
      params: {
        arguments: { message: "Build finished." },
        callId: "tool-call-1",
        namespace: "whatsapp",
        threadId: "thread-1",
        tool: "send_message",
        turnId: "turn-1",
      },
    }, completedTurnNotification()]);
    const adapter = createCodexAdapter({
      pool: fakePool(connection),
      whatsApp: { sendMessage },
    });

    for await (const _event of adapter.run({
      harnessThreadId: null,
      prompt: "Text me when it is ready",
      runId: "run-1",
      workspacePath: "/tmp/liteharness",
    })) {
      // Consume the public Run stream so the native tool request is handled.
    }

    expect(sendMessage).toHaveBeenCalledWith("Build finished.");
    expect(connection.respond).toHaveBeenCalledWith("tool-request-1", {
      contentItems: [{
        text: "WhatsApp message sent.",
        type: "inputText",
      }],
      success: true,
    });
  });

  it("rejects an invalid native WhatsApp message without calling the bridge", async () => {
    const sendMessage = vi.fn(async () => ({ messageId: "should-not-send" }));
    const connection = fakeRunConnection([{
      id: "tool-request-1",
      method: "item/tool/call",
      params: {
        arguments: { message: "   " },
        callId: "tool-call-1",
        namespace: "whatsapp",
        threadId: "thread-1",
        tool: "send_message",
        turnId: "turn-1",
      },
    }, completedTurnNotification()]);
    const adapter = createCodexAdapter({
      pool: fakePool(connection),
      whatsApp: { sendMessage },
    });

    for await (const _event of adapter.run({
      harnessThreadId: null,
      prompt: "Text me",
      runId: "run-1",
      workspacePath: "/tmp/liteharness",
    })) {
      // Consume the public Run stream so the native tool request is handled.
    }

    expect(sendMessage).not.toHaveBeenCalled();
    expect(connection.respond).toHaveBeenCalledWith("tool-request-1", {
      contentItems: [{
        text: "WhatsApp message must be between 1 and 4096 characters.",
        type: "inputText",
      }],
      success: false,
    });
  });

  it("returns bridge failures to Codex as failed native tool results", async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error(
        'Hermes WhatsApp bridge is offline (status: disconnected). Run "hermes whatsapp" to pair or reconnect it.',
      );
    });
    const connection = fakeRunConnection([{
      id: "tool-request-1",
      method: "item/tool/call",
      params: {
        arguments: { message: "Build finished." },
        callId: "tool-call-1",
        namespace: "whatsapp",
        threadId: "thread-1",
        tool: "send_message",
        turnId: "turn-1",
      },
    }, completedTurnNotification()]);
    const adapter = createCodexAdapter({
      pool: fakePool(connection),
      whatsApp: { sendMessage },
    });

    for await (const _event of adapter.run({
      harnessThreadId: null,
      prompt: "Text me",
      runId: "run-1",
      workspacePath: "/tmp/liteharness",
    })) {
      // Consume the public Run stream so the native tool request is handled.
    }

    expect(connection.respond).toHaveBeenCalledWith("tool-request-1", {
      contentItems: [{
        text: 'Hermes WhatsApp bridge is offline (status: disconnected). Run "hermes whatsapp" to pair or reconnect it.',
        type: "inputText",
      }],
      success: false,
    });
  });

  it.each([
    {
      approved: true,
      response: {
        _meta: null,
        action: "accept",
        content: {},
      },
    },
    {
      approved: false,
      response: {
        _meta: null,
        action: "decline",
        content: null,
      },
    },
  ])("bridges a Gmail-style MCP tool approval when approved=$approved", async ({ approved, response }) => {
    const connection = fakeRunConnection([{
      id: "gmail-approval-1",
      method: "mcpServer/elicitation/request",
      params: {
        _meta: {
          codex_approval_kind: "mcp_tool_call",
          codex_request_type: "approval_request",
          connector_name: "Gmail",
          tool_name: "send_email",
          tool_params_display: {
            Subject: "Diagnostic self-send",
            To: "owner@example.com",
          },
          tool_title: "Send email",
        },
        message: "Allow Gmail to send this email?",
        mode: "form",
        requestedSchema: {
          properties: {},
          type: "object",
        },
        serverName: "codex_apps",
        threadId: "thread-1",
        turnId: "turn-1",
      },
    }, completedTurnNotification()]);
    const adapter = createCodexAdapter({ pool: fakePool(connection) });
    const events = [];

    for await (const event of adapter.run({
      harnessThreadId: null,
      prompt: "Send the diagnostic email",
      runId: "run-1",
      workspacePath: "/tmp/liteharness",
    })) {
      events.push(event);
      if (event.type === "approval.requested") {
        await adapter.respondToApproval({
          approvalId: event.approvalId,
          approved,
        });
      }
    }

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        payload: expect.objectContaining({
          connectorName: "Gmail",
          requestMethod: "mcpServer/elicitation/request",
          serverName: "codex_apps",
          toolName: "send_email",
          toolTitle: "Send email",
        }),
        text: "Allow Gmail to send this email?",
        type: "approval.requested",
      }),
    ]));
    expect(connection.respond).toHaveBeenCalledWith("gmail-approval-1", response);
  });

  it("declines unsupported MCP forms immediately instead of leaving the turn blocked", async () => {
    const connection = fakeRunConnection([{
      id: "unsupported-form-1",
      method: "mcpServer/elicitation/request",
      params: {
        _meta: null,
        message: "Enter a secret",
        mode: "form",
        requestedSchema: {
          properties: {
            secret: { type: "string" },
          },
          required: ["secret"],
          type: "object",
        },
        serverName: "example",
        threadId: "thread-1",
        turnId: "turn-1",
      },
    }, completedTurnNotification()]);
    const adapter = createCodexAdapter({ pool: fakePool(connection) });
    const events = [];

    for await (const event of adapter.run({
      harnessThreadId: null,
      prompt: "Use the example tool",
      runId: "run-1",
      workspacePath: "/tmp/liteharness",
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).not.toContain("approval.requested");
    expect(connection.respond).toHaveBeenCalledWith("unsupported-form-1", {
      _meta: null,
      action: "decline",
      content: null,
    });
  });

  it.each([
    {
      approved: true,
      response: {
        permissions: {
          network: { enabled: true },
        },
        scope: "turn",
      },
    },
    {
      approved: false,
      response: {
        permissions: {},
        scope: "turn",
      },
    },
  ])("bridges a permission approval when approved=$approved", async ({ approved, response }) => {
    const connection = fakeRunConnection([{
      id: "permissions-approval-1",
      method: "item/permissions/requestApproval",
      params: {
        cwd: "/tmp/liteharness",
        environmentId: "local",
        itemId: "permission-call-1",
        permissions: {
          fileSystem: null,
          network: { enabled: true },
        },
        reason: "Reach the approved service",
        startedAtMs: 1_785_000_000_000,
        threadId: "thread-1",
        turnId: "turn-1",
      },
    }, completedTurnNotification()]);
    const adapter = createCodexAdapter({ pool: fakePool(connection) });

    for await (const event of adapter.run({
      harnessThreadId: null,
      prompt: "Call the service",
      runId: "run-1",
      workspacePath: "/tmp/liteharness",
    })) {
      if (event.type === "approval.requested") {
        expect(event).toMatchObject({
          payload: {
            requestMethod: "item/permissions/requestApproval",
            requestedPermissions: {
              fileSystem: null,
              network: { enabled: true },
            },
          },
          text: "Reach the approved service",
        });
        await adapter.respondToApproval({
          approvalId: event.approvalId,
          approved,
        });
      }
    }

    expect(connection.respond).toHaveBeenCalledWith("permissions-approval-1", response);
  });

  it("keeps a pending approval retryable when its response write fails", async () => {
    const release = deferred<void>();
    const connection = fakeRunConnection([]);
    connection.respond = vi.fn().mockRejectedValueOnce(new Error("EPIPE")).mockResolvedValueOnce(undefined);
    connection.notifications = async function* () {
      yield {
        id: "approval-retry-1",
        method: "item/commandExecution/requestApproval",
        params: { command: "git status", threadId: "thread-1", turnId: "turn-1" },
      };
      await release.promise;
      yield completedTurnNotification();
    };
    const adapter = createCodexAdapter({ pool: fakePool(connection) });
    let approvalId = "";
    const running = (async () => {
      for await (const event of adapter.run({ harnessThreadId: null, prompt: "check", runId: "run-retry", workspacePath: "/tmp" })) {
        if (event.type === "approval.requested") approvalId = event.approvalId;
      }
    })();
    await vi.waitFor(() => expect(approvalId).not.toBe(""));

    await expect(adapter.respondToApproval({ approvalId, approved: true })).rejects.toThrow("EPIPE");
    await expect(adapter.respondToApproval({ approvalId, approved: true })).resolves.toBeUndefined();
    release.resolve();
    await running;
  });

  it("allows narrowing the Codex sandbox through environment config", () => {
    process.env.LITEHARNESS_CODEX_APPROVAL_POLICY = "untrusted";
    process.env.LITEHARNESS_CODEX_MODEL = "gpt-test";
    process.env.LITEHARNESS_CODEX_REASONING_EFFORT = "medium";
    process.env.LITEHARNESS_CODEX_NETWORK_ACCESS = "1";
    process.env.LITEHARNESS_CODEX_SANDBOX_MODE = "workspace-write";

    expect(codexRunThreadOptions("/tmp/liteharness", "default")).toMatchObject({
      approvalPolicy: "untrusted",
      model: "gpt-6-astra",
      modelReasoningEffort: "high",
      networkAccessEnabled: true,
      sandboxMode: "workspace-write",
      workingDirectory: "/tmp/liteharness",
    });
  });

  it("maps Opencozy fast mode onto Codex service tier", () => {
    expect(appServerTurnStartParams({
      fastMode: true,
      harnessThreadId: null,
      prompt: "ship it",
      runId: "run-1",
      workspacePath: "/tmp/liteharness",
    }, "thread-1")).toMatchObject({
      effort: "high",
      model: "gpt-6-astra",
      serviceTier: "fast",
      threadId: "thread-1",
    });
    expect(appServerTurnStartParams({
      fastMode: false,
      harnessThreadId: null,
      prompt: "ship it",
      runId: "run-1",
      workspacePath: "/tmp/liteharness",
    }, "thread-1")).toMatchObject({
      serviceTier: null,
      threadId: "thread-1",
    });
  });

  it("suppresses the first user message because run.submitted already stores it", () => {
    const state = appServerState();
    const initial = Array.from(mapAppServerNotification({
      method: "item/started",
      params: {
        item: {
          content: [{ text: "prompt normalized by Codex", type: "text" }],
          id: "user-1",
          type: "userMessage",
        },
        threadId: "thread-1",
        turnId: "turn-1",
      },
    }, state));
    const initialCompleted = Array.from(mapAppServerNotification({
      method: "item/completed",
      params: {
        item: {
          content: [{ text: "prompt normalized by Codex", type: "text" }],
          id: "user-1",
          type: "userMessage",
        },
        threadId: "thread-1",
        turnId: "turn-1",
      },
    }, state));
    const steering = Array.from(mapAppServerNotification({
      method: "item/started",
      params: {
        item: {
          content: [{ text: "steer now", type: "text" }],
          id: "user-2",
          type: "userMessage",
        },
        threadId: "thread-1",
        turnId: "turn-1",
      },
    }, state));

    expect(initial).toEqual([]);
    expect(initialCompleted).toEqual([]);
    expect(steering).toMatchObject([{
      payload: { liteharnessType: "user-prompt" },
      text: "steer now",
      type: "run.steered",
    }]);
  });

  it("streams the first assistant delta through the stable message entry", () => {
    const state = appServerState();
    const first = Array.from(mapAppServerNotification({
      method: "item/agentMessage/delta",
      params: {
        delta: "Hel",
        itemId: "message-1",
        threadId: "thread-1",
        turnId: "turn-1",
      },
    }, state));
    const burst = Array.from(mapAppServerNotification({
      method: "item/agentMessage/delta",
      params: {
        delta: "lo",
        itemId: "message-1",
        threadId: "thread-1",
        turnId: "turn-1",
      },
    }, state));

    expect(first).toMatchObject([{
      payload: {
        codexEventType: "item.delta",
        liteharnessType: "assistant-message",
        stableKey: "codex:item:message-1",
        status: "in_progress",
      },
      text: "Hel",
      type: "harness.output",
    }]);
    expect(burst).toEqual([]);
  });

  it("maps native Codex subagent collaboration items", () => {
    const state = appServerState();
    const [event] = Array.from(mapAppServerNotification({
      method: "item/started",
      params: {
        item: {
          agentsStates: {
            "agent-1": { message: null, status: "running" },
          },
          id: "collab-1",
          model: "gpt-6-astra",
          prompt: "Audit the frontend",
          reasoningEffort: "medium",
          receiverThreadIds: ["agent-1"],
          senderThreadId: "thread-1",
          status: "inProgress",
          tool: "spawnAgent",
          type: "collabAgentToolCall",
        },
        threadId: "thread-1",
        turnId: "turn-1",
      },
    }, state));

    expect(event).toMatchObject({
      payload: {
        collabTool: "spawnAgent",
        liteharnessType: "subagent",
        receiverThreadIds: ["agent-1"],
        status: "in_progress",
      },
      type: "harness.status",
    });
    expect(state.subagentThreadIds.has("agent-1")).toBe(true);
  });

  it("maps child Codex threads into stable subagent activity", () => {
    const state = appServerState();
    const [event] = Array.from(mapAppServerNotification({
      method: "thread/started",
      params: {
        thread: {
          agentNickname: "Scout",
          agentRole: "explorer",
          id: "agent-1",
          parentThreadId: "thread-1",
        },
      },
    }, state));

    expect(event).toMatchObject({
      payload: {
        agentNickname: "Scout",
        agentRole: "explorer",
        agentStatus: "running",
        agentThreadId: "agent-1",
        liteharnessType: "subagent",
        stableKey: "codex:subagent:agent-1",
      },
      text: "Scout started.",
    });
  });

  it("streams child-thread work with enough lineage to open the subagent timeline", () => {
    const state = appServerState();
    Array.from(mapAppServerNotification({
      method: "thread/started",
      params: {
        thread: {
          agentNickname: "Scout",
          agentRole: "explorer",
          id: "agent-1",
          parentThreadId: "thread-1",
        },
      },
    }, state));

    const [event] = Array.from(mapAppServerNotification({
      method: "item/completed",
      params: {
        item: {
          id: "agent-message-1",
          text: "The slow path is in rendering.",
          type: "agentMessage",
        },
        threadId: "agent-1",
        turnId: "agent-turn-1",
      },
    }, state));

    expect(event).toMatchObject({
      payload: {
        agentNickname: "Scout",
        agentRole: "explorer",
        agentThreadId: "agent-1",
        liteharnessType: "assistant-message",
        parentThreadId: "thread-1",
      },
      text: "The slow path is in rendering.",
      type: "harness.output",
    });
  });

  it("accepts child output that arrives before its thread-start notification", () => {
    const state = appServerState();

    const outputBeforeRegistration = Array.from(mapAppServerNotification({
      method: "item/completed",
      params: {
        item: { id: "shared-message", text: "Found the bottleneck.", type: "agentMessage" },
        threadId: "agent-early",
        turnId: "child-turn-1",
      },
    }, state));
    const startedAndOutput = Array.from(mapAppServerNotification({
      method: "thread/started",
      params: {
        thread: {
          agentNickname: "Scout",
          agentRole: "explorer",
          id: "agent-early",
          parentThreadId: "thread-1",
        },
      },
    }, state));

    expect(outputBeforeRegistration).toEqual([]);
    const output = startedAndOutput.find((event) => event.type === "harness.output");
    const started = startedAndOutput.find((event) => event.payload?.agentNickname === "Scout");
    expect(output).toMatchObject({
      payload: {
        agentThreadId: "agent-early",
        parentThreadId: "thread-1",
        stableKey: "codex:item:shared-message:thread:agent-early",
      },
    });
    expect(started).toMatchObject({ payload: { agentNickname: "Scout", agentThreadId: "agent-early" } });
  });

  it("does not enroll an unrelated warm-connection thread from an item notification", () => {
    const state = appServerState();
    const events = Array.from(mapAppServerNotification({
      method: "item/completed",
      params: {
        item: { id: "stray-message", text: "ignore me", type: "agentMessage" },
        threadId: "unrelated-thread",
        turnId: "unrelated-turn",
      },
    }, state));

    expect(events).toEqual([]);
    expect(state.subagentThreadIds.has("unrelated-thread")).toBe(false);
  });

  it("keeps child item keys distinct when Codex reuses an item id", () => {
    const state = appServerState();
    state.subagentThreadIds.add("agent-a");
    state.subagentThreadIds.add("agent-b");
    const childEvent = (threadId: string) => Array.from(mapAppServerNotification({
      method: "item/completed",
      params: {
        item: { id: "same-item", text: "done", type: "agentMessage" },
        threadId,
        turnId: "child-turn",
      },
    }, state))[0];

    expect(childEvent("agent-a")?.payload?.stableKey).toBe("codex:item:same-item:thread:agent-a");
    expect(childEvent("agent-b")?.payload?.stableKey).toBe("codex:item:same-item:thread:agent-b");
  });

  it("maps completed child activity to a terminal agent status", () => {
    const state = appServerState();
    state.subagentThreadIds.add("agent-1");
    const [event] = Array.from(mapAppServerNotification({
      method: "item/completed",
      params: {
        item: { agentThreadId: "agent-1", id: "activity-1", kind: "completed", type: "subAgentActivity" },
        threadId: "thread-1",
        turnId: "turn-1",
      },
    }, state));

    expect(event).toMatchObject({
      payload: { agentStatus: "completed", agentThreadId: "agent-1", status: "completed" },
    });
  });

  it("rejects an early steering request when turn start fails instead of waiting forever", async () => {
    let rejectTurnStart!: (error: Error) => void;
    const connection: CodexAppServerConnection = {
      close: vi.fn(async () => undefined),
      async *notifications() {
        return;
      },
      notify: vi.fn(),
      async request<T = unknown>(method: string, _params: unknown): Promise<T> {
        if (method === "thread/start") return { thread: { id: "thread-1" } } as T;
        if (method === "turn/start") {
          return await new Promise((_, reject) => {
            rejectTurnStart = reject as (error: Error) => void;
          });
        }
        return {} as T;
      },
      respond: vi.fn(),
    };
    const adapter = createCodexAdapter({ pool: fakePool(connection) });
    const iterator = adapter.run({
      harnessThreadId: null,
      prompt: "start",
      runId: "run-steer-before-start",
      workspacePath: "/tmp",
    })[Symbol.asyncIterator]();

    await iterator.next();
    const pendingNext = iterator.next();
    await vi.waitFor(() => expect(rejectTurnStart).toBeTypeOf("function"));
    const steering = adapter.sendUserInput({
      prompt: "stop",
      runId: "run-steer-before-start",
      threadId: "lite-thread-1",
    });
    rejectTurnStart(new Error("turn start failed"));

    await expect(steering).rejects.toThrow("turn start failed");
    await pendingNext;
  });

  it("ends promptly when canceled while app-server turn start is still pending", async () => {
    const connection: CodexAppServerConnection = {
      close: vi.fn(async () => undefined),
      async *notifications() {
        return;
      },
      notify: vi.fn(),
      async request<T = unknown>(method: string, _params: unknown): Promise<T> {
        if (method === "thread/start") return { thread: { id: "thread-1" } } as T;
        if (method === "turn/start") return await new Promise<T>(() => undefined);
        return {} as T;
      },
      respond: vi.fn(),
    };
    const adapter = createCodexAdapter({ pool: fakePool(connection) });
    const controller = new AbortController();
    const iterator = adapter.run({
      harnessThreadId: null,
      prompt: "start",
      runId: "run-abort-before-start",
      signal: controller.signal,
      workspacePath: "/tmp",
    })[Symbol.asyncIterator]();

    await iterator.next();
    const pendingNext = iterator.next();
    controller.abort();

    await expect(pendingNext).resolves.toMatchObject({
      value: { text: expect.stringContaining("request canceled: turn/start"), type: "run.failed" },
    });
  });
});

function appServerState() {
  return {
    attachmentMessages: new Map(),
    agentMessageStreams: new Map<string, { lastEmittedAt: number; text: string }>(),
    initialUserMessageId: null,
    pendingChildNotifications: [],
    runId: "run-1",
    subagentMetadata: new Map<string, {
      agentNickname: string | null;
      agentRole: string | null;
      parentThreadId: string | null;
    }>(),
    subagentThreadIds: new Set<string>(),
    subagentTurnIds: new Map<string, string>(),
    subagentUserMessageIds: new Set<string>(),
    threadId: "thread-1",
    turnId: "turn-1",
  };
}

function completedTurnNotification(): AppServerMessage {
  return {
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "completed",
      },
    },
  };
}

function fakePool(connection: CodexAppServerConnection): CodexAppServerPoolLike {
  return {
    acquire: async () => ({
      connection,
      bindThread: vi.fn(),
      release: vi.fn(),
    }),
    close: vi.fn(async () => undefined),
    warm: vi.fn(async () => undefined),
  };
}

function fakeRunConnection(notifications: AppServerMessage[]): CodexAppServerConnection {
  return {
    close: vi.fn(async () => undefined),
    async *notifications() {
      yield* notifications;
    },
    notify: vi.fn(),
    async request<T = unknown>(method: string, _params: unknown): Promise<T> {
      if (method === "thread/start") {
        return { thread: { id: "thread-1" } } as T;
      }
      if (method === "turn/start") {
        return { turn: { id: "turn-1" } } as T;
      }
      return {} as T;
    },
    respond: vi.fn(),
  };
}
