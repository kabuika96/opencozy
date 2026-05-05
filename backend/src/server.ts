import { pathToFileURL } from "node:url";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyRequest } from "fastify";
import { AppStore } from "./appStore.js";
import { getCodexCapabilities } from "./codexCli.js";
import { readConfig, type OpenCozyConfig } from "./config.js";
import { TerminalSessionManager } from "./terminalSessions.js";
import { parseAppShortcutInput, parseCreateOpenCozySessionInput, parseRenameOpenCozySessionInput } from "./validation.js";
import { readWanTunnelStatus } from "./wanTunnel.js";

type RouteParams = {
  id: string;
};
type SessionListQuery = {
  deviceId?: string;
  tabId?: string | string[];
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
  const terminalSessions = new TerminalSessionManager(config);
  const allowedHosts = makeAllowedHostSet(config.allowedHosts);

  app.addHook("onClose", async () => {
    terminalSessions.closeAll();
    appStore.close();
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
