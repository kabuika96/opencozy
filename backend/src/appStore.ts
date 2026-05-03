import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { buildShortcutUrl } from "./appUrls.js";
import type { AppShortcut, AppShortcutInput, ShortcutProtocol } from "./types.js";

type AppShortcutRow = {
  id: string;
  name: string;
  protocol: ShortcutProtocol;
  host: string;
  port: number;
  path: string;
  created_at: string;
  updated_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function toShortcut(row: AppShortcutRow): AppShortcut {
  const input = {
    name: row.name,
    protocol: row.protocol,
    host: row.host,
    port: row.port,
    path: row.path
  };

  return {
    id: row.id,
    ...input,
    url: buildShortcutUrl(input),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class AppStore {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  list(): AppShortcut[] {
    const rows = this.db
      .prepare("SELECT id, name, protocol, host, port, path, created_at, updated_at FROM app_shortcuts ORDER BY name COLLATE NOCASE ASC")
      .all() as AppShortcutRow[];

    return rows.map(toShortcut);
  }

  get(id: string): AppShortcut | null {
    const row = this.db
      .prepare("SELECT id, name, protocol, host, port, path, created_at, updated_at FROM app_shortcuts WHERE id = ?")
      .get(id) as AppShortcutRow | undefined;

    return row ? toShortcut(row) : null;
  }

  create(input: AppShortcutInput): AppShortcut {
    const id = randomUUID();
    const createdAt = nowIso();

    this.db
      .prepare(
        "INSERT INTO app_shortcuts (id, name, protocol, host, port, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(id, input.name, input.protocol, input.host, input.port, input.path, createdAt, createdAt);

    const shortcut = this.get(id);
    if (!shortcut) {
      throw new Error("Failed to create LAN app shortcut");
    }

    return shortcut;
  }

  update(id: string, input: AppShortcutInput): AppShortcut | null {
    const updatedAt = nowIso();
    const result = this.db
      .prepare("UPDATE app_shortcuts SET name = ?, protocol = ?, host = ?, port = ?, path = ?, updated_at = ? WHERE id = ?")
      .run(input.name, input.protocol, input.host, input.port, input.path, updatedAt, id);

    if (result.changes === 0) {
      return null;
    }

    return this.get(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM app_shortcuts WHERE id = ?").run(id);
    return result.changes > 0;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_shortcuts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        protocol TEXT NOT NULL CHECK (protocol IN ('http', 'https')),
        host TEXT NOT NULL,
        port INTEGER NOT NULL CHECK (port > 0 AND port <= 65535),
        path TEXT NOT NULL DEFAULT '/',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }
}
