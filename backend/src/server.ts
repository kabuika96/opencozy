import { pathToFileURL } from "node:url";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { AppStore } from "./appStore.js";
import { getCodexCapabilities } from "./codexCli.js";
import { readConfig, type OpenCozyConfig } from "./config.js";
import { TerminalSessionManager } from "./terminalSessions.js";
import { parseAppShortcutInput, parseCreateOpenCozySessionInput } from "./validation.js";

type RouteParams = {
  id: string;
};

function readRouteId(requestUrl: string): string | null {
  const pathname = new URL(requestUrl, "http://opencozy.local").pathname;
  const match = /^\/api\/open-cozy-sessions\/([^/]+)\/socket\/?$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function buildServer(config: OpenCozyConfig = readConfig()) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info"
    }
  });
  const appStore = new AppStore(config.dbPath);
  const terminalSessions = new TerminalSessionManager(config);

  app.addHook("onClose", async () => {
    terminalSessions.closeAll();
    appStore.close();
  });

  app.register(websocket);
  app.register(async (wsRoutes) => {
    wsRoutes.get<{ Params: RouteParams }>("/api/open-cozy-sessions/:id/socket", { websocket: true }, (socket, request) => {
      const params = request.params as Partial<RouteParams> | undefined;
      const sessionId = params?.id ?? readRouteId(request.url);

      if (!sessionId || !terminalSessions.attach(sessionId, socket)) {
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

  app.get("/api/open-cozy-sessions", async () => terminalSessions.list());

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
