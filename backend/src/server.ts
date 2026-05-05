import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyRequest } from "fastify";
import { AppStore } from "./appStore.js";
import { getCodexCapabilities } from "./codexCli.js";
import { readConfig, type OpenCozyConfig } from "./config.js";
import { PreviewManifestStore } from "./previewManifestStore.js";
import {
  buildPreviewWiringLaunchPrompt,
  buildPreviewWiringPrompt,
  writePreviewWiringPromptFile
} from "./previewWiringPrompt.js";
import { TerminalSessionManager } from "./terminalSessions.js";
import {
  parseAppShortcutInput,
  parseApprovePreviewManifestInput,
  parseAttachWiredPreviewInput,
  parseCreateOpenCozySessionInput,
  parseLaunchPreviewWiringSessionInput,
  parsePreviewManifestInput,
  parsePreviewManifestStatus,
  parsePublishPreviewOriginInput,
  parseRenameOpenCozySessionInput,
  parseWiredPreviewInput
} from "./validation.js";
import {
  allocatePreviewPublishPort,
  resolvePreviewPublishSource,
  TailscalePreviewPublisher,
  type PreviewPublishSource
} from "./previewPublisher.js";
import { PreviewProxyManager, PreviewProxyPortUnavailableError } from "./previewProxy.js";
import { readWanTunnelStatus } from "./wanTunnel.js";
import { WiredPreviewStore } from "./wiredPreviewStore.js";
import type { PreviewPublishedOrigin } from "./types.js";

type RouteParams = {
  id: string;
};
type PublishedOriginRouteParams = {
  id: string;
  originId: string;
};
type SessionListQuery = {
  deviceId?: string;
  tabId?: string | string[];
};
type WiredPreviewListQuery = {
  search?: string;
};
type PreviewManifestListQuery = {
  status?: string;
};
type ParsedHost = {
  host: string;
  hostname: string;
};

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function normalizeHostPart(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function parseHostLike(value: string | undefined): ParsedHost | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    const trimmed = value.trim();
    const url = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? new URL(trimmed) : new URL(`http://${trimmed}`);
    return {
      host: normalizeHostPart(url.host),
      hostname: normalizeHostPart(url.hostname)
    };
  } catch {
    return null;
  }
}

function isLoopbackHostname(value: string): boolean {
  return LOOPBACK_HOSTNAMES.has(normalizeHostPart(value));
}

function isLoopbackAddress(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = normalizeHostPart(value);
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1";
}

function makeAllowedHostSet(allowedHosts: string[] | undefined): Set<string> {
  const allowed = new Set<string>();
  for (const value of allowedHosts ?? []) {
    const parsed = parseHostLike(value);
    if (!parsed) {
      continue;
    }

    allowed.add(parsed.host);
    allowed.add(parsed.hostname);
  }

  return allowed;
}

function matchesAllowedHost(value: string | undefined, allowedHosts: Set<string>, request: FastifyRequest): boolean {
  const parsed = parseHostLike(value);
  if (!parsed) {
    return false;
  }

  if (allowedHosts.has(parsed.host) || allowedHosts.has(parsed.hostname)) {
    return true;
  }

  return isLoopbackHostname(parsed.hostname) && isLoopbackAddress(request.ip);
}

function isRequestAllowedByOrigin(request: FastifyRequest, allowedHosts: Set<string>): boolean {
  if (allowedHosts.size === 0) {
    return true;
  }

  if (!matchesAllowedHost(request.headers.host, allowedHosts, request)) {
    return false;
  }

  const origin = request.headers.origin;
  if (origin === undefined) {
    return true;
  }

  return typeof origin === "string" && matchesAllowedHost(origin, allowedHosts, request);
}

function readRouteId(requestUrl: string): string | null {
  const pathname = new URL(requestUrl, "http://opencozy.local").pathname;
  const match = /^\/api\/open-cozy-sessions\/([^/]+)\/socket\/?$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function shouldReplaySessionHistory(requestUrl: string): boolean {
  const replay = new URL(requestUrl, "http://opencozy.local").searchParams.get("replay");
  return replay !== "0" && replay !== "false";
}

function readDeviceIdQuery(value: unknown): string {
  if (value === undefined) {
    throw new Error("deviceId is required");
  }

  if (typeof value !== "string") {
    throw new Error("deviceId must be a non-empty string when provided");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("deviceId must be a non-empty string when provided");
  }

  return trimmed;
}

function readTabIdsQuery(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }

  const values = Array.isArray(value) ? value : [value];
  const tabIds: string[] = [];
  const seen = new Set<string>();
  for (const item of values) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error("tabId must be a non-empty string when provided");
    }

    const tabId = item.trim();
    if (!seen.has(tabId)) {
      seen.add(tabId);
      tabIds.push(tabId);
    }
  }

  return tabIds;
}

export function buildServer(config: OpenCozyConfig = readConfig()) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info"
    }
  });
  const appStore = new AppStore(config.dbPath);
  const wiredPreviewStore = new WiredPreviewStore(config.dbPath);
  const previewManifestStore = new PreviewManifestStore(wiredPreviewStore);
  const previewProxyManager = new PreviewProxyManager(config);
  const previewPublisher = new TailscalePreviewPublisher(config);
  const terminalSessions = new TerminalSessionManager(config);
  const allowedHosts = makeAllowedHostSet(config.allowedHosts);

  async function reconcilePublishedPreviewProxies(): Promise<void> {
    for (const preview of wiredPreviewStore.list()) {
      for (const origin of preview.publishedOrigins) {
        if (origin.status !== "published") {
          continue;
        }

        try {
          const ensured = await previewProxyManager.ensure(origin);
          if (ensured.localProxyPort !== origin.localProxyPort) {
            const republished = await previewPublisher.publishProxyTarget(ensured);
            if (republished.ok) {
              wiredPreviewStore.savePublishedOrigin(preview.id, ensured);
            } else {
              await previewProxyManager.close(origin.id);
              wiredPreviewStore.savePublishedOrigin(preview.id, {
                ...ensured,
                status: "failed",
                error: republished.error ?? "Failed to restore Preview Published Origin",
                updatedAt: nowIso()
              });
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to restore Preview Proxy";
          app.log.warn({ error, originId: origin.id }, "Failed to restore Preview Proxy");
          wiredPreviewStore.savePublishedOrigin(preview.id, {
            ...origin,
            status: "failed",
            error: message,
            updatedAt: nowIso()
          });
        }
      }
    }
  }

  app.addHook("onClose", async () => {
    terminalSessions.closeAll();
    await previewProxyManager.closeAll();
    wiredPreviewStore.close();
    appStore.close();
  });

  app.addHook("onReady", async () => {
    await reconcilePublishedPreviewProxies();
  });

  app.addHook("preValidation", async (request, reply) => {
    if (!isRequestAllowedByOrigin(request, allowedHosts)) {
      return reply.code(403).send({ error: "OpenCozy origin is not allowed" });
    }
  });

  app.register(websocket);
  app.register(async (wsRoutes) => {
    wsRoutes.get<{ Params: RouteParams }>("/api/open-cozy-sessions/:id/socket", { websocket: true }, (socket, request) => {
      const params = request.params as Partial<RouteParams> | undefined;
      const sessionId = params?.id ?? readRouteId(request.url);

      if (!sessionId || !terminalSessions.attach(sessionId, socket, { replayHistory: shouldReplaySessionHistory(request.url) })) {
        socket.close(1008, "OpenCozy session not found");
      }
    });
  });

  app.get("/api/health", async () => ({
    ok: true,
    name: "opencozy",
    codexHost: config.host,
    port: config.port
  }));

  app.get("/api/codex", async () => getCodexCapabilities(config.codexBin));

  app.get("/api/wan-tunnel", async () => readWanTunnelStatus(config));

  app.get("/api/apps", async () => appStore.list());

  app.post("/api/apps", async (request, reply) => {
    const parsed = parseAppShortcutInput(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.message });
    }

    return reply.code(201).send(appStore.create(parsed.value));
  });

  app.put<{ Params: RouteParams }>("/api/apps/:id", async (request, reply) => {
    const parsed = parseAppShortcutInput(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.message });
    }

    const updated = appStore.update(request.params.id, parsed.value);
    if (!updated) {
      return reply.code(404).send({ error: "LAN app shortcut not found" });
    }

    return updated;
  });

  app.delete<{ Params: RouteParams }>("/api/apps/:id", async (request, reply) => {
    if (!appStore.delete(request.params.id)) {
      return reply.code(404).send({ error: "LAN app shortcut not found" });
    }

    return reply.code(204).send();
  });

  app.get<{ Querystring: WiredPreviewListQuery }>("/api/wired-previews", async (request) => (
    wiredPreviewStore.list(typeof request.query.search === "string" ? request.query.search : undefined)
  ));

  app.post("/api/wired-previews", async (request, reply) => {
    const parsed = parseWiredPreviewInput(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.message });
    }

    return reply.code(201).send(wiredPreviewStore.create(parsed.value));
  });

  app.get<{ Params: RouteParams }>("/api/wired-previews/:id", async (request, reply) => {
    const preview = wiredPreviewStore.get(request.params.id);
    if (!preview) {
      return reply.code(404).send({ error: "Wired Preview not found" });
    }

    return preview;
  });

  app.put<{ Params: RouteParams }>("/api/wired-previews/:id", async (request, reply) => {
    const parsed = parseWiredPreviewInput(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.message });
    }

    const updated = wiredPreviewStore.update(request.params.id, parsed.value);
    if (!updated) {
      return reply.code(404).send({ error: "Wired Preview not found" });
    }

    return updated;
  });

  app.delete<{ Params: RouteParams }>("/api/wired-previews/:id", async (request, reply) => {
    if (!wiredPreviewStore.delete(request.params.id)) {
      return reply.code(404).send({ error: "Wired Preview not found" });
    }

    terminalSessions.detachDeletedWiredPreview(request.params.id);
    return reply.code(204).send();
  });

  app.get<{ Params: RouteParams }>("/api/wired-previews/:id/published-origins", async (request, reply) => {
    const preview = wiredPreviewStore.get(request.params.id);
    if (!preview) {
      return reply.code(404).send({ error: "Wired Preview not found" });
    }

    return preview.publishedOrigins;
  });

  app.post<{ Params: RouteParams }>("/api/wired-previews/:id/published-origins", async (request, reply) => {
    const parsed = parsePublishPreviewOriginInput(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.message });
    }

    const preview = wiredPreviewStore.get(request.params.id);
    if (!preview) {
      return reply.code(404).send({ error: "Wired Preview not found" });
    }

    if (parsed.value.source === "browserDirectDependencyServices" && parsed.value.httpsPort !== undefined) {
      return reply.code(400).send({ error: "httpsPort is only allowed when publishing one origin" });
    }

    let sources: PreviewPublishSource[] | "host-local" | null;
    if (parsed.value.source === "target") {
      sources = [{ type: "target" }];
    } else if (parsed.value.source === "dependencyService") {
      const index = parsed.value.dependencyServiceIndex;
      if (index === undefined) {
        sources = null;
      } else {
        const service = preview.dependencyServices[index] ?? null;
        if (!service) {
          sources = null;
        } else if (!service.browserDirect) {
          sources = "host-local";
        } else {
          sources = [{ type: "dependency-service", service, serviceIndex: index }];
        }
      }
    } else {
      sources = preview.dependencyServices
        .flatMap((service, serviceIndex): PreviewPublishSource[] => (
          service.browserDirect ? [{ type: "dependency-service", service, serviceIndex }] : []
        ));
    }

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
      const httpsPort = parsed.value.httpsPort ?? allocatePreviewPublishPort(wiredPreviewStore.list(), config);
      if (!httpsPort) {
        return reply.code(400).send({ error: "No Preview Publisher HTTPS ports are available" });
      }

      const originId = randomUUID();
      const resolved = resolvePreviewPublishSource(updatedPreview, source);
      const timestamp = nowIso();
      const provisionalOrigin: PreviewPublishedOrigin = {
        id: originId,
        source: resolved.source,
        dependencyServiceName: resolved.dependencyServiceName,
        dependencyServiceIndex: resolved.dependencyServiceIndex,
        name: resolved.name,
        provider: "tailscale-serve",
        sourceUrl: resolved.sourceUrl,
        publishedUrl: null,
        httpsPort,
        localProxyPort: null,
        status: "published",
        error: null,
        createdAt: timestamp,
        updatedAt: timestamp
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
        preview: updatedPreview,
        source,
        httpsPort,
        localProxyPort: proxiedOrigin.localProxyPort ?? httpsPort,
        originId
      });
      if (!published.ok) {
        await previewProxyManager.close(originId);
      } else {
        await previewProxyManager.ensure(published.origin);
      }

      const updated = wiredPreviewStore.savePublishedOrigin(preview.id, published.origin);
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

    const payload = { origin: origins[0], origins, wiredPreview: updatedPreview };
    return reply.code(failedError ? 502 : 201).send(failedError ? {
      ...payload,
      error: failedError
    } : payload);
  });

  app.delete<{ Params: PublishedOriginRouteParams }>("/api/wired-previews/:id/published-origins/:originId", async (request, reply) => {
    const preview = wiredPreviewStore.get(request.params.id);
    if (!preview) {
      return reply.code(404).send({ error: "Wired Preview not found" });
    }

    const origin = preview.publishedOrigins.find((item) => item.id === request.params.originId);
    if (!origin) {
      return reply.code(404).send({ error: "Preview Published Origin not found" });
    }

    const unpublished = await previewPublisher.unpublish(origin);
    if (!unpublished.ok) {
      return reply.code(502).send({ error: unpublished.error ?? "Failed to unpublish Preview Published Origin" });
    }

    const updated = wiredPreviewStore.updatePublishedOrigin(preview.id, origin.id, { status: "unpublished", error: null });
    const updatedOrigin = updated?.publishedOrigins.find((item) => item.id === origin.id) ?? null;
    if (!updated || !updatedOrigin) {
      return reply.code(404).send({ error: "Preview Published Origin not found" });
    }

    await previewProxyManager.close(origin.id);
    return { origin: updatedOrigin, wiredPreview: updated };
  });

  app.get<{ Querystring: PreviewManifestListQuery }>("/api/preview-manifests", async (request, reply) => {
    const parsedStatus = parsePreviewManifestStatus(request.query.status);
    if (!parsedStatus.ok) {
      return reply.code(400).send({ error: parsedStatus.message });
    }

    return previewManifestStore.list(parsedStatus.value);
  });

  app.post("/api/preview-manifests", async (request, reply) => {
    const parsed = parsePreviewManifestInput(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.message });
    }

    if (parsed.value.wiredPreviewId && !wiredPreviewStore.get(parsed.value.wiredPreviewId)) {
      return reply.code(404).send({ error: "Wired Preview not found" });
    }

    const submitted = previewManifestStore.submit(parsed.value);
    return reply.code(submitted.reused ? 200 : 201).send(submitted.manifest);
  });

  app.put<{ Params: RouteParams }>("/api/preview-manifests/:id/approve", async (request, reply) => {
    const parsed = parseApprovePreviewManifestInput(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.message });
    }

    const approved = previewManifestStore.approve(request.params.id, parsed.value.name);
    if (!approved) {
      return reply.code(404).send({ error: "Preview Manifest not found" });
    }

    return approved;
  });

  app.post("/api/preview-wiring-sessions", async (request, reply) => {
    const parsed = parseLaunchPreviewWiringSessionInput(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.message });
    }

    const wiredPreview = parsed.value.wiredPreviewId ? wiredPreviewStore.get(parsed.value.wiredPreviewId) : null;
    if (parsed.value.wiredPreviewId && !wiredPreview) {
      return reply.code(404).send({ error: "Wired Preview not found" });
    }

    const sessionId = randomUUID();
    const fullPrompt = buildPreviewWiringPrompt({
      backendPort: config.port,
      projectSearchBrief: parsed.value.projectSearchBrief,
      wiringSessionId: sessionId,
      wiredPreview
    });
    const promptFilePath = writePreviewWiringPromptFile({
      dbPath: config.dbPath,
      prompt: fullPrompt,
      wiringSessionId: sessionId
    });
    const prompt = buildPreviewWiringLaunchPrompt({
      backendPort: config.port,
      promptFilePath
    });
    const session = terminalSessions.create({
      id: sessionId,
      mode: "new",
      deviceId: parsed.value.deviceId,
      cwd: wiredPreview?.projectDirectory,
      initialPrompt: prompt,
      name: wiredPreview ? `Wire ${wiredPreview.name}` : "Wire Preview"
    });

    const updatedWiredPreview = wiredPreview
      ? wiredPreviewStore.setWiringSessionId(wiredPreview.id, session.id) ?? wiredPreview
      : null;

    return reply.code(201).send({
      session,
      prompt,
      reused: false,
      wiredPreview: updatedWiredPreview
    });
  });

  app.get<{ Querystring: SessionListQuery }>("/api/open-cozy-sessions", async (request, reply) => {
    let deviceId: string;
    let tabIds: string[];
    try {
      deviceId = readDeviceIdQuery(request.query.deviceId);
      tabIds = readTabIdsQuery(request.query.tabId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid deviceId";
      return reply.code(400).send({ error: message });
    }

    return terminalSessions.list({ deviceId, tabIds });
  });

  app.post("/api/open-cozy-sessions", async (request, reply) => {
    const parsed = parseCreateOpenCozySessionInput(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.message });
    }

    try {
      return reply.code(201).send(terminalSessions.create(parsed.value));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start Codex";
      return reply.code(400).send({ error: message });
    }
  });

  app.put<{ Params: RouteParams }>("/api/open-cozy-sessions/:id", async (request, reply) => {
    const parsed = parseRenameOpenCozySessionInput(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.message });
    }

    const updated = terminalSessions.rename(request.params.id, parsed.value);
    if (!updated) {
      return reply.code(404).send({ error: "OpenCozy session not found" });
    }

    return updated;
  });

  app.put<{ Params: RouteParams }>("/api/open-cozy-sessions/:id/wired-preview", async (request, reply) => {
    const parsed = parseAttachWiredPreviewInput(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.message });
    }

    if (!wiredPreviewStore.get(parsed.value.wiredPreviewId)) {
      return reply.code(404).send({ error: "Wired Preview not found" });
    }

    const updated = terminalSessions.attachWiredPreview(request.params.id, parsed.value.wiredPreviewId);
    if (!updated) {
      return reply.code(404).send({ error: "OpenCozy session not found" });
    }

    return updated;
  });

  app.delete<{ Params: RouteParams }>("/api/open-cozy-sessions/:id/wired-preview", async (request, reply) => {
    const updated = terminalSessions.detachWiredPreview(request.params.id);
    if (!updated) {
      return reply.code(404).send({ error: "OpenCozy session not found" });
    }

    return updated;
  });

  app.delete<{ Params: RouteParams }>("/api/open-cozy-sessions/:id", async (request, reply) => {
    if (!terminalSessions.close(request.params.id)) {
      return reply.code(404).send({ error: "OpenCozy session not found" });
    }

    return reply.code(204).send();
  });

  return app;
}

async function main(): Promise<void> {
  const config = readConfig();
  const app = buildServer(config);
  await app.listen({ host: config.host, port: config.port });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
