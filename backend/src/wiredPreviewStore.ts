import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  PreviewCommandInput,
  PreviewDependencyServiceInput,
  PreviewPublishedOrigin,
  PreviewPublishedOriginInput,
  WiredPreview,
  WiredPreviewInput
} from "./types.js";

type WiredPreviewRow = {
  id: string;
  name: string;
  wiring_session_id: string | null;
  project_directory: string;
  target_name: string;
  target_url: string;
  dependency_services: string;
  commands: string;
  requested_published_origins: string;
  published_origins: string;
  created_at: string;
  updated_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function toPreview(row: WiredPreviewRow): WiredPreview {
  return {
    id: row.id,
    name: row.name,
    wiringSessionId: row.wiring_session_id,
    projectDirectory: row.project_directory,
    target: {
      name: row.target_name,
      url: row.target_url
    },
    dependencyServices: parseJsonArray<PreviewDependencyServiceInput>(row.dependency_services),
    commands: parseJsonArray<PreviewCommandInput>(row.commands),
    requestedPublishedOrigins: parseJsonArray<PreviewPublishedOriginInput>(row.requested_published_origins),
    publishedOrigins: parseJsonArray<PreviewPublishedOrigin>(row.published_origins),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class WiredPreviewStore {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  list(search?: string): WiredPreview[] {
    const term = search?.trim();
    const rows = term
      ? this.db
        .prepare(`
          SELECT id, name, wiring_session_id, project_directory, target_name, target_url, dependency_services, commands, requested_published_origins, published_origins, created_at, updated_at
          FROM wired_previews
          WHERE name LIKE ? ESCAPE '\\'
            OR project_directory LIKE ? ESCAPE '\\'
            OR target_url LIKE ? ESCAPE '\\'
          ORDER BY updated_at DESC, name COLLATE NOCASE ASC
        `)
        .all(searchPattern(term), searchPattern(term), searchPattern(term)) as WiredPreviewRow[]
      : this.db
        .prepare(`
          SELECT id, name, wiring_session_id, project_directory, target_name, target_url, dependency_services, commands, requested_published_origins, published_origins, created_at, updated_at
          FROM wired_previews
          ORDER BY updated_at DESC, name COLLATE NOCASE ASC
        `)
        .all() as WiredPreviewRow[];

    return rows.map(toPreview);
  }

  get(id: string): WiredPreview | null {
    const row = this.db
      .prepare(`
        SELECT id, name, wiring_session_id, project_directory, target_name, target_url, dependency_services, commands, requested_published_origins, published_origins, created_at, updated_at
        FROM wired_previews
        WHERE id = ?
      `)
      .get(id) as WiredPreviewRow | undefined;

    return row ? toPreview(row) : null;
  }

  create(input: WiredPreviewInput): WiredPreview {
    const id = randomUUID();
    const createdAt = nowIso();

    this.db
      .prepare(`
        INSERT INTO wired_previews (
          id, name, project_directory, target_name, target_url, dependency_services, commands, requested_published_origins, published_origins, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.name,
        input.projectDirectory,
        input.target.name,
        input.target.url,
        JSON.stringify(input.dependencyServices),
        JSON.stringify(input.commands),
        JSON.stringify(input.requestedPublishedOrigins),
        JSON.stringify([]),
        createdAt,
        createdAt
      );

    const preview = this.get(id);
    if (!preview) {
      throw new Error("Failed to create Wired Preview");
    }

    return preview;
  }

  update(id: string, input: WiredPreviewInput): WiredPreview | null {
    const updatedAt = nowIso();
    const result = this.db
      .prepare(`
        UPDATE wired_previews
        SET name = ?, project_directory = ?, target_name = ?, target_url = ?, dependency_services = ?, commands = ?, requested_published_origins = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        input.name,
        input.projectDirectory,
        input.target.name,
        input.target.url,
        JSON.stringify(input.dependencyServices),
        JSON.stringify(input.commands),
        JSON.stringify(input.requestedPublishedOrigins),
        updatedAt,
        id
      );

    if (result.changes === 0) {
      return null;
    }

    return this.get(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM wired_previews WHERE id = ?").run(id);
    return result.changes > 0;
  }

  setWiringSessionId(id: string, wiringSessionId: string): WiredPreview | null {
    const updatedAt = nowIso();
    const result = this.db
      .prepare(`
        UPDATE wired_previews
        SET wiring_session_id = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(wiringSessionId, updatedAt, id);

    return result.changes > 0 ? this.get(id) : null;
  }

  savePublishedOrigin(id: string, origin: PreviewPublishedOrigin): WiredPreview | null {
    const preview = this.get(id);
    if (!preview) {
      return null;
    }

    const origins = [
      origin,
      ...preview.publishedOrigins.filter((item) => item.id !== origin.id)
    ];
    return this.replacePublishedOrigins(id, origins);
  }

  updatePublishedOrigin(id: string, originId: string, update: Partial<Pick<PreviewPublishedOrigin, "status" | "error" | "updatedAt">>): WiredPreview | null {
    const preview = this.get(id);
    if (!preview || !preview.publishedOrigins.some((origin) => origin.id === originId)) {
      return null;
    }

    const updatedAt = update.updatedAt ?? nowIso();
    const origins = preview.publishedOrigins.map((origin) => (
      origin.id === originId
        ? {
          ...origin,
          ...update,
          updatedAt
        }
        : origin
    ));
    return this.replacePublishedOrigins(id, origins);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wired_previews (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        wiring_session_id TEXT,
        project_directory TEXT NOT NULL,
        target_name TEXT NOT NULL,
        target_url TEXT NOT NULL,
        dependency_services TEXT NOT NULL DEFAULT '[]',
        commands TEXT NOT NULL DEFAULT '[]',
        requested_published_origins TEXT NOT NULL DEFAULT '[]',
        published_origins TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    ensureColumn(this.db, "wired_previews", "requested_published_origins", "TEXT NOT NULL DEFAULT '[]'");
    ensureColumn(this.db, "wired_previews", "wiring_session_id", "TEXT");
    ensureColumn(this.db, "wired_previews", "published_origins", "TEXT NOT NULL DEFAULT '[]'");
  }

  private replacePublishedOrigins(id: string, origins: PreviewPublishedOrigin[]): WiredPreview | null {
    const updatedAt = nowIso();
    const result = this.db
      .prepare(`
        UPDATE wired_previews
        SET published_origins = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(JSON.stringify(origins), updatedAt, id);

    return result.changes > 0 ? this.get(id) : null;
  }
}

function searchPattern(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped}%`;
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
