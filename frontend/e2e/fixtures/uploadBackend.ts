// Real upload/storage/API pipeline with an isolated Harness boundary.
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { readFile } from "node:fs/promises";
import { createStore } from "../../../backend/src/db/store.js";
import { createTimelineHub } from "../../../backend/src/events/timelineHub.js";
import { registerApiRoutes } from "../../../backend/src/routes/api.js";
import type { HarnessAdapter } from "../../../backend/src/harnesses/types.js";

const app = Fastify();
await app.register(websocket);
const store = createStore(process.argv[2]);
const adapter: HarnessAdapter = {
  type: "codex", label: "Codex",
  capabilities: { approvals: false, fastMode: true, resume: true, streaming: true, userInput: true },
  async discoverWorkspace() { throw new Error("unused"); },
  async startThread() { return { harnessThreadId: null }; },
  async *run(input) {
    for (const file of input.attachments ?? []) {
      const content = await readFile(file.path, "utf8");
      yield { type: "harness.output", text: `Received ${file.name}: ${content}`, payload: { liteharnessType: "assistant-message" } };
    }
    yield { type: "run.completed", text: "Done" };
  },
  async respondToApproval() {}, async respondToInput() {}, async sendUserInput() {},
};
await registerApiRoutes(app, { store, hub: createTimelineHub(), harnesses: new Map([["codex", adapter]]) });
console.log(JSON.stringify({ origin: await app.listen({ host: "127.0.0.1", port: 0 }) }));
