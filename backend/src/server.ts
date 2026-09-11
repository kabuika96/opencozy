import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { createStore } from "./db/store.js";
import { createTimelineHub } from "./events/timelineHub.js";
import {
  closeHarnessRegistry,
  createHarnessRegistry,
  startHarnessRegistry,
} from "./harnesses/registry.js";
import { registerApiRoutes } from "./routes/api.js";

export async function buildServer() {
  const app = Fastify({
    logger: true,
  });
  await app.register(websocket);

  const store = createStore();
  const hub = createTimelineHub();
  const harnesses = createHarnessRegistry();
  await registerApiRoutes(app, { harnesses, hub, store });

  app.addHook("onReady", async () => {
    await startHarnessRegistry(harnesses);
  });
  app.addHook("onClose", async () => {
    await closeHarnessRegistry(harnesses);
    store.close();
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer();
  const host = process.env.LITEHARNESS_BACKEND_HOST ?? "127.0.0.1";
  const port = Number(process.env.LITEHARNESS_BACKEND_PORT ?? 8787);
  await app.listen({ host, port });
}
