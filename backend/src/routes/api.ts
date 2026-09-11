import { registerAssetRoutes } from "../assets/assetRoutes.js";
import { createReadStream } from "node:fs";
import { AttachmentStorage, maxAttachmentBytes, maxMessageAttachments, publicAttachment, type HarnessAttachment } from "../attachments/attachments.js";
import { stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  applyCompactionHandoffToPrompt,
  createThreadCompactor,
  latestCompactionHandoff,
  type ThreadCompactor,
} from "../compaction/threadCompactor.js";
import type { TimelineHub } from "../events/timelineHub.js";
import type { HarnessRegistry } from "../harnesses/registry.js";
import type {
  HarnessAdapter,
  HarnessEvent,
  HarnessInputQuestion,
} from "../harnesses/types.js";
import { createEventTranscriber, type EventTranscriber } from "../transcription/eventTranscriber.js";
import type { LiteHarnessStore } from "../db/store.js";
import {
  allocatePreviewPublishPort,
  resolvePreviewPublishSource,
  TailscalePreviewPublisher,
  type PreviewPublishSource,
} from "../previews/previewPublisher.js";
import { PreviewProxyManager, PreviewProxyPortUnavailableError } from "../previews/previewProxy.js";
import {
  buildPreviewWiringLaunchPrompt,
  buildPreviewWiringPrompt,
  writePreviewWiringPromptFile,
} from "../previews/previewWiringPrompt.js";
import { readPreviewRuntimeConfig, type PreviewRuntimeConfig } from "../previews/previewConfig.js";
import type {
  HarnessType,
  PreviewPublishedOrigin,
  RunRecord,
  ThreadRecord,
  TimelineEventRecord,
  WiredPreview,
  WorkspaceDiscovery,
} from "../types.js";
import { discoverWorkspace, WorkspaceDiscoveryError } from "../workspaces/workspaceDiscovery.js";
import {
  defaultExecutionProfileId,
  isExecutionProfileId,
  listExecutionProfileSummaries,
  resolveExecutionProfile,
} from "../profiles/executionProfiles.js";

const createThreadSchema = z.object({
  fastMode: z.boolean().optional(),
  harnessType: z.literal("codex").default("codex"),
  profileId: z.string().refine(isExecutionProfileId).optional().default(defaultExecutionProfileId),
  title: z.string().trim().min(1).max(120).optional(),
  workspacePath: z.string().trim().min(1).optional(),
});

const discoverWorkspaceSchema = z.object({
  description: z.string().trim().min(1).max(500),
  harnessType: z.literal("codex").default("codex"),
});

const messageFields = {
  prompt: z.string().trim().default(""),
  attachmentIds: z.array(z.string().uuid()).max(maxMessageAttachments).default([]),
};
const hasMessage = (value: { prompt: string; attachmentIds: string[] }) => Boolean(value.prompt || value.attachmentIds.length);
const createRunSchema = z.object({ ...messageFields, fastMode: z.boolean().optional() }).refine(hasMessage, "A message or file is required");
const runUserInputSchema = z.object(messageFields).refine(hasMessage, "A message or file is required");

const approvalResponseSchema = z.object({
  approved: z.boolean(),
}).strict();

const inputResponseSchema = z.object({
  answers: z.record(z.string().trim().min(1), z.union([
    z.string(),
    z.array(z.string()),
  ])),
});

const updateThreadSchema = z.object({
  fastMode: z.boolean().optional(),
  profileId: z.string().refine(isExecutionProfileId).optional(),
  title: z.string().trim().min(1).max(120).optional(),
}).strict().refine(
  (value) => value.fastMode !== undefined || value.profileId !== undefined || value.title !== undefined,
  { message: "At least one thread setting is required" },
);

const httpUrlSchema = z.string().trim().min(1).superRefine((value, context) => {
  if (!normalizePreviewUrl(value)) {
    context.addIssue({
      code: "custom",
      message: "url must be a valid http or https URL",
    });
  }
}).transform((value) => normalizePreviewUrl(value) ?? value);

const previewTargetSchema = z.object({
  name: z.string().trim().min(1).default("App"),
  url: httpUrlSchema,
}).strict();

const previewDependencyServiceSchema = z.object({
  browserDirect: z.boolean().default(false),
  name: z.string().trim().min(1),
  url: httpUrlSchema,
}).strict();

const previewCommandSchema = z.object({
  command: z.string().trim().min(1),
  cwd: z.string().trim().min(1),
  label: z.string().trim().min(1),
}).strict();

const previewPublishedOriginInputSchema = z.object({
  name: z.string().trim().min(1),
  url: httpUrlSchema,
}).strict();

const wiredPreviewInputSchema = z.object({
  commands: z.array(previewCommandSchema).default([]),
  dependencyServices: z.array(previewDependencyServiceSchema).default([]),
  name: z.string().trim().min(1),
  projectDirectory: z.string().trim().min(1),
  requestedPublishedOrigins: z.array(previewPublishedOriginInputSchema).default([]),
  target: previewTargetSchema,
}).strict();

const previewManifestInputSchema = wiredPreviewInputSchema.extend({
  wiredPreviewId: z.string().trim().min(1).optional(),
  wiringThreadId: z.string().trim().min(1).optional(),
}).strict();

const approvePreviewManifestSchema = z.object({
  name: z.string().trim().min(1),
}).strict();

const attachWiredPreviewSchema = z.object({
  wiredPreviewId: z.string().trim().min(1),
}).strict();

const publishPreviewOriginSchema = z.object({
  dependencyServiceIndex: z.number().int().min(0).optional(),
  httpsPort: z.number().int().min(1).max(65535).optional(),
  source: z.enum(["target", "dependencyService", "browserDirectDependencyServices"]).default("target"),
}).strict().default({ source: "target" }).superRefine((value, context) => {
  if (value.source === "dependencyService" && value.dependencyServiceIndex === undefined) {
    context.addIssue({
      code: "custom",
      message: "dependencyServiceIndex is required for dependencyService publishing",
      path: ["dependencyServiceIndex"],
    });
  }
  if (value.source !== "dependencyService" && value.dependencyServiceIndex !== undefined) {
    context.addIssue({
      code: "custom",
      message: "dependencyServiceIndex is only allowed for dependencyService publishing",
      path: ["dependencyServiceIndex"],
    });
  }
  if (value.source === "browserDirectDependencyServices" && value.httpsPort !== undefined) {
    context.addIssue({
      code: "custom",
      message: "httpsPort is only allowed when publishing one origin",
      path: ["httpsPort"],
    });
  }
});

const launchPreviewWiringThreadSchema = z.object({
  projectSearchBrief: z.string().trim().min(1),
  sourceThreadId: z.string().trim().min(1).optional(),
  wiredPreviewId: z.string().trim().min(1).optional(),
}).strict();

const runOwnerHeartbeatMs = 1_500;
const runOwnerLeaseTtlMs = 60_000;
const deviceIdHeaderName = "x-liteharness-device-id";
const fallbackDeviceId = "liteharness-default-device";
const deviceIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

type PreviewPublisher = Pick<TailscalePreviewPublisher, "publishProxyTarget" | "publishTarget" | "unpublish">;

export async function registerApiRoutes(app: FastifyInstance, input: {
  harnesses: HarnessRegistry;
  hub: TimelineHub;
  store: LiteHarnessStore;
  compactor?: ThreadCompactor;
  previewConfig?: PreviewRuntimeConfig;
  previewProxyManager?: PreviewProxyManager;
  previewPublisher?: PreviewPublisher;
  transcriber?: EventTranscriber;
}): Promise<void> {
  const { harnesses, hub, store } = input;
  const fileAssets = registerAssetRoutes(app, store, hub, readDeviceId);
  const attachments = new AttachmentStorage(store.attachmentDirectory);
  async function resolveAttachments(threadId: string, ids: string[]): Promise<HarnessAttachment[]> {
    const files = await Promise.all([...new Set(ids)].map(id => attachments.get(threadId, id)));
    if (files.some(file => !file)) throw Object.assign(new Error("Attachment not found in this thread"), { statusCode: 400 });
    for (const file of files) {
      if (!file || !(await stat(file.path).catch(() => null))?.isFile()) throw Object.assign(new Error("Attachment file is unavailable; upload it again"), { statusCode: 400 });
    }
    return files as HarnessAttachment[];
  }
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: maxAttachmentBytes }, (_request, body, done) => done(null, body));
  app.post("/api/threads/:threadId/attachments", {
    bodyLimit: maxAttachmentBytes,
    onRequest: async (request, reply) => {
      const { threadId } = request.params as { threadId: string };
      if (!store.getThreadForDevice(threadId, readDeviceId(request))) return reply.code(404).send({ error: "Thread not found" });
    },
  }, async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const query = z.object({ name: z.string().trim().min(1).max(255) }).safeParse(request.query);
    if (!query.success || !Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "A filename and file bytes are required" });
    const file = await attachments.save(threadId, query.data.name, request.body);
    return reply.code(201).send(publicAttachment(file));
  });
  app.get("/api/threads/:threadId/attachments/:attachmentId", async (request, reply) => {
    const { threadId, attachmentId } = request.params as { threadId: string; attachmentId: string };
    if (!store.getThreadForDevice(threadId, readDeviceId(request))) return reply.code(404).send({ error: "Thread not found" });
    const file = await attachments.get(threadId, attachmentId);
    if (!file) return reply.code(404).send({ error: "Attachment not found" });
    reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Cache-Control", "private, no-store");
    return reply.type("application/octet-stream").send(createReadStream(file.path));
  });
  const transcriber = input.transcriber ?? createEventTranscriber();
  const compactor = input.compactor ?? createThreadCompactor({ store });
  const previewConfig = input.previewConfig ?? readPreviewRuntimeConfig();
  const previewProxyManager = input.previewProxyManager ?? new PreviewProxyManager(previewConfig);
  const previewPublisher = input.previewPublisher ?? new TailscalePreviewPublisher(previewConfig);
  const ownsPreviewProxyManager = !input.previewProxyManager;
  const activeRunIds = new Set<string>();
  const activeRunControllers = new Map<string, AbortController>();
  const activeRunTasks = new Map<string, Promise<void>>();
  const runOwnerId = `liteharness:${process.pid}:${randomUUID()}`;

  app.addHook("onReady", async () => {
    await reconcilePublishedPreviewProxies({ app, previewProxyManager, previewPublisher, store });
  });

  app.addHook("onClose", async () => {
    if (ownsPreviewProxyManager) {
      await previewProxyManager.closeAll();
    }
  });

  app.get("/api/health", async () => ({
    name: "liteharness",
    ok: true,
  }));

  app.get("/api/config", async () => ({
    defaultProfileId: defaultExecutionProfileId,
    defaultWorkspacePath: homedir(),
    profiles: harnesses.get("codex")?.listExecutionProfiles?.() ?? listExecutionProfileSummaries(),
  }));

  app.get("/api/harnesses", async () => Array.from(harnesses.values()).map((adapter) => ({
    capabilities: adapter.capabilities,
    label: adapter.label,
    type: adapter.type,
  })));

  app.get("/api/threads", async (request) => {
    const deviceId = readDeviceId(request);
    store.claimUnownedThreadsForDevice(deviceId);
    for (const thread of store.listThreadsForDevice(deviceId)) {
      releaseStaleRunLeases({ activeRunIds, store, threadId: thread.id });
    }
    return store.listThreadsForDevice(deviceId);
  });

  app.get("/api/threads/closed", async (request) => store.listClosedThreadsForDevice(readDeviceId(request)));

  app.post("/api/threads/close", async (request, reply) => {
    const parsed = z.object({ threadIds: z.array(z.string().min(1)).min(1).max(500) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Provide 1–500 thread IDs" });
    const deviceId = readDeviceId(request);
    const closedIds: string[] = [];
    const skippedIds: string[] = [];
    // No awaits: validation and writes cannot race a new Run on this process.
    for (const id of new Set(parsed.data.threadIds)) {
      const owned = store.getThreadForDevice(id, deviceId, true);
      if (!owned) { skippedIds.push(id); continue; }
      releaseStaleRunLeases({ activeRunIds, store, threadId: id });
      const thread = store.getThreadForDevice(id, deviceId, true)!;
      if (isActiveThreadStatus(thread.status)) { skippedIds.push(id); continue; }
      closedIds.push(id);
    }
    store.setThreadsClosed(closedIds, true);
    return { closedIds, skippedIds };
  });

  app.post("/api/threads/:threadId/reopen", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    if (!store.getThreadForDevice(threadId, readDeviceId(request), true)) {
      return reply.code(404).send({ error: "Thread not found" });
    }
    return store.setThreadClosed(threadId, false);
  });

  app.post("/api/workspaces/discover", async (request, reply) => {
    const parsed = discoverWorkspaceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const adapter = harnesses.get(parsed.data.harnessType);
    if (!adapter) {
      return reply.code(400).send({ error: "Unsupported harness type" });
    }

    try {
      return await discoverWorkspace({
        adapter,
        defaultWorkspacePath: homedir(),
        description: parsed.data.description,
      });
    } catch (error) {
      if (error instanceof WorkspaceDiscoveryError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post("/api/workspaces/discover/stream", async (request, reply) => {
    const parsed = discoverWorkspaceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const adapter = harnesses.get(parsed.data.harnessType);
    if (!adapter) {
      return reply.code(400).send({ error: "Unsupported harness type" });
    }

    reply.header("cache-control", "no-cache");
    reply.header("x-content-type-options", "nosniff");
    reply.type("application/x-ndjson");
    return reply.send(Readable.from(streamWorkspaceDiscovery({
      adapter,
      defaultWorkspacePath: homedir(),
      description: parsed.data.description,
    })));
  });

  app.patch("/api/threads/:threadId", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    if (!store.getThreadForDevice(threadId, readDeviceId(request))) {
      return reply.code(404).send({ error: "Thread not found" });
    }

    const parsed = updateThreadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const profile = parsed.data.profileId
      ? resolveExecutionProfile(parsed.data.profileId)
      : null;
    return store.updateThread({
      ...(profile
        ? {
            fastMode: parsed.data.fastMode ?? profile.fastMode,
            profileId: profile.id,
          }
        : parsed.data.fastMode === undefined
          ? {}
          : { fastMode: parsed.data.fastMode }),
      id: threadId,
      ...(parsed.data.title === undefined ? {} : { title: parsed.data.title }),
    });
  });

  app.delete("/api/threads/:threadId", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const deviceId = readDeviceId(request);
    let thread = store.getThreadForDevice(threadId, deviceId);
    if (!thread) {
      return reply.code(404).send({ error: "Thread not found" });
    }
    releaseStaleRunLeases({ activeRunIds, store, threadId });
    thread = store.getThreadForDevice(threadId, deviceId) ?? thread;
    if (isActiveThreadStatus(thread.status)) {
      return reply.code(409).send({ error: "Thread is running" });
    }

    store.deleteThread(threadId);
    return reply.code(204).send();
  });

  app.post("/api/threads/:threadId/compact", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const deviceId = readDeviceId(request);
    let thread = store.getThreadForDevice(threadId, deviceId);
    if (!thread) {
      return reply.code(404).send({ error: "Thread not found" });
    }
    releaseStaleRunLeases({ activeRunIds, store, threadId });
    thread = store.getThreadForDevice(threadId, deviceId) ?? thread;
    if (isActiveThreadStatus(thread.status)) {
      return reply.code(409).send({ error: "Thread is running" });
    }

    const result = await compactor.compactThread({ force: true, thread, trigger: "manual" });
    if (result.event) {
      hub.publish(result.event);
    }
    return result;
  });

  app.post("/api/threads", async (request, reply) => {
    const deviceId = readDeviceId(request);
    const parsed = createThreadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const workspacePath = parsed.data.workspacePath ?? homedir();
    const exists = await isDirectory(workspacePath);
    if (!exists) {
      return reply.code(400).send({ error: "Workspace path must exist and be a directory" });
    }

    const adapter = harnesses.get(parsed.data.harnessType);
    if (!adapter) {
      return reply.code(400).send({ error: "Unsupported harness type" });
    }

    const profile = resolveExecutionProfile(parsed.data.profileId);
    const fastMode = parsed.data.fastMode ?? profile.fastMode;
    store.rememberWorkspace(workspacePath);
    const thread = store.createThread({
      deviceId,
      fastMode,
      harnessThreadId: null,
      harnessType: parsed.data.harnessType,
      profileId: profile.id,
      title: parsed.data.title ?? titleFromWorkspace(workspacePath),
      workspacePath,
    });
    return reply.code(201).send(thread);
  });

  app.get("/api/threads/:threadId/timeline", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    if (!store.getThreadForDevice(threadId, readDeviceId(request))) {
      return reply.code(404).send({ error: "Thread not found" });
    }
    return store.listTimeline(threadId);
  });

  app.get("/api/threads/:threadId/state", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const deviceId = readDeviceId(request);
    let thread = store.getThreadForDevice(threadId, deviceId);
    if (!thread) {
      return reply.code(404).send({ error: "Thread not found" });
    }
    releaseStaleRunLeases({ activeRunIds, store, threadId });
    thread = store.getThreadForDevice(threadId, deviceId) ?? thread;
    return {
      serverTime: new Date().toISOString(),
      thread,
      timeline: store.listTimeline(threadId),
    };
  });

  app.post("/api/threads/:threadId/runs", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const deviceId = readDeviceId(request);
    let thread = store.getThreadForDevice(threadId, deviceId);
    if (!thread) {
      return reply.code(404).send({ error: "Thread not found" });
    }
    releaseStaleRunLeases({ activeRunIds, store, threadId });
    thread = store.getThreadForDevice(threadId, deviceId) ?? thread;

    const parsed = createRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const messageAttachments = await resolveAttachments(thread.id, parsed.data.attachmentIds);
    if (isActiveThreadStatus(thread.status)) {
      return reply.code(409).send({ error: "Thread is running" });
    }

    const adapter = harnesses.get(thread.harnessType);
    if (!adapter) {
      return reply.code(400).send({ error: "Unsupported harness type" });
    }

    if (hasMissingHarnessRolloutFailure(store, thread)) {
      thread = store.updateThread({ harnessThreadId: null, id: thread.id }) ?? thread;
    }

    const run = startHarnessRun({
      fileAssets,
      activeRunControllers,
      activeRunTasks,
      activeRunIds,
      adapterType: thread.harnessType,
      harnesses,
      hub,
      fastMode: adapter.capabilities.fastMode
        ? parsed.data.fastMode ?? thread.fastMode
        : false,
      ownerId: runOwnerId,
      ...(messageAttachments.length ? { attachments: messageAttachments } : {}),
      prompt: parsed.data.prompt,
      store,
      thread,
      transcriber,
    });
    return reply.code(202).send(run);
  });

  app.post("/api/threads/:threadId/runs/cancel", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const thread = store.getThreadForDevice(threadId, readDeviceId(request));
    if (!thread) {
      return reply.code(404).send({ error: "Thread not found" });
    }
    const runs = store.listActiveRuns().filter((run) => run.threadId === thread.id);
    if (runs.length === 0) {
      store.updateThread({ id: thread.id, status: "idle" });
      return reply.code(409).send({ error: "Thread has no active run" });
    }

    for (const run of runs) {
      const controller = activeRunControllers.get(run.id);
      if (controller) controller.abort();
      else {
        store.updateRunStatus(run.id, "canceled");
        store.updateThread({ id: thread.id, status: "idle" });
        hub.publish(persistHarnessEvent(store, thread.id, run.id, {
          type: "run.canceled", text: "Run canceled.", payload: { liteharnessType: "lifecycle", stableKey: `run:${run.id}:canceled` },
        }));
      }
    }
    // Keep the Run active until the adapter has drained interruption/cleanup.
    // A slow adapter may return canceling; the eventual terminal event releases it.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(runs.map(run => activeRunTasks.get(run.id))),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 5_000); }),
    ]);
    if (timer) clearTimeout(timer);
    return reply.code(202).send({ ok: true, canceling: runs.some(run => activeRunIds.has(run.id)) });
  });

  app.post("/api/threads/:threadId/runs/input", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const deviceId = readDeviceId(request);
    let thread = store.getThreadForDevice(threadId, deviceId);
    if (!thread) {
      return reply.code(404).send({ error: "Thread not found" });
    }
    releaseStaleRunLeases({ activeRunIds, store, threadId });
    thread = store.getThreadForDevice(threadId, deviceId) ?? thread;

    const parsed = runUserInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const messageAttachments = await resolveAttachments(thread.id, parsed.data.attachmentIds);
    const run = latestActiveRunForThread(store, thread.id);
    if (!run || !isActiveThreadStatus(thread.status)) {
      return reply.code(409).send({ error: "Thread has no active run" });
    }

    const adapter = harnesses.get(thread.harnessType);
    if (!adapter) {
      return reply.code(400).send({ error: "Unsupported harness type" });
    }
    if (!adapter.capabilities.userInput) {
      return reply.code(409).send({ error: "Harness does not support active run input" });
    }

    let adapterEvent: HarnessEvent | null | void;
    try {
      adapterEvent = await adapter.sendUserInput({
        ...(messageAttachments.length ? { attachments: messageAttachments } : {}),
        prompt: parsed.data.prompt,
        runId: run.id,
        threadId: thread.id,
      });
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
    }

    if (adapterEvent === null) {
      return reply.code(202).send({ event: null, ok: true });
    }

    const eventToPersist = adapterEvent ?? {
      payload: {
        liteharnessType: "user-prompt",
        stableKey: `run:${run.id}:steer:${randomUUID()}`,
      },
      text: parsed.data.prompt,
      type: "run.steered" as const,
    };
    const timelineEvent = persistHarnessEvent(store, thread.id, run.id, { ...eventToPersist, payload: { ...eventToPersist.payload, attachments: messageAttachments.map(publicAttachment) } });
    hub.publish(timelineEvent);
    return reply.code(202).send({ event: timelineEvent, ok: true });
  });

  app.post("/api/threads/:threadId/runs/agents/:agentThreadId/input", async (request, reply) => {
    const { threadId, agentThreadId } = request.params as { threadId: string; agentThreadId: string };
    const thread = store.getThreadForDevice(threadId, readDeviceId(request));
    if (!thread) return reply.code(404).send({ error: "Thread not found" });
    const parsed = runUserInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const messageAttachments = await resolveAttachments(thread.id, parsed.data.attachmentIds);
    const run = store.listActiveRuns().find(run => run.threadId === threadId && activeRunIds.has(run.id));
    if (!run || activeRunControllers.get(run.id)?.signal.aborted) return reply.code(409).send({ error: "Thread has no active run" });
    const adapter = harnesses.get(thread.harnessType);
    if (!adapter?.sendAgentInput) return reply.code(409).send({ error: "Harness does not support agent messages" });
    try {
      await adapter.sendAgentInput({ runId: run.id, agentThreadId, prompt: parsed.data.prompt, ...(messageAttachments.length ? { attachments: messageAttachments } : {}) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(/not active|no longer accepting/.test(message) ? 409 : 502).send({ error: message });
    }
    const event = persistHarnessEvent(store, thread.id, run.id, {
      type: "run.steered", text: parsed.data.prompt,
      payload: { attachments: messageAttachments.map(publicAttachment), agentThreadId, liteharnessType: "user-prompt", stableKey: `run:${run.id}:agent:${agentThreadId}:steer:${randomUUID()}` },
    });
    hub.publish(event);
    return reply.code(202).send({ ok: true, event });
  });

  app.post("/api/threads/:threadId/approval/:approvalId", async (request, reply) => {
    const { approvalId, threadId } = request.params as { approvalId: string; threadId: string };
    const thread = store.getThreadForDevice(threadId, readDeviceId(request));
    if (!thread) {
      return reply.code(404).send({ error: "Thread not found" });
    }

    const parsed = approvalResponseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const pending = findPendingApprovalRequest(store, threadId, approvalId);
    if (!pending) {
      return reply.code(404).send({ error: "Approval request not found" });
    }
    if (thread.status !== "needs_approval") {
      return reply.code(409).send({ error: "Thread is not waiting for approval" });
    }
    if (!pending.runId) {
      return reply.code(409).send({ error: "Approval request is not attached to a run" });
    }

    const adapter = harnesses.get(thread.harnessType);
    if (!adapter) {
      return reply.code(400).send({ error: "Unsupported harness type" });
    }

    store.updateRunStatus(pending.runId, "running");
    store.updateThread({ id: thread.id, status: "running" });
    try {
      await adapter.respondToApproval({
        approvalId,
        approved: parsed.data.approved,
      });
    } catch (error) {
      store.updateRunStatus(pending.runId, "needs_approval");
      store.updateThread({ id: thread.id, status: "needs_approval" });
      return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
    }

    const timelineEvent = persistHarnessEvent(store, thread.id, pending.runId, {
      payload: {
        approvalId,
        approved: parsed.data.approved,
        liteharnessType: "user-prompt",
        stableKey: `approval:${approvalId}:response`,
      },
      text: parsed.data.approved ? "Allowed" : "Denied",
      type: "approval.responded",
    });
    hub.publish(timelineEvent);

    return reply.code(202).send({ ok: true });
  });

  app.post("/api/threads/:threadId/input/:inputRequestId", async (request, reply) => {
    const { inputRequestId, threadId } = request.params as { inputRequestId: string; threadId: string };
    const thread = store.getThreadForDevice(threadId, readDeviceId(request));
    if (!thread) {
      return reply.code(404).send({ error: "Thread not found" });
    }

    const parsed = inputResponseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const pending = findPendingInputRequest(store, threadId, inputRequestId);
    if (!pending) {
      return reply.code(404).send({ error: "Input request not found" });
    }
    if (thread.status !== "needs_input") {
      return reply.code(409).send({ error: "Thread is not waiting for input" });
    }
    if (!pending.event.runId) {
      return reply.code(409).send({ error: "Input request is not attached to a run" });
    }

    const answers = normalizeInputAnswers(parsed.data.answers);
    const validationError = validateInputAnswers(pending.questions, answers);
    if (validationError) {
      return reply.code(400).send({ error: validationError });
    }

    const adapter = harnesses.get(thread.harnessType);
    if (!adapter) {
      return reply.code(400).send({ error: "Unsupported harness type" });
    }

    // Record only acknowledged delivery, so a transport failure remains retryable.
    // Mark running before delivery: the adapter may emit terminal output immediately.
    store.updateRunStatus(pending.event.runId, "running");
    store.updateThread({ id: thread.id, status: "running" });
    try {
      await adapter.respondToInput({ answers, inputRequestId });
    } catch (error) {
      if (store.getRun(pending.event.runId)?.status === "running") {
        store.updateRunStatus(pending.event.runId, "needs_input");
        store.updateThread({ id: thread.id, status: "needs_input" });
      }
      return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
    }
    const timelineEvent = persistHarnessEvent(store, thread.id, pending.event.runId, {
      payload: {
        answers,
        inputRequestId,
        liteharnessType: "user-prompt",
        stableKey: `input:${inputRequestId}:response`,
      },
      text: summarizeInputAnswers(pending.questions, answers),
      type: "input.responded",
    });
    hub.publish(timelineEvent);

    return reply.code(202).send({ ok: true });
  });

  app.get("/api/wired-previews", async (request) => {
    const url = new URL(request.url, "http://127.0.0.1");
    return store.listWiredPreviews(url.searchParams.get("search") ?? undefined);
  });

  app.post("/api/wired-previews", async (request, reply) => {
    const parsed = wiredPreviewInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    return reply.code(201).send(store.createWiredPreview(parsed.data));
  });

  app.get("/api/wired-previews/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const preview = store.getWiredPreview(id);
    if (!preview) {
      return reply.code(404).send({ error: "Wired Preview not found" });
    }
    return preview;
  });

  app.put("/api/wired-previews/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = wiredPreviewInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const updated = store.updateWiredPreview(id, parsed.data);
    if (!updated) {
      return reply.code(404).send({ error: "Wired Preview not found" });
    }
    return updated;
  });

  app.delete("/api/wired-previews/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const preview = store.getWiredPreview(id);
    if (!preview) {
      return reply.code(404).send({ error: "Wired Preview not found" });
    }
    await previewProxyManager.closeOrigins(preview.publishedOrigins);
    store.deleteWiredPreview(id);
    return reply.code(204).send();
  });

  app.put("/api/threads/:threadId/wired-preview", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const thread = store.getThreadForDevice(threadId, readDeviceId(request));
    if (!thread) {
      return reply.code(404).send({ error: "Thread not found" });
    }
    const parsed = attachWiredPreviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    if (!store.getWiredPreview(parsed.data.wiredPreviewId)) {
      return reply.code(404).send({ error: "Wired Preview not found" });
    }
    return store.updateThread({ id: thread.id, wiredPreviewId: parsed.data.wiredPreviewId });
  });

  app.delete("/api/threads/:threadId/wired-preview", async (request, reply) => {
    const { threadId } = request.params as { threadId: string };
    const thread = store.getThreadForDevice(threadId, readDeviceId(request));
    if (!thread) {
      return reply.code(404).send({ error: "Thread not found" });
    }
    return store.updateThread({ id: thread.id, wiredPreviewId: null });
  });

  app.get("/api/wired-previews/:id/published-origins", async (request, reply) => {
    const { id } = request.params as { id: string };
    const preview = store.getWiredPreview(id);
    if (!preview) {
      return reply.code(404).send({ error: "Wired Preview not found" });
    }
    return preview.publishedOrigins;
  });

  app.post("/api/wired-previews/:id/published-origins", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = publishPreviewOriginSchema.safeParse(request.body ?? undefined);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const preview = store.getWiredPreview(id);
    if (!preview) {
      return reply.code(404).send({ error: "Wired Preview not found" });
    }

    const sources = previewPublishSources(preview, parsed.data);
    if (sources === null) {
      return reply.code(400).send({ error: "Dependency Service not found" });
    }
    if (sources === "host-local") {
      return reply.code(400).send({ error: "Dependency Service is host-local; mark it browserDirect before publishing" });
    }
    if (sources.length === 0) {
      return reply.code(400).send({ error: "No browser-direct Dependency Services are available to publish" });
    }

    let updatedPreview = preview;
    const origins: PreviewPublishedOrigin[] = [];
    let failedError: string | null = null;
    for (const source of sources) {
      const httpsPort = parsed.data.httpsPort ?? allocatePreviewPublishPort(store.listWiredPreviews(), previewConfig);
      if (!httpsPort) {
        return reply.code(400).send({ error: "No Preview Publisher HTTPS ports are available" });
      }

      const originId = randomUUID();
      const resolved = resolvePreviewPublishSource(updatedPreview, source);
      const timestamp = new Date().toISOString();
      const provisionalOrigin: PreviewPublishedOrigin = {
        createdAt: timestamp,
        dependencyServiceIndex: resolved.dependencyServiceIndex,
        dependencyServiceName: resolved.dependencyServiceName,
        error: null,
        httpsPort,
        id: originId,
        localProxyPort: null,
        name: resolved.name,
        provider: "tailscale-serve",
        publishedUrl: null,
        source: resolved.source,
        sourceUrl: resolved.sourceUrl,
        status: "published",
        updatedAt: timestamp,
      };

      let proxiedOrigin: PreviewPublishedOrigin;
      try {
        proxiedOrigin = await previewProxyManager.ensure(provisionalOrigin);
      } catch (error) {
        if (error instanceof PreviewProxyPortUnavailableError) {
          return reply.code(400).send({ error: "No Preview Proxy ports are available" });
        }
        throw error;
      }

      const published = await previewPublisher.publishTarget({
        httpsPort,
        localProxyPort: proxiedOrigin.localProxyPort ?? httpsPort,
        originId,
        preview: updatedPreview,
        source,
      });
      if (!published.ok) {
        await previewProxyManager.close(originId);
      } else {
        await previewProxyManager.ensure(published.origin);
      }

      const updated = store.savePublishedOrigin(preview.id, published.origin);
      if (!updated) {
        await previewProxyManager.close(originId);
        return reply.code(404).send({ error: "Wired Preview not found" });
      }

      updatedPreview = updated;
      origins.push(published.origin);
      if (!published.ok) {
        failedError = published.origin.error ?? "Failed to publish Preview Origin";
        break;
      }
    }

    const payload = { origin: origins[0] ?? null, origins, wiredPreview: updatedPreview };
    return reply.code(failedError ? 502 : 201).send(failedError ? { ...payload, error: failedError } : payload);
  });

  app.delete("/api/wired-previews/:id/published-origins/:originId", async (request, reply) => {
    const { id, originId } = request.params as { id: string; originId: string };
    const preview = store.getWiredPreview(id);
    if (!preview) {
      return reply.code(404).send({ error: "Wired Preview not found" });
    }
    const origin = preview.publishedOrigins.find((item) => item.id === originId);
    if (!origin) {
      return reply.code(404).send({ error: "Preview Published Origin not found" });
    }

    const unpublished = await previewPublisher.unpublish(origin);
    if (!unpublished.ok) {
      return reply.code(502).send({ error: unpublished.error ?? "Failed to unpublish Preview Published Origin" });
    }

    const updated = store.updatePublishedOrigin(preview.id, origin.id, { error: null, status: "unpublished" });
    const updatedOrigin = updated?.publishedOrigins.find((item) => item.id === origin.id) ?? null;
    if (!updated || !updatedOrigin) {
      return reply.code(404).send({ error: "Preview Published Origin not found" });
    }
    await previewProxyManager.close(origin.id);
    return { origin: updatedOrigin, wiredPreview: updated };
  });

  app.get("/api/preview-manifests", async (request, reply) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const status = url.searchParams.get("status");
    if (status !== null && status !== "pending" && status !== "approved") {
      return reply.code(400).send({ error: "status must be pending or approved" });
    }
    const parsedStatus = status === "pending" || status === "approved" ? status : undefined;
    return store.listPreviewManifests(parsedStatus);
  });

  app.post("/api/preview-manifests", async (request, reply) => {
    const parsed = previewManifestInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    if (parsed.data.wiredPreviewId && !store.getWiredPreview(parsed.data.wiredPreviewId)) {
      return reply.code(404).send({ error: "Wired Preview not found" });
    }
    const submitted = store.submitPreviewManifest(parsed.data);
    return reply.code(submitted.reused ? 200 : 201).send(submitted.manifest);
  });

  app.put("/api/preview-manifests/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = approvePreviewManifestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const approved = store.approvePreviewManifest(id, parsed.data.name);
    if (!approved) {
      return reply.code(404).send({ error: "Preview Manifest not found" });
    }
    return approved;
  });

  app.post("/api/preview-wiring-threads", async (request, reply) => {
    const deviceId = readDeviceId(request);
    const parsed = launchPreviewWiringThreadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const adapter = harnesses.get("codex");
    if (!adapter) {
      return reply.code(400).send({ error: "Unsupported harness type" });
    }
    const sourceThread = parsed.data.sourceThreadId ? store.getThreadForDevice(parsed.data.sourceThreadId, deviceId) : null;
    if (parsed.data.sourceThreadId && !sourceThread) {
      return reply.code(404).send({ error: "Thread not found" });
    }
    const wiredPreview = parsed.data.wiredPreviewId ? store.getWiredPreview(parsed.data.wiredPreviewId) : null;
    if (parsed.data.wiredPreviewId && !wiredPreview) {
      return reply.code(404).send({ error: "Wired Preview not found" });
    }

    const workspacePath = await previewWiringWorkspacePath(wiredPreview?.projectDirectory, sourceThread?.workspacePath);
    const thread = store.createThread({
      deviceId,
      harnessThreadId: null,
      harnessType: "codex",
      title: wiredPreview ? `Wire ${wiredPreview.name}` : "Wire Preview",
      workspacePath,
    });
    const fullPrompt = buildPreviewWiringPrompt({
      backendPort: previewConfig.backendPort,
      projectSearchBrief: parsed.data.projectSearchBrief,
      wiredPreview,
      wiringThreadId: thread.id,
    });
    const promptFilePath = writePreviewWiringPromptFile({
      prompt: fullPrompt,
      wiringThreadId: thread.id,
    });
    const prompt = buildPreviewWiringLaunchPrompt({
      backendPort: previewConfig.backendPort,
      promptFilePath,
    });
    const updatedWiredPreview = wiredPreview
      ? store.setWiredPreviewWiringThreadId(wiredPreview.id, thread.id) ?? wiredPreview
      : null;
    const run = startHarnessRun({
      fileAssets,
      activeRunControllers,
      activeRunTasks,
      activeRunIds,
      adapterType: "codex",
      harnesses,
      hub,
      fastMode: thread.fastMode,
      ownerId: runOwnerId,
      prompt,
      store,
      thread,
      transcriber,
    });
    return reply.code(201).send({
      prompt,
      reused: false,
      run,
      thread,
      wiredPreview: updatedWiredPreview,
    });
  });

  app.get("/api/ws", { websocket: true } as never, (connection: unknown, request: FastifyRequest) => {
    const socket = readSocket(connection);
    const url = new URL(request.url, "http://127.0.0.1");
    const threadId = url.searchParams.get("threadId");
    if (!threadId) {
      socket.close(1008, "threadId is required");
      return;
    }
    if (!store.getThreadForDevice(threadId, readDeviceId(request, url))) {
      socket.close(1008, "Thread not found");
      return;
    }

    const unsubscribe = hub.subscribe(threadId, (event) => {
      socket.send(JSON.stringify({ type: "timeline.event", event }));
    });
    const heartbeat = setInterval(() => {
      try {
        releaseStaleRunLeases({ activeRunIds, store, threadId });
        const thread = store.getThreadForDevice(threadId, readDeviceId(request, url));
        if (!thread) {
          socket.close(1008, "Thread not found");
          return;
        }
        socket.send(JSON.stringify({ serverTime: new Date().toISOString(), threadStatus: thread.status, type: "heartbeat" }));
      } catch {
        clearInterval(heartbeat);
      }
    }, 1_500);
    socket.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}

function startHarnessRun(input: {
  fileAssets: ReturnType<typeof registerAssetRoutes>;
  attachments?: HarnessAttachment[];
  activeRunControllers: Map<string, AbortController>;
  activeRunTasks: Map<string, Promise<void>>;
  activeRunIds: Set<string>;
  adapterType: HarnessType;
  fastMode: boolean;
  harnesses: HarnessRegistry;
  hub: TimelineHub;
  ownerId: string;
  prompt: string;
  store: LiteHarnessStore;
  thread: ThreadRecord;
  transcriber: EventTranscriber;
}): RunRecord {
  const createdRun = input.store.createRun({ prompt: input.prompt, threadId: input.thread.id });
  const run = input.store.updateRunStatus(createdRun.id, "running") ?? createdRun;
  const runningThread = input.store.updateThread({ id: input.thread.id, status: "running" }) ?? input.thread;
  const submittedEvent = input.store.recordTimelineEvent({
    payload: {
      liteharnessType: "user-prompt",
      stableKey: `run:${run.id}:submitted`,
      text: input.prompt,
      attachments: input.attachments?.map(publicAttachment),
    },
    runId: run.id,
    threadId: input.thread.id,
    type: "run.submitted",
  });
  input.hub.publish(submittedEvent);
  const controller = new AbortController();
  input.activeRunControllers.set(run.id, controller);
  const task = driveRun({
    fileAssets: input.fileAssets,
    attachments: input.attachments,
    activeRunControllers: input.activeRunControllers,
    activeRunIds: input.activeRunIds,
    adapterType: input.adapterType,
    fastMode: input.fastMode,
    harnesses: input.harnesses,
    hub: input.hub,
    ownerId: input.ownerId,
    prompt: input.prompt,
    run,
    signal: controller.signal,
    store: input.store,
    thread: runningThread,
    transcriber: input.transcriber,
  });
  input.activeRunTasks.set(run.id, task);
  void task.finally(() => input.activeRunTasks.delete(run.id));
  return run;
}

async function driveRun(input: {
  fileAssets: ReturnType<typeof registerAssetRoutes>;
  attachments?: HarnessAttachment[];
  activeRunControllers: Map<string, AbortController>;
  activeRunIds: Set<string>;
  adapterType: HarnessType;
  fastMode: boolean;
  harnesses: HarnessRegistry;
  hub: TimelineHub;
  ownerId: string;
  prompt: string;
  run: RunRecord;
  signal: AbortSignal;
  store: LiteHarnessStore;
  thread: ThreadRecord;
  transcriber: EventTranscriber;
}): Promise<void> {
  const adapter = input.harnesses.get(input.adapterType);
  if (!adapter) {
    return;
  }

  input.activeRunIds.add(input.run.id);
  let ownerHeartbeat: ReturnType<typeof setInterval> | null = null;
  let terminalEventSeen = false;

  try {
    input.store.claimRunOwner(input.run.id, input.ownerId);
    ownerHeartbeat = setInterval(() => {
      input.store.heartbeatRunOwner(input.run.id, input.ownerId);
    }, runOwnerHeartbeatMs);
    input.store.updateThread({ id: input.thread.id, status: "running" });
    const compactionHandoff = input.thread.harnessThreadId === null
      ? latestCompactionHandoff(input.store, input.thread.id)
      : null;

    const assetTools = input.fileAssets.prepare(input.run);
    input.signal.throwIfAborted();
    for await (const event of adapter.run({
      fileAssets: assetTools,
      attachments: input.attachments,
      harnessThreadId: input.thread.harnessThreadId,
      fastMode: input.fastMode,
      harnessPrompt: applyCompactionHandoffToPrompt(input.prompt, compactionHandoff),
      profileId: input.thread.profileId,
      prompt: input.prompt,
      liteHarnessThreadId: input.thread.id,
      runId: input.run.id,
      signal: input.signal,
      workspacePath: input.thread.workspacePath,
    })) {
      if (input.signal.aborted) {
        break;
      }
      const transcribedEvent = transcribeEvent(input.transcriber, event, {
        runId: input.run.id,
        threadId: input.thread.id,
        workspacePath: input.thread.workspacePath,
      });
      const timelineEvent = persistHarnessEvent(input.store, input.thread.id, input.run.id, transcribedEvent);
      input.hub.publish(timelineEvent);

      if (event.type === "approval.requested") {
        input.store.updateRunStatus(input.run.id, "needs_approval");
        input.store.updateThread({ id: input.thread.id, status: "needs_approval" });
      }
      if (event.type === "input.requested") {
        input.store.updateRunStatus(input.run.id, "needs_input");
        input.store.updateThread({ id: input.thread.id, status: "needs_input" });
      }
      if (event.type === "input.responded") {
        input.store.updateRunStatus(input.run.id, "running");
        input.store.updateThread({ id: input.thread.id, status: "running" });
      }
      if (event.type === "thread.started" && typeof event.payload?.harnessThreadId === "string") {
        input.store.updateThread({ harnessThreadId: event.payload.harnessThreadId, id: input.thread.id });
      }
      if (event.type === "run.failed") {
        terminalEventSeen = true;
        input.store.updateRunStatus(input.run.id, "failed");
        input.store.updateThread({ id: input.thread.id, status: "failed" });
      }
      if (event.type === "run.completed" || event.type === "run.canceled") {
        terminalEventSeen = true;
        input.store.updateRunStatus(input.run.id, event.type === "run.canceled" ? "canceled" : "completed");
        input.store.updateThread({ id: input.thread.id, status: "idle" });
      }
    }

    if (!terminalEventSeen && !input.signal.aborted) {
      await failRun({
        message: "Harness run ended without a terminal event.",
        runId: input.run.id,
        store: input.store,
        thread: input.thread,
        hub: input.hub,
        transcriber: input.transcriber,
      });
    }
  } catch (error) {
    if (!terminalEventSeen && !input.signal.aborted) {
      await failRun({
        message: error instanceof Error ? error.message : String(error),
        runId: input.run.id,
        store: input.store,
        thread: input.thread,
        hub: input.hub,
        transcriber: input.transcriber,
      });
    }
  } finally {
    input.fileAssets.finish(input.run.id);
    if (input.signal.aborted && input.store.getRun(input.run.id)?.status !== "canceled") {
      input.store.updateRunStatus(input.run.id, "canceled");
      input.store.updateThread({ id: input.thread.id, status: "idle" });
      input.hub.publish(persistHarnessEvent(input.store, input.thread.id, input.run.id, {
        type: "run.canceled", text: "Run canceled.", payload: { liteharnessType: "lifecycle", stableKey: `run:${input.run.id}:canceled` },
      }));
    }
    if (ownerHeartbeat) {
      clearInterval(ownerHeartbeat);
    }
    input.activeRunControllers.delete(input.run.id);
    input.activeRunIds.delete(input.run.id);
  }
}

function releaseStaleRunLeases(input: {
  activeRunIds: Set<string>;
  store: LiteHarnessStore;
  threadId: string;
}): void {
  const nowMs = Date.now();
  for (const run of input.store.listActiveRunLeases()) {
    if (run.threadId !== input.threadId) {
      continue;
    }
    if (input.activeRunIds.has(run.id)) {
      continue;
    }
    if (hasFreshRunOwnerLease(run, nowMs)) {
      continue;
    }
    const thread = input.store.getThread(run.threadId);
    if (!thread) {
      input.store.updateRunStatus(run.id, "failed");
      continue;
    }
    input.store.updateRunStatus(run.id, "failed");
    input.store.updateThread({ id: thread.id, status: "idle" });
  }
}

function readDeviceId(request: FastifyRequest, url?: URL): string {
  const queryDeviceId = url?.searchParams.get("deviceId");
  const headerDeviceId = readFirstHeader(request.headers[deviceIdHeaderName]);
  return normalizeDeviceId(queryDeviceId) ?? normalizeDeviceId(headerDeviceId) ?? fallbackDeviceId;
}

function readFirstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeDeviceId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !deviceIdPattern.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function hasFreshRunOwnerLease(run: {
  createdAt: string;
  ownerHeartbeatAt: string | null;
  ownerId: string | null;
  startedAt: string | null;
}, nowMs: number): boolean {
  const referenceAt = run.ownerHeartbeatAt ?? run.startedAt ?? run.createdAt;
  const referenceMs = Date.parse(referenceAt);
  if (!Number.isFinite(referenceMs)) {
    return false;
  }
  if (nowMs - referenceMs > runOwnerLeaseTtlMs) return false;
  const ownerPid = /^liteharness:([1-9]\d*):/.exec(run.ownerId ?? "")?.[1];
  if (ownerPid) {
    try {
      // Signal 0 checks existence without signaling the previous backend.
      process.kill(Number(ownerPid), 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    }
  }
  return true;
}

async function failRun(input: {
  hub: TimelineHub;
  message: string;
  runId: string;
  store: LiteHarnessStore;
  thread: ThreadRecord;
  transcriber: EventTranscriber;
}): Promise<void> {
  const failureEvent: HarnessEvent = {
    payload: { liteharnessType: "error" },
    text: input.message || "Run failed.",
    type: "run.failed",
  };
  const transcribedEvent = transcribeEvent(input.transcriber, failureEvent, {
    runId: input.runId,
    threadId: input.thread.id,
    workspacePath: input.thread.workspacePath,
  });
  const timelineEvent = persistHarnessEvent(input.store, input.thread.id, input.runId, transcribedEvent);
  input.store.updateRunStatus(input.runId, "failed");
  input.store.updateThread({ id: input.thread.id, status: "failed" });
  input.hub.publish(timelineEvent);
}

function transcribeEvent(
  transcriber: EventTranscriber,
  event: HarnessEvent,
  context: {
    runId: string;
    threadId: string;
    workspacePath: string;
  },
): HarnessEvent {
  try {
    return transcriber.transcribe(event, context);
  } catch {
    return event;
  }
}

function persistHarnessEvent(store: LiteHarnessStore, threadId: string, runId: string | null, event: HarnessEvent) {
  return store.recordTimelineEvent({
    payload: {
      liteharnessType: defaultLiteHarnessType(event.type),
      stableKey: defaultStableKey(threadId, runId ?? "thread", event),
      ...event.payload,
      ...(event.type === "approval.requested" ? { approvalId: event.approvalId } : {}),
      ...(event.type === "input.requested" ? {
        inputRequestId: event.inputRequestId,
        questions: event.questions,
      } : {}),
      text: event.text,
    },
    runId,
    threadId,
    type: event.type,
  });
}

function defaultLiteHarnessType(type: HarnessEvent["type"]): string {
  if (type === "harness.output") {
    return "assistant-message";
  }
  if (type === "run.failed") {
    return "error";
  }
  if (type === "approval.requested") {
    return "approval";
  }
  if (type === "approval.responded") {
    return "user-prompt";
  }
  if (type === "input.requested") {
    return "input";
  }
  if (type === "input.responded") {
    return "user-prompt";
  }
  if (type === "run.steered") {
    return "user-prompt";
  }
  return "lifecycle";
}

function defaultStableKey(threadId: string, runId: string, event: HarnessEvent): string | undefined {
  const type = event.type;
  if (type === "run.started" || type === "run.completed" || type === "run.failed") {
    return `run:${runId}:lifecycle`;
  }
  if (type === "thread.started") {
    return `thread:${threadId}:lifecycle`;
  }
  if (type === "input.requested") {
    return `input:${event.inputRequestId}:request`;
  }
  if (type === "input.responded") {
    const inputRequestId = typeof event.payload?.inputRequestId === "string" ? event.payload.inputRequestId : null;
    return inputRequestId ? `input:${inputRequestId}:response` : undefined;
  }
  if (type === "approval.responded") {
    const approvalId = typeof event.payload?.approvalId === "string" ? event.payload.approvalId : null;
    return approvalId ? `approval:${approvalId}:response` : undefined;
  }
  if (type === "run.steered") {
    const stableKey = typeof event.payload?.stableKey === "string" ? event.payload.stableKey : null;
    return stableKey ?? `run:${runId}:steer`;
  }
  return undefined;
}

function hasMissingHarnessRolloutFailure(store: LiteHarnessStore, thread: ThreadRecord): boolean {
  const harnessThreadId = thread.harnessThreadId;
  if (!harnessThreadId) {
    return false;
  }

  const expectedMessage = `no rollout found for thread id ${harnessThreadId}`;
  const timeline = store.listTimeline(thread.id);
  for (const event of timeline.toReversed()) {
    if (event.type !== "run.failed") {
      continue;
    }
    return readString(event.payload.text) === expectedMessage;
  }
  return false;
}

function latestActiveRunForThread(store: LiteHarnessStore, threadId: string): RunRecord | null {
  const runs = store.listActiveRuns().filter((run) => run.threadId === threadId);
  return runs.at(-1) ?? null;
}

function findPendingApprovalRequest(
  store: LiteHarnessStore,
  threadId: string,
  approvalId: string,
): TimelineEventRecord | null {
  const timeline = store.listTimeline(threadId);
  let requestEvent: TimelineEventRecord | null = null;
  for (const event of timeline) {
    if (event.type === "approval.requested" && event.payload.approvalId === approvalId) {
      requestEvent = event;
    }
  }
  if (!requestEvent) {
    return null;
  }
  const answered = timeline.some((event) => (
    event.sequence > requestEvent.sequence
    && event.type === "approval.responded"
    && event.payload.approvalId === approvalId
  ));
  return answered ? null : requestEvent;
}

function findPendingInputRequest(
  store: LiteHarnessStore,
  threadId: string,
  inputRequestId: string,
): { event: TimelineEventRecord; questions: HarnessInputQuestion[] } | null {
  const timeline = store.listTimeline(threadId);
  let requestEvent: TimelineEventRecord | null = null;
  for (const event of timeline) {
    if (event.type === "input.requested" && event.payload.inputRequestId === inputRequestId) {
      requestEvent = event;
    }
  }
  if (!requestEvent) {
    return null;
  }
  const answered = timeline.some((event) => (
    event.sequence > requestEvent.sequence
    && event.type === "input.responded"
    && event.payload.inputRequestId === inputRequestId
  ));
  if (answered) {
    return null;
  }
  const questions = readInputQuestions(requestEvent.payload.questions);
  return questions.length > 0 ? { event: requestEvent, questions } : null;
}

function normalizeInputAnswers(input: Record<string, string | string[]>): Record<string, string[]> {
  const answers: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(input)) {
    const values = Array.isArray(value) ? value : [value];
    const normalized = values.map((item) => item.trim()).filter(Boolean);
    if (normalized.length > 0) {
      answers[key] = normalized;
    }
  }
  return answers;
}

function validateInputAnswers(
  questions: HarnessInputQuestion[],
  answers: Record<string, string[]>,
): string | null {
  const questionIds = new Set(questions.map((question) => question.id));
  for (const answerId of Object.keys(answers)) {
    if (!questionIds.has(answerId)) {
      return `Unknown answer id: ${answerId}`;
    }
  }

  for (const question of questions) {
    const values = answers[question.id] ?? [];
    if (values.length === 0) {
      return `Missing answer for ${question.id}`;
    }
    if (question.options && values.length !== 1) {
      return `Choose one answer for ${question.id}`;
    }
    if (question.options && !question.allowOther) {
      const labels = new Set(question.options.map((option) => option.label));
      const invalid = values.find((value) => !labels.has(value));
      if (invalid) {
        return `Invalid answer for ${question.id}: ${invalid}`;
      }
    }
  }

  return null;
}

function summarizeInputAnswers(
  questions: HarnessInputQuestion[],
  answers: Record<string, string[]>,
): string {
  return questions.map((question) => {
    const values = answers[question.id] ?? [];
    return `${question.header || question.question}: ${values.join(", ")}`;
  }).join("\n");
}

function readInputQuestions(value: unknown): HarnessInputQuestion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const record = readRecord(item);
    const allowOther = record?.allowOther;
    const header = readString(record?.header);
    const id = readString(record?.id);
    const isSecret = record?.isSecret;
    const options = readInputOptions(record?.options);
    const question = readString(record?.question);
    if (typeof allowOther !== "boolean" || !header || !id || typeof isSecret !== "boolean" || !question) {
      return [];
    }
    return [{
      allowOther,
      header,
      id,
      isSecret,
      options,
      question,
    }];
  });
}

function readInputOptions(value: unknown): HarnessInputQuestion["options"] {
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const options = value.flatMap((item) => {
    const record = readRecord(item);
    const description = readString(record?.description);
    const label = readString(record?.label);
    return description && label ? [{ description, label }] : [];
  });
  return options.length > 0 ? options : null;
}

function normalizePreviewUrl(value: string): string | null {
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function previewPublishSources(
  preview: WiredPreview,
  input: z.infer<typeof publishPreviewOriginSchema>,
): PreviewPublishSource[] | "host-local" | null {
  if (input.source === "target") {
    return [{ type: "target" }];
  }

  if (input.source === "dependencyService") {
    const index = input.dependencyServiceIndex;
    if (index === undefined) {
      return null;
    }
    const service = preview.dependencyServices[index] ?? null;
    if (!service) {
      return null;
    }
    return service.browserDirect
      ? [{ service, serviceIndex: index, type: "dependency-service" }]
      : "host-local";
  }

  return preview.dependencyServices.flatMap((service, serviceIndex): PreviewPublishSource[] => (
    service.browserDirect ? [{ service, serviceIndex, type: "dependency-service" }] : []
  ));
}

async function previewWiringWorkspacePath(projectDirectory: string | undefined, sourceWorkspacePath: string | undefined): Promise<string> {
  if (projectDirectory && await isDirectory(projectDirectory)) {
    return projectDirectory;
  }
  if (sourceWorkspacePath && await isDirectory(sourceWorkspacePath)) {
    return sourceWorkspacePath;
  }
  return homedir();
}

type WorkspaceDiscoveryStreamEvent =
  | {
      text: string;
      type: "workspace.search.started" | "workspace.search.status";
    }
  | {
      discovery: WorkspaceDiscovery;
      text: string;
      type: "workspace.search.found";
    }
  | {
      error: string;
      text: string;
      type: "workspace.search.failed";
    };

async function* streamWorkspaceDiscovery(input: {
  adapter: HarnessAdapter;
  defaultWorkspacePath: string;
  description: string;
}): AsyncGenerator<string> {
  yield encodeWorkspaceDiscoveryEvent({
    text: `Searching ${input.description}`,
    type: "workspace.search.started",
  });
  yield encodeWorkspaceDiscoveryEvent({
    text: "Checking directories",
    type: "workspace.search.status",
  });

  try {
    const discovery = await discoverWorkspace(input);
    yield encodeWorkspaceDiscoveryEvent({
      discovery,
      text: `Found ${discovery.title}`,
      type: "workspace.search.found",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workspace discovery failed";
    yield encodeWorkspaceDiscoveryEvent({
      error: message,
      text: message,
      type: "workspace.search.failed",
    });
  }
}

function encodeWorkspaceDiscoveryEvent(event: WorkspaceDiscoveryStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

async function reconcilePublishedPreviewProxies(input: {
  app: FastifyInstance;
  previewProxyManager: PreviewProxyManager;
  previewPublisher: PreviewPublisher;
  store: LiteHarnessStore;
}): Promise<void> {
  for (const preview of input.store.listWiredPreviews()) {
    for (const origin of preview.publishedOrigins) {
      if (origin.status !== "published") {
        continue;
      }

      try {
        const ensured = await input.previewProxyManager.ensure(origin);
        if (ensured.localProxyPort !== origin.localProxyPort) {
          const republished = await input.previewPublisher.publishProxyTarget(ensured);
          if (republished.ok) {
            input.store.savePublishedOrigin(preview.id, ensured);
          } else {
            await input.previewProxyManager.close(origin.id);
            input.store.savePublishedOrigin(preview.id, {
              ...ensured,
              error: republished.error ?? "Failed to restore Preview Published Origin",
              status: "failed",
              updatedAt: new Date().toISOString(),
            });
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to restore Preview Proxy";
        input.app.log.warn({ error, originId: origin.id }, "Failed to restore Preview Proxy");
        input.store.savePublishedOrigin(preview.id, {
          ...origin,
          error: message,
          status: "failed",
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isActiveThreadStatus(status: ThreadRecord["status"]): boolean {
  return status === "running" || status === "needs_approval" || status === "needs_input";
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function titleFromWorkspace(workspacePath: string): string {
  return workspacePath.split("/").filter(Boolean).at(-1) ?? "Workspace";
}

function readSocket(connection: unknown): {
  close(code?: number, reason?: string): void;
  on(event: "close", listener: () => void): void;
  send(data: string): void;
} {
  const candidate = connection as {
    close?: (code?: number, reason?: string) => void;
    on?: (event: "close", listener: () => void) => void;
    send?: (data: string) => void;
    socket?: {
      close(code?: number, reason?: string): void;
      on(event: "close", listener: () => void): void;
      send(data: string): void;
    };
  };
  if (candidate.socket) {
    return candidate.socket;
  }
  return candidate as {
    close(code?: number, reason?: string): void;
    on(event: "close", listener: () => void): void;
    send(data: string): void;
  };
}
