// Isolated backend process for the restart browser regression. Never uses owner data.
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { createStore } from "../../../backend/src/db/store.js";
import { createTimelineHub } from "../../../backend/src/events/timelineHub.js";
import { registerApiRoutes } from "../../../backend/src/routes/api.js";
import type { HarnessAdapter } from "../../../backend/src/harnesses/types.js";

const app = Fastify();
await app.register(websocket);
const store = createStore(process.argv[2]);
const adapter: HarnessAdapter = {
  type: "codex", label: "Codex",
  capabilities: { approvals: true, fastMode: true, resume: true, streaming: true, userInput: true },
  async discoverWorkspace() { throw new Error("unused"); },
  async startThread() { return { harnessThreadId: "preserved-test-context" }; },
  async *run(input) {
    if (input.prompt === "Continue here" && input.harnessThreadId !== "preserved-test-context") throw new Error("Harness context was lost");
    yield { type: "thread.started", text: "Thread ready", payload: { harnessThreadId: "preserved-test-context" } };
    yield { type: "run.started", text: "Started" };
    yield { type: "harness.output", text: input.prompt === "Continue here" ? "Continued in the same thread." : "History survives the restart.", payload: { liteharnessType: "assistant-message" } };
    if (input.prompt === "Continue here") {
      yield { type: "run.completed", text: "Done" };
    } else {
      await new Promise<void>(resolve => input.signal?.addEventListener("abort", () => resolve(), { once: true }));
    }
  },
  async respondToApproval() {}, async respondToInput() {},
  async sendUserInput() { throw new Error("A restarted run must not be steered"); },
};
await registerApiRoutes(app, { store, hub: createTimelineHub(), harnesses: new Map([["codex", adapter]]) });
const origin = await app.listen({ host: "127.0.0.1", port: Number(process.argv[3] ?? 0) });
console.log(JSON.stringify({ origin }));
