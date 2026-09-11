import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";
import { appServerThreadResumeParams, appServerThreadStartParams, appServerTurnStartParams } from "../backend/src/harnesses/codex/codexAdapter.js";

// Runs the pinned Codex binary against a loopback Responses stub. No live model
// calls or service restarts. --files exercises the persistent file tools instead.
const fileTools = process.argv.includes("--files");
const fileCalls: string[] = [];

const requests: any[] = [];
let approvals = 0;
const decisions = [true, false];
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
  const item = index % 2 === 1 ? { id: "ctc_approval_probe", type: "custom_tool_call", name: "exec", call_id: "call_approval_probe", input: fileTools ? `text(await tools.files__publish({path:"/tmp/report.txt"})); text(await tools.files__search({query:"report"})); text(await tools.files__read({id:"probe-asset"})); text(await tools.files__show({id:"probe-asset"})); text(await tools.files__search_records({query:"record"})); text(await tools.files__show_record({id:"probe-record"}));` : `text(await tools.liteharness__request_approval({action:"Approve this isolated test action?"}));` } : { id: `msg_cache_${index}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: `<p>Reply ${index}.</p>`, annotations: [] }] };
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
    if (message.method === "item/tool/call") {
      if (fileTools) {
        assert.equal(message.params.namespace, "files");
        assert.ok(["publish", "search", "show", "read", "search_records", "show_record"].includes(message.params.tool));
        fileCalls.push(message.params.tool);
        child.stdin.write(JSON.stringify({ id: message.id, result: { success: true, contentItems: [{ type: "inputText", text: JSON.stringify({ tool: message.params.tool, id: "probe-asset" }) }] } }) + "\n");
        return;
      }
      approvals++;
      assert.equal(message.params.namespace, "liteharness");
      assert.equal(message.params.tool, "request_approval");
      child.stdin.write(JSON.stringify({id:message.id,result:{success:true,contentItems:[{type:"inputText",text:JSON.stringify({approved:decisions[approvals - 1],action:"Approve this isolated test action?"})}]}})+"\n");
    } else if (pending.has(message.id)) {
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
const timer = setTimeout(() => { console.error("Approval probe timed out"); void connection.close(); server.closeAllConnections(); }, 45_000);
try {
  await connection.request("initialize", { clientInfo: { name: "liteharness_cache_probe", version: "0.1.0" }, capabilities: { experimentalApi: true } });
  const input = { harnessThreadId: null, prompt: "First message", profileId: "default", runId: "cache-probe", workspacePath, ...(fileTools ? { fileAssets: { contextPath: join(workspacePath, "file-context.json"), cliPath: join(workspacePath, "file-assets.mjs"), invoke: async () => ({}) } } : {}) };
  await assert.rejects(
    connection.request("turn/start", appServerTurnStartParams(input, "00000000-0000-4000-8000-000000000001")),
    { message: /^thread not found: /i },
  );
  const startParams = appServerThreadStartParams(input);
  const started = await connection.request("thread/start", { ...startParams, modelProvider: "cache_probe" });
  threadId = started.thread.id;
  for (const [index, approved] of decisions.entries()) {
    if (index > 0) {
      await connection.close();
      connection = connect();
      await connection.request("initialize", { clientInfo: { name: "liteharness_approval_probe", version: "0.1.0" }, capabilities: { experimentalApi: true } });
      await connection.request("thread/resume", { ...appServerThreadResumeParams({ ...input, harnessThreadId: threadId }), modelProvider: "cache_probe" });
    }
    await connection.request("turn/start", appServerTurnStartParams(input, threadId!));
    const turn = await connection.completed();
    assert.equal(turn.status, "completed", JSON.stringify(turn.error));
    if (fileTools) {
      assert.deepEqual(fileCalls.slice(index * 6), ["publish", "search", "read", "show", "search_records", "show_record"]);
      const output = requests.at(-1).input.filter((item: any) => item.type === "custom_tool_call_output").at(-1);
      assert.ok(JSON.stringify(output).includes("probe-asset"), "File results must return to the model");
      console.log(JSON.stringify({ scenario: index === 0 ? "new thread" : "cold resume", fileTools: fileCalls.length, receivedByTool: true }));
      continue;
    }
    assert.equal(approvals, index + 1, "Must reach the adapter even with danger-full-access");
    const output = requests.at(-1).input.filter((item: any) => item.type === "custom_tool_call_output").at(-1);
    const decision = output.output.flatMap((part: any) => {
      try { return [JSON.parse(part.text)]; } catch { return []; }
    }).find((part: any) => typeof part.approved === "boolean");
    assert.deepEqual(decision, { approved, action: "Approve this isolated test action?" });
    console.log(JSON.stringify({ scenario: index === 0 ? "new thread" : "cold resume", approved, receivedByTool: true }));
  }

} finally {
  if (threadId) await connection.request("thread/delete", { threadId }).catch(() => undefined);
  await connection.close();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(workspacePath, { recursive: true, force: true });
  clearTimeout(timer);
}
