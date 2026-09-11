import Fastify from "fastify";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AssetLibrary, assetFormat } from "../src/assets/assetLibrary.js";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { createStore } from "../src/db/store.js";
import { createTimelineHub } from "../src/events/timelineHub.js";
import { registerApiRoutes } from "../src/routes/api.js";
import type { HarnessAdapter, RunHarnessInput } from "../src/harnesses/types.js";

describe("durable file assets", () => {
  it("publishes a snapshot, searches it after closing its source thread, and shows it in a new thread", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lh-assets-"));
    const store = createStore(join(directory, "test.sqlite"));
    const headers = { "x-liteharness-device-id": "asset-owner" };
    let captured: RunHarnessInput | undefined;
    let release!: () => void;
    const adapter: HarnessAdapter = {
      type: "codex", label: "test", capabilities: { fastMode: true, resume: true, approvals: false, userInput: true, streaming: true },
      async discoverWorkspace() { throw new Error("unused"); }, async startThread() { return { harnessThreadId: null }; },
      async *run(input) { captured = input; yield { type: "run.started", text: "start" }; await new Promise<void>(resolve => { release = resolve; }); yield { type: "run.completed", text: "done" }; },
      async respondToApproval() {}, async respondToInput() {}, async sendUserInput() {},
    };
    const app = Fastify();
    await registerApiRoutes(app, { store, hub: createTimelineHub(), harnesses: new Map([["codex", adapter]]) });
    await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const source = join(directory, "insurance.txt");
      await writeFile(source, "Coverage expires September 24. Reference: bluebird.");
      const thread = (await app.inject({ method: "POST", url: "/api/threads", headers, payload: { workspacePath: directory } })).json();
      await app.inject({ method: "POST", url: `/api/threads/${thread.id}/runs`, headers, payload: { prompt: "Share insurance" } });
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(captured).toHaveProperty("fileAssets");
      const bridge = (captured as RunHarnessInput & { fileAssets: { invoke(tool: string, args: unknown): Promise<any> } }).fileAssets;
      const asset = await bridge.invoke("publish", { path: source, title: "Car insurance", description: "Coverage card" }) as import("../src/assets/assetLibrary.js").FileAsset;
      expect(asset).toMatchObject({ title: "Car insurance", kind: "text" });
      await writeFile(source, "The source has changed");
      const timeline = store.listTimeline(thread.id);
      expect(timeline.find(event => event.type === "asset.shared")?.payload.asset).toMatchObject({ id: asset.id });
      release();
      await new Promise(resolve => setTimeout(resolve, 20));
      store.setThreadClosed(thread.id, true);
      const found = await app.inject({ method: "GET", url: "/api/assets?q=bluebird", headers });
      expect(found.json().assets).toEqual([expect.objectContaining({ id: asset.id })]);
      const denied = await app.inject({ method: "GET", url: `/api/assets/${asset.id}`, headers: { "x-liteharness-device-id": "other-device" } });
      expect(denied.statusCode).toBe(404);
      const access = (await app.inject({ method: "POST", url: `/api/assets/${asset.id}/access`, headers })).json();
      const content = await app.inject({ method: "GET", url: access.url });
      expect(content.body).toContain("Reference: bluebird");
      const range = await app.inject({ method: "GET", url: access.url, headers: { range: "bytes=0-7" } });
      expect(range.statusCode).toBe(206); expect(range.body).toBe("Coverage");
      expect((await app.inject({ method: "GET", url: access.url, headers: { range: "bytes=9999-" } })).statusCode).toBe(416);
      expect((await app.inject({ method: "GET", url: `/api/assets/${asset.id}/content` })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `/api/assets/${asset.id}/access`, headers: { "x-liteharness-device-id": "other-device" } })).statusCode).toBe(404);
      store.deleteThread(thread.id);
      expect((await app.inject({ method: "GET", url: "/api/assets?q=bluebird", headers })).json().assets[0].id).toBe(asset.id);
      const next = (await app.inject({ method: "POST", url: "/api/threads", headers, payload: { workspacePath: directory } })).json();
      await app.inject({ method: "POST", url: `/api/threads/${next.id}/runs`, headers, payload: { prompt: "Find my insurance" } });
      await new Promise(resolve => setTimeout(resolve, 20));
      const nextBridge = (captured as any).fileAssets;
      const result = await nextBridge.invoke("search", { query: "insurance" });
      const context = JSON.parse(await readFile(nextBridge.contextPath, "utf8"));
      const cli = await promisify(execFile)(process.execPath, [nextBridge.cliPath, nextBridge.contextPath, "search", JSON.stringify({ query: "insurance" })]);
      expect(JSON.parse(cli.stdout).assets[0].id).toBe(asset.id);
      expect((await app.inject({ method: "POST", url: "/api/file-tools/search", payload: { query: "insurance" } })).statusCode).toBe(403);
      expect(result.assets[0].id).toBe(asset.id);
      await nextBridge.invoke("show", { id: asset.id });
      expect(store.listTimeline(next.id).find(event => event.type === "asset.shared")?.payload.asset).toMatchObject({ id: asset.id });
      expect(await readFile(source, "utf8")).toBe("The source has changed");
      release();
      await new Promise(resolve => setTimeout(resolve, 20));
      expect((await app.inject({ method: "POST", url: "/api/file-tools/search", headers: { authorization: `Bearer ${context.token}` }, payload: { query: "insurance" } })).statusCode).toBe(403);
    } finally { release?.(); await new Promise(resolve => setTimeout(resolve, 20)); await app.close(); store.close(); await rm(directory, { recursive: true, force: true }); }
  });
});


it("retains its index and bytes after reopening, scopes search, and rejects non-files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lh-asset-library-"));
  let library = new AssetLibrary(directory);
  try {
    const source = join(directory, "report.html");
    await writeFile(source, '<h1>Renewal information</h1><p>bluebird</p><script>secretScriptWord()</script>');
    const asset = await library.publish({ owner: "one", sourceThreadId: "closed", path: source, title: "Annual report" });
    await expect(library.publish({ owner: "one", sourceThreadId: "closed", path: directory })).rejects.toThrow("regular file");
    library.close(); library = new AssetLibrary(directory);
    expect(library.search("one", "bluebird").assets[0]?.id).toBe(asset.id);
    expect(library.search("two", "bluebird").assets).toEqual([]);
    expect(library.search("one", "secretScriptWord").assets).toEqual([]);
    expect(library.search("one", '" OR *').assets).toEqual([]);
    expect(await readFile(library.filePath(asset), "utf8")).toContain("Renewal information");
  } finally { library.close(); await rm(directory, { recursive: true, force: true }); }
});

it.each([
  ['note.md', 'text'], ['data.json', 'text'], ['sheet.csv', 'text'], ['code.py', 'text'], ['config.yaml', 'text'],
  ['report.html', 'html'], ['document.pdf', 'pdf'], ['photo.png', 'image'], ['picture.svg', 'image'], ['movie.mp4', 'video'], ['recording.webm', 'video'], ['sound.mp3', 'audio'], ['speech.wav', 'audio'], ['binary.zip', 'file'],
])("classifies %s for preview", (name, kind) => {
  expect(assetFormat(name!, Buffer.from([0, 1, 2]))[0]).toBe(kind);
});
