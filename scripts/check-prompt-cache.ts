import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";
import { appServerThreadResumeParams, appServerThreadStartParams, appServerTurnStartParams } from "../backend/src/harnesses/codex/codexAdapter.js";

// Runs the pinned Codex binary against a loopback Responses stub. No live model
// calls or tool execution. Only equality results, never prompt bodies, are logged.

const requests: any[] = [];
const checkAttachments = process.argv.includes("--attachments");
const workspacePath = await mkdtemp(join(tmpdir(), "liteharness-cache-probe-"));
const uploadPath = join(workspacePath, "reference.txt");
const imagePath = join(workspacePath, "pixel.png");
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR4nGNoIBEwjGoY1TB8NQAAJYSAEGy7FvQAAAAASUVORK5CYII=", "base64");
if (checkAttachments) {
  await writeFile(uploadPath, "Upload integration probe");
  await writeFile(imagePath, pixel);
}
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  if (!req.url?.endsWith("/responses")) { res.writeHead(404).end(); return; }
  try {
    requests.push(JSON.parse(body.toString()));
  } catch { res.writeHead(400).end("Expected JSON request"); return; }
  const index = requests.length;
  const item = { id: `msg_cache_${index}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: `<p>Reply ${index}.</p>`, annotations: [] }] };
  const response = { id: `resp_cache_${index}`, object: "response", status: "completed", output: [item], usage: { input_tokens: 2000, output_tokens: 10, total_tokens: 2010, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const event of [
    { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response },
  ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
const require = createRequire(import.meta.url);
function connect() {
  const child = spawn(process.execPath, [require.resolve("@openai/codex/bin/codex.js"),
    "-c", 'model_provider="cache_probe"',
    "-c", `model_providers.cache_probe={name="Cache probe",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",requires_openai_auth=false}`,
    "-c", 'mcp_servers={}', "-c", "features.apps=false", "-c", "features.plugins=false",
    "app-server", "--listen", "stdio://",
  ], { cwd: workspacePath, stdio: "pipe" });
  let next = 0;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  const completed: any[] = [];
  const waiters: { resolve(value: any): void; reject(error: Error): void }[] = [];
  let closed = false;
  child.stderr.resume();
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", line => {
    let message: any;
    try { message = JSON.parse(line); } catch { return; }
    if (pending.has(message.id)) {
      const waiter = pending.get(message.id)!;
      pending.delete(message.id);
      message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
    } else if (message.method === "turn/completed") {
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(message.params.turn); else completed.push(message.params.turn);
    }
  });
  child.on("exit", () => {
    closed = true;
    for (const waiter of pending.values()) waiter.reject(new Error("Probe app-server exited"));
    pending.clear();
    for (const waiter of waiters.splice(0)) waiter.reject(new Error("Probe app-server exited before completing a turn"));
  });
  return {
    request(method: string, params: unknown): Promise<any> {
      if (closed) return Promise.reject(new Error("Probe app-server is closed"));
      return new Promise((resolve, reject) => {
        const id = ++next;
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
      });
    },
    completed(): Promise<any> {
      if (completed.length) return Promise.resolve(completed.shift());
      if (closed) return Promise.reject(new Error("Probe app-server is closed"));
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>(resolve => { child.once("exit", () => resolve()); child.kill(); });
    },
  };
}
let connection = connect();
let threadId: string | null = null;
const timer = setTimeout(() => { console.error("Cache probe timed out"); void connection.close(); server.closeAllConnections(); }, 45_000);
try {
  await connection.request("initialize", { clientInfo: { name: "liteharness_cache_probe", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  const input = { harnessThreadId: null, prompt: "First message", profileId: "default", runId: "cache-probe", workspacePath, fileAssets: { contextPath: join(workspacePath, "file-context.json"), cliPath: join(workspacePath, "file-assets.mjs"), invoke: async () => ({}) } };
  await assert.rejects(
    connection.request("turn/start", appServerTurnStartParams(input, "00000000-0000-4000-8000-000000000001")),
    { message: /^thread not found: /i },
  );
  const startParams = appServerThreadStartParams(input);
  const started = await connection.request("thread/start", { ...startParams, modelProvider: "cache_probe" });
  threadId = started.thread.id;
  for (const prompt of ["First message", "Second message"]) {
    await connection.request("turn/start", appServerTurnStartParams({ ...input, prompt, ...(checkAttachments && prompt === "First message" ? { attachments: [
      { id: "probe-file", name: "reference.txt", path: uploadPath, size: 24, mediaType: "application/octet-stream" },
      { id: "probe-image", name: "pixel.png", path: imagePath, size: pixel.length, mediaType: "image/png" },
    ] } : {}) }, threadId!));
    const turn = await connection.completed();
    assert.equal(turn.status, "completed", JSON.stringify(turn.error));
  }
  await connection.close();
  connection = connect();
  await connection.request("initialize", { clientInfo: { name: "liteharness_cache_probe", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  await connection.request("thread/resume", { ...appServerThreadResumeParams({ ...input, harnessThreadId: threadId }), modelProvider: "cache_probe" });
  await connection.request("turn/start", appServerTurnStartParams({ ...input, prompt: "After process recovery" }, threadId!));
  const turn = await connection.completed();
  assert.equal(turn.status, "completed", JSON.stringify(turn.error));
  assert.equal(requests.length, 3);
  if (checkAttachments) {
    const parts = requests[0].input.filter((item: any) => item.role === "user").flatMap((item: any) => item.content ?? []);
    assert.ok(parts.some((part: any) => part.type === "input_text" && part.text.includes(uploadPath)), "File reference must reach the model request");
    assert.ok(parts.some((part: any) => part.type === "input_image" && part.image_url.startsWith("data:image/png;base64,")), "Native image bytes must reach the model request");
    console.log(JSON.stringify({ scenario: "attachments", fileReferenceDelivered: true, nativeImageDelivered: true }));
  }
  for (let index = 1; index < requests.length; index++) {
    const previous = requests[index - 1];
    const current = requests[index];
    const priorItems = current.input.slice(0, previous.input.length);
    const identical = JSON.stringify(priorItems) === JSON.stringify(previous.input);
    const settings = ["model", "instructions", "tools", "reasoning", "text", "prompt_cache_key", "parallel_tool_calls", "include", "service_tier"];
    const changedSettings = settings.filter(key => JSON.stringify(previous[key]) !== JSON.stringify(current[key]));
    console.log(JSON.stringify({ scenario: index === 1 ? "warm follow-up" : "cold recovery", priorItems: previous.input.length, currentItems: current.input.length, identical, changedSettings }));
    if (!identical) console.log(JSON.stringify({ changedItems: previous.input.flatMap((item: any, at: number) => JSON.stringify(item) === JSON.stringify(priorItems[at]) ? [] : [{ at, role: item.role, type: item.type }]) }));
    assert.ok(identical, "Previous request must be an exact prefix");
    assert.deepEqual(changedSettings, []);
  }
} finally {
  if (threadId) await connection.request("thread/delete", { threadId }).catch(() => undefined);
  await connection.close();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(workspacePath, { recursive: true, force: true });
  clearTimeout(timer);
}
