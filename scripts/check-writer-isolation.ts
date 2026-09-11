import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";
import { createCodexAdapter } from "../backend/src/harnesses/codex/codexAdapter.js";

import { CodexAppServerPool, type CodexAppServerConnection } from "../backend/src/harnesses/codex/appServerPool.js";

// Runs the pinned Codex binary against a loopback Responses stub. No live model
// calls or tool execution. Only equality results, never prompt bodies, are logged.

const requests: any[] = [];
let releaseFirst!: () => void;
const firstHeld = new Promise<void>(resolve => { releaseFirst = resolve; });
let firstArrived!: () => void;
const firstRequest = new Promise<void>(resolve => { firstArrived = resolve; });
const workspacePath = await mkdtemp(join(tmpdir(), "liteharness-cache-probe-"));
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  if (!req.url?.endsWith("/responses")) { res.writeHead(404).end(); return; }
  try {
    requests.push(JSON.parse(body.toString()));
  } catch { res.writeHead(400).end("Expected JSON request"); return; }
  const index = requests.length;
  if (index === 1) { firstArrived(); await firstHeld; }
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
const clients: ReturnType<typeof connect>[] = [];
const pool = new CodexAppServerPool(async () => {
  const client = connect();
  clients.push(client);
  await client.request("initialize", { clientInfo: { name: "liteharness_writer_probe", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  let threadId: string;
  const connection: CodexAppServerConnection = {
    close: () => client.close(),
    notify() {},
    respond() { throw new Error("No tools are expected in the writer probe"); },
    async request<T>(method: string, value: unknown): Promise<T> {
      const params = value as Record<string, unknown>;
      const result = await client.request(method, method === "thread/start" || method === "thread/resume" ? { ...params, modelProvider: "cache_probe" } : params);
      if (result.thread?.id) threadId = result.thread.id;
      return result;
    },
    async *notifications() {
      yield { method: "turn/completed", params: { threadId, turn: await client.completed() } };
    },
  };
  return connection;
});
const adapter = createCodexAdapter({ pool });
const threadIds: string[] = [];
const timer = setTimeout(() => {
  console.error("Writer probe timed out");
  releaseFirst();
  void pool.close();
  server.closeAllConnections();
}, 45_000);
async function run(threadId: string, prompt: string) {
  const events = [];
  for await (const event of adapter.run({ harnessThreadId: threadId, prompt, runId: prompt, workspacePath })) events.push(event);
  assert.equal(events.at(-1)?.type, "run.completed", events.at(-1)?.text);
}
try {
  await pool.warm();
  for (let index = 0; index < 2; index++) {
    const thread = await adapter.startThread({ workspacePath });
    assert.ok(thread.harnessThreadId);
    threadIds.push(thread.harnessThreadId);
  }
  let firstFinished = false;
  const firstRun = run(threadIds[0]!, "First device").then(() => { firstFinished = true; });
  void firstRun.catch(() => undefined);
  await firstRequest;
  for (const prompt of ["Second device", "Second device follow-up"]) {
    await run(threadIds[1]!, prompt);
    assert.equal(firstFinished, false, "First device must still be running during second device work");
  }
  assert.equal(clients.length, 2, "Follow-ups must reuse their writer process");
  releaseFirst();
  await firstRun;
  await run(threadIds[0]!, "First device follow-up");
  assert.equal(requests.length, 4);
  assert.equal(clients.length, 2);
  console.log(JSON.stringify({ scenario: "two threads and follow-ups with overlapping Runs", completedTurns: requests.length, writerProcesses: clients.length, passed: true }));
} finally {
  releaseFirst();
  for (const [index, threadId] of threadIds.entries()) await clients[index]?.request("thread/delete", { threadId }).catch(() => undefined);
  await pool.close();
  await Promise.allSettled(clients.map(client => client.close()));
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(workspacePath, { recursive: true, force: true });
  clearTimeout(timer);
}
