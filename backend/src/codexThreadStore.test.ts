import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CodexThreadStore } from "./codexThreadStore.js";

function createStateDb(): string {
  const dir = path.join(tmpdir(), `opencozy-state-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "state_5.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      cwd TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      first_user_message TEXT NOT NULL DEFAULT '',
      rollout_path TEXT NOT NULL DEFAULT '',
      created_at_ms INTEGER,
      updated_at_ms INTEGER
    );
  `);
  db.close();
  return dbPath;
}

describe("Codex thread store", () => {
  it("finds and renames the active Codex thread title", () => {
    const dbPath = createStateDb();
    const db = new DatabaseSync(dbPath);
    db
      .prepare("INSERT INTO threads (id, title, cwd, created_at, updated_at, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("thread-1", "Old title", "/work", 1, 1, 1_000, 5_000);
    db.close();

    const store = new CodexThreadStore(dbPath);

    expect(store.findActiveThread("/work", 2_000)).toEqual({ id: "thread-1", title: "Old title" });
    expect(store.updateTitle("thread-1", "Renamed")).toBe(true);
    expect(store.getThread("thread-1")).toEqual({ id: "thread-1", title: "Renamed" });
  });

  it("ignores threads that were only updated before the OpenCozy session started", () => {
    const dbPath = createStateDb();
    const db = new DatabaseSync(dbPath);
    db
      .prepare("INSERT INTO threads (id, title, cwd, created_at, updated_at, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("thread-1", "Old title", "/work", 1, 1, 1_000, 1_500);
    db.close();

    const store = new CodexThreadStore(dbPath);

    expect(store.findActiveThread("/work", 2_000)).toBeNull();
  });

  it("matches a thread title from visible resume picker text even when the timestamp is old", () => {
    const dbPath = createStateDb();
    const db = new DatabaseSync(dbPath);
    db
      .prepare("INSERT INTO threads (id, title, cwd, created_at, updated_at, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("thread-1", "Selected Session", "/work", 1, 1, 1_000, 1_500);
    db
      .prepare("INSERT INTO threads (id, title, cwd, created_at, updated_at, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("thread-2", "Other Session", "/work", 1, 1, 1_000, 5_000);
    db.close();

    const store = new CodexThreadStore(dbPath);

    expect(store.findThreadInText("/work", "\u203a Selected Session /work")).toEqual({ id: "thread-1", title: "Selected Session" });
  });

  it("finds a new thread by the first submitted user message", () => {
    const dbPath = createStateDb();
    const db = new DatabaseSync(dbPath);
    db
      .prepare("INSERT INTO threads (id, title, cwd, first_user_message, created_at, updated_at, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("thread-1", "Build Login", "/work", "Build login", 1, 1, 3_000, 5_000);
    db
      .prepare("INSERT INTO threads (id, title, cwd, first_user_message, created_at, updated_at, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("thread-2", "Other Session", "/work", "Other prompt", 1, 1, 4_000, 6_000);
    db.close();

    const store = new CodexThreadStore(dbPath);

    expect(store.findThreadByFirstUserMessage("/work", 2_000, "  Build   login  ")).toEqual({ id: "thread-1", title: "Build Login" });
    expect(store.findThreadByFirstUserMessage("/work", 2_000, "Missing prompt")).toBeNull();
  });

  it("does not guess when more than one new thread has the same first user message", () => {
    const dbPath = createStateDb();
    const db = new DatabaseSync(dbPath);
    db
      .prepare("INSERT INTO threads (id, title, cwd, first_user_message, created_at, updated_at, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("thread-1", "First Match", "/work", "same prompt", 1, 1, 3_000, 5_000);
    db
      .prepare("INSERT INTO threads (id, title, cwd, first_user_message, created_at, updated_at, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("thread-2", "Second Match", "/work", "same prompt", 1, 1, 4_000, 6_000);
    db.close();

    const store = new CodexThreadStore(dbPath);

    expect(store.findThreadByFirstUserMessage("/work", 2_000, "same prompt")).toBeNull();
  });

  it("finds a resumed thread by a recently submitted user message in the rollout", () => {
    const dbPath = createStateDb();
    const rolloutPath = path.join(path.dirname(dbPath), "rollout.jsonl");
    writeFileSync(
      rolloutPath,
      [
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Continue the settings work"
          }
        }),
        ""
      ].join("\n")
    );

    const db = new DatabaseSync(dbPath);
    db
      .prepare("INSERT INTO threads (id, title, cwd, rollout_path, created_at, updated_at, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("thread-1", "Settings Work", "/work", rolloutPath, 1, 1, 1_000, 5_000);
    db
      .prepare("INSERT INTO threads (id, title, cwd, rollout_path, created_at, updated_at, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("thread-2", "Other Session", "/work", "", 1, 1, 1_000, 6_000);
    db.close();

    const store = new CodexThreadStore(dbPath);

    expect(store.findThreadByRecentUserMessage("/work", 2_000, " continue   the settings work ")).toEqual({ id: "thread-1", title: "Settings Work" });
    expect(store.findThreadByRecentUserMessage("/work", 2_000, "missing prompt")).toBeNull();
  });

  it("does not guess when multiple resumed threads contain the same recent user message", () => {
    const dbPath = createStateDb();
    const dir = path.dirname(dbPath);
    const firstRolloutPath = path.join(dir, "first-rollout.jsonl");
    const secondRolloutPath = path.join(dir, "second-rollout.jsonl");
    const line = `${JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "same prompt" } })}\n`;
    writeFileSync(firstRolloutPath, line);
    writeFileSync(secondRolloutPath, line);

    const db = new DatabaseSync(dbPath);
    db
      .prepare("INSERT INTO threads (id, title, cwd, rollout_path, created_at, updated_at, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("thread-1", "First Match", "/work", firstRolloutPath, 1, 1, 1_000, 5_000);
    db
      .prepare("INSERT INTO threads (id, title, cwd, rollout_path, created_at, updated_at, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("thread-2", "Second Match", "/work", secondRolloutPath, 1, 1, 1_000, 6_000);
    db.close();

    const store = new CodexThreadStore(dbPath);

    expect(store.findThreadByRecentUserMessage("/work", 2_000, "same prompt")).toBeNull();
  });
});
