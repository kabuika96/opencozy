import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type CodexThreadSummary = {
  id: string;
  title: string;
};

type CodexThreadRow = {
  id: string;
  title: string | null;
};

export function defaultCodexStateDbPath(): string {
  return path.join(process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex"), "state_5.sqlite");
}

export class CodexThreadStore {
  constructor(private readonly dbPath: string) {}

  findActiveThread(cwd: string, sinceMs: number): CodexThreadSummary | null {
    return this.read((db) => {
      const row = db
        .prepare(`
          SELECT id, title
          FROM threads
          WHERE archived = 0
            AND cwd = ?
            AND COALESCE(updated_at_ms, updated_at * 1000) >= ?
          ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC,
            COALESCE(created_at_ms, created_at * 1000) DESC
          LIMIT 1
        `)
        .get(cwd, sinceMs) as CodexThreadRow | undefined;

      return row ? { id: row.id, title: row.title || "" } : null;
    });
  }

  getThread(id: string): CodexThreadSummary | null {
    return this.read((db) => {
      const row = db.prepare("SELECT id, title FROM threads WHERE id = ?").get(id) as CodexThreadRow | undefined;
      return row ? { id: row.id, title: row.title || "" } : null;
    });
  }

  findThreadInText(cwd: string, text: string): CodexThreadSummary | null {
    const normalizedText = normalizeTitleMatchText(text);
    if (!normalizedText) {
      return null;
    }

    return this.read((db) => {
      const rows = db
        .prepare(`
          SELECT id, title
          FROM threads
          WHERE archived = 0
            AND cwd = ?
            AND title != ''
          ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC,
            COALESCE(created_at_ms, created_at * 1000) DESC
          LIMIT 100
        `)
        .all(cwd) as CodexThreadRow[];

      for (const row of rows) {
        const title = row.title || "";
        if (titleMatchesText(title, normalizedText)) {
          return { id: row.id, title };
        }
      }

      return null;
    });
  }

  updateTitle(id: string, title: string): boolean {
    return this.write((db) => {
      const result = db.prepare("UPDATE threads SET title = ? WHERE id = ?").run(title, id);
      return result.changes > 0;
    });
  }

  private read<T>(operation: (db: DatabaseSync) => T): T | null {
    if (!existsSync(this.dbPath)) {
      return null;
    }

    const db = new DatabaseSync(this.dbPath, { readOnly: true });
    try {
      return operation(db);
    } catch {
      return null;
    } finally {
      db.close();
    }
  }

  private write<T>(operation: (db: DatabaseSync) => T): T | false {
    if (!existsSync(this.dbPath)) {
      return false;
    }

    const db = new DatabaseSync(this.dbPath);
    try {
      return operation(db);
    } catch {
      return false;
    } finally {
      db.close();
    }
  }
}

function normalizeTitleMatchText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function titleMatchesText(title: string, normalizedText: string): boolean {
  const normalizedTitle = normalizeTitleMatchText(title);
  if (!normalizedTitle) {
    return false;
  }

  if (normalizedText.includes(normalizedTitle)) {
    return true;
  }

  const titlePrefix = normalizedTitle.slice(0, Math.min(normalizedTitle.length, 32));
  return titlePrefix.length >= 12 && normalizedText.includes(titlePrefix);
}
