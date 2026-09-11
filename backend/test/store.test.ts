import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createStore, type LiteHarnessStore } from "../src/db/store.js";

let cleanupPath: string | null = null;
let store: LiteHarnessStore | null = null;

afterEach(() => {
  store?.close();
  store = null;
  if (cleanupPath) {
    rmSync(cleanupPath, { recursive: true, force: true });
    cleanupPath = null;
  }
});

function makeStore(): LiteHarnessStore {
  cleanupPath = mkdtempSync(join(tmpdir(), "liteharness-store-"));
  store = createStore(join(cleanupPath, "liteharness.sqlite"));
  return store;
}

describe("Opencozy store", () => {
  it("persists threads, runs, and timeline events in order", () => {
    const current = makeStore();
    const thread = current.createThread({
      harnessThreadId: null,
      harnessType: "codex",
      title: "Opencozy",
      workspacePath: "/tmp",
    });
    const run = current.createRun({ prompt: "test prompt", threadId: thread.id });
    const first = current.recordTimelineEvent({
      payload: { text: "started" },
      runId: run.id,
      threadId: thread.id,
      type: "run.started",
    });
    const second = current.recordTimelineEvent({
      payload: { text: "done" },
      runId: run.id,
      threadId: thread.id,
      type: "run.completed",
    });

    expect(current.listThreads()).toHaveLength(1);
    expect(current.listTimeline(thread.id).map((event) => event.id)).toEqual([first.id, second.id]);
  });

  it("persists the execution profile and Fast mode with each thread", () => {
    const current = makeStore();
    const thread = current.createThread({
      fastMode: true,
      harnessThreadId: null,
      harnessType: "codex",
      profileId: "default",
      title: "Opencozy",
      workspacePath: "/tmp",
    });

    expect(thread).toMatchObject({
      fastMode: true,
      profileId: "default",
    });
    expect(current.updateThread({
      fastMode: false,
      id: thread.id,
      profileId: "power",
    })).toMatchObject({
      fastMode: false,
      profileId: "power",
    });
  });

  it("reads retired Astra tabs as Balance without rewriting history or stored IDs", () => {
    const current = makeStore();
    const thread = current.createThread({ harnessThreadId: "existing-harness-thread", harnessType: "codex", title: "Existing", workspacePath: "/tmp", fastMode: false });
    current.recordTimelineEvent({ threadId: thread.id, runId: null, type: "message.user", payload: { text: "Keep this history" } });
    const history = current.listTimeline(thread.id);
    const db = new DatabaseSync(join(cleanupPath!, "liteharness.sqlite"));
    try {
      db.prepare("UPDATE threads SET profile_id = 'astra' WHERE id = ?").run(thread.id);
      expect(current.getThread(thread.id)).toMatchObject({ profileId: "default", harnessThreadId: "existing-harness-thread", fastMode: false });
      expect(current.listThreads()[0]?.profileId).toBe("default");
      expect(current.listTimeline(thread.id)).toEqual(history);
      expect(db.prepare("SELECT profile_id FROM threads WHERE id = ?").get(thread.id)?.profile_id).toBe("astra");
      current.updateThread({ id: thread.id, profileId: "astra" });
      expect(db.prepare("SELECT profile_id FROM threads WHERE id = ?").get(thread.id)?.profile_id).toBe("default");
      expect(current.listTimeline(thread.id)).toEqual(history);
    } finally {
      db.close();
    }
  });

  it("renames and deletes threads", () => {
    const current = makeStore();
    const thread = current.createThread({
      harnessThreadId: null,
      harnessType: "codex",
      title: "Opencozy",
      workspacePath: "/tmp",
    });

    expect(current.updateThread({ id: thread.id, title: "Renamed" })?.title).toBe("Renamed");
    expect(current.deleteThread(thread.id)).toBe(true);
    expect(current.getThread(thread.id)).toBeNull();
    expect(current.deleteThread(thread.id)).toBe(false);
  });

  it("keeps thread titles unique", () => {
    const current = makeStore();
    const first = current.createThread({
      deviceId: "device-a",
      harnessThreadId: null,
      harnessType: "codex",
      title: "Opencozy",
      workspacePath: "/tmp",
    });
    const second = current.createThread({
      deviceId: "device-a",
      harnessThreadId: null,
      harnessType: "codex",
      title: "Opencozy",
      workspacePath: "/tmp",
    });
    const renamed = current.updateThread({ id: second.id, title: "Opencozy" });

    expect(first.title).toBe("Opencozy");
    expect(second.title).toBe("Opencozy 2");
    expect(renamed?.title).toBe("Opencozy 2");
    expect(current.listThreads().map((thread) => thread.title).sort()).toEqual(["Opencozy", "Opencozy 2"]);
  });

  it("lists threads only for their owner device", () => {
    const current = makeStore();
    const first = current.createThread({
      deviceId: "device-a",
      harnessThreadId: null,
      harnessType: "codex",
      title: "Opencozy",
      workspacePath: "/tmp",
    });
    const second = current.createThread({
      deviceId: "device-b",
      harnessThreadId: null,
      harnessType: "codex",
      title: "Opencozy",
      workspacePath: "/tmp",
    });

    expect(second.title).toBe("Opencozy");
    expect(current.listThreadsForDevice("device-a").map((thread) => thread.id)).toEqual([first.id]);
    expect(current.listThreadsForDevice("device-b").map((thread) => thread.id)).toEqual([second.id]);
    expect(current.getThreadForDevice(first.id, "device-b")).toBeNull();
  });

  it("can claim legacy unowned threads for the first upgraded device", () => {
    const current = makeStore();
    const existing = current.createThread({
      deviceId: "device-a",
      harnessThreadId: null,
      harnessType: "codex",
      title: "Legacy",
      workspacePath: "/tmp",
    });
    const thread = current.createThread({
      harnessThreadId: null,
      harnessType: "codex",
      title: "Legacy",
      workspacePath: "/tmp",
    });

    expect(current.listThreadsForDevice("device-a").map((item) => item.id)).toEqual([existing.id]);

    current.claimUnownedThreadsForDevice("device-a");

    expect(current.listThreadsForDevice("device-a").map((item) => item.id).sort()).toEqual([existing.id, thread.id].sort());
    expect(current.listThreadsForDevice("device-a").map((item) => item.title).sort()).toEqual(["Legacy", "Legacy 2"]);
    expect(current.listThreadsForDevice("device-b")).toEqual([]);
  });

  it("stores wired previews and approves preview manifests", () => {
    const current = makeStore();
    const manifest = current.submitPreviewManifest({
      commands: [{ command: "npm run dev", cwd: "/tmp/app", label: "Start app" }],
      dependencyServices: [],
      name: "Opencozy Preview",
      projectDirectory: "/tmp/app",
      requestedPublishedOrigins: [{ name: "App", url: "http://127.0.0.1:5173/" }],
      target: { name: "App", url: "http://127.0.0.1:5173/" },
      wiringThreadId: "thread-wiring",
    });

    expect(manifest.reused).toBe(false);
    expect(manifest.manifest.status).toBe("pending");

    const approved = current.approvePreviewManifest(manifest.manifest.id, "Mobile Preview");

    expect(approved?.manifest.status).toBe("approved");
    expect(approved?.wiredPreview.name).toBe("Mobile Preview");
    expect(approved?.wiredPreview.wiringThreadId).toBe("thread-wiring");
    expect(current.listWiredPreviews("mobile")).toHaveLength(1);
    expect(current.submitPreviewManifest({
      commands: [{ command: "npm run dev", cwd: "/tmp/app", label: "Start app" }],
      dependencyServices: [],
      name: "Duplicate",
      projectDirectory: "/tmp/app",
      requestedPublishedOrigins: [{ name: "App", url: "http://127.0.0.1:5173/" }],
      target: { name: "App", url: "http://127.0.0.1:5173/" },
    }).reused).toBe(true);
  });

  it("deduplicates existing thread titles during migration", () => {
    cleanupPath = mkdtempSync(join(tmpdir(), "liteharness-store-"));
    const dbPath = join(cleanupPath, "liteharness.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        harness_type TEXT NOT NULL,
        harness_thread_id TEXT,
        title TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const insertThread = db.prepare(`
      INSERT INTO threads (id, harness_type, harness_thread_id, title, workspace_path, status, created_at, updated_at)
      VALUES (?, 'codex', NULL, 'Opencozy', '/tmp', 'idle', ?, ?)
    `);
    insertThread.run("thread-1", "2026-05-12T00:00:00.000Z", "2026-05-12T00:00:00.000Z");
    insertThread.run("thread-2", "2026-05-12T00:00:01.000Z", "2026-05-12T00:00:01.000Z");
    insertThread.run("thread-3", "2026-05-12T00:00:02.000Z", "2026-05-12T00:00:02.000Z");
    db.close();

    const current = createStore(dbPath);
    store = current;

    expect(current.listThreads().map((thread) => thread.title).sort()).toEqual([
      "Opencozy",
      "Opencozy 2",
      "Opencozy 3",
    ]);
  });
});
