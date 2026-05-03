import { mkdirSync } from "node:fs";
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
});
