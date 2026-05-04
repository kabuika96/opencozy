import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
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
  first_user_message?: string | null;
  rollout_path?: string | null;
};

const ROLLOUT_TAIL_READ_BYTES = 2_000_000;

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

  findThreadByFirstUserMessage(cwd: string, sinceMs: number, firstUserMessage: string): CodexThreadSummary | null {
    const normalizedPrompt = normalizeMatchText(firstUserMessage);
    if (!normalizedPrompt) {
      return null;
    }

    return this.read((db) => {
      const rows = db
        .prepare(`
          SELECT id, title, first_user_message
          FROM threads
          WHERE archived = 0
            AND cwd = ?
            AND COALESCE(created_at_ms, created_at * 1000) >= ?
            AND first_user_message != ''
          ORDER BY COALESCE(created_at_ms, created_at * 1000) DESC,
            COALESCE(updated_at_ms, updated_at * 1000) DESC
          LIMIT 20
        `)
        .all(cwd, sinceMs) as CodexThreadRow[];

      const matches = rows.filter((row) => normalizeMatchText(row.first_user_message || "") === normalizedPrompt);
      return matches.length === 1 ? { id: matches[0].id, title: matches[0].title || "" } : null;
    });
  }

  findThreadByRecentUserMessage(cwd: string, sinceMs: number, userMessage: string): CodexThreadSummary | null {
    const normalizedMessage = normalizeMatchText(userMessage);
    if (!normalizedMessage) {
      return null;
    }

    return this.read((db) => {
      const rows = db
        .prepare(`
          SELECT id, title, rollout_path
          FROM threads
          WHERE archived = 0
            AND cwd = ?
            AND COALESCE(updated_at_ms, updated_at * 1000) >= ?
            AND rollout_path != ''
          ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC,
            COALESCE(created_at_ms, created_at * 1000) DESC
          LIMIT 20
        `)
        .all(cwd, sinceMs) as CodexThreadRow[];

      const matches = rows.filter((row) => row.rollout_path && rolloutContainsUserMessage(row.rollout_path, normalizedMessage));
      return matches.length === 1 ? { id: matches[0].id, title: matches[0].title || "" } : null;
    });
  }

  findThreadInText(cwd: string, text: string): CodexThreadSummary | null {
    const normalizedText = normalizeMatchText(text);
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

function normalizeMatchText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function readFileTail(filePath: string): string {
  if (!existsSync(filePath)) {
    return "";
  }

  let fileDescriptor: number | null = null;
  try {
    fileDescriptor = openSync(filePath, "r");
    const size = fstatSync(fileDescriptor).size;
    const length = Math.min(size, ROLLOUT_TAIL_READ_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fileDescriptor, buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fileDescriptor !== null) {
      closeSync(fileDescriptor);
    }
  }
}

function rolloutContainsUserMessage(rolloutPath: string, normalizedMessage: string): boolean {
  const content = readFileTail(rolloutPath);
  if (!content) {
    return false;
  }

  for (const line of content.split(/\r?\n/)) {
    if (!line.includes("user_message") && !line.includes("input_text")) {
      continue;
    }

    const userMessages = extractRolloutUserMessages(line);
    if (userMessages.some((message) => normalizeMatchText(message) === normalizedMessage)) {
      return true;
    }
  }

  return false;
}

function extractRolloutUserMessages(line: string): string[] {
  try {
    const entry = JSON.parse(line) as Record<string, unknown>;
    const payload = entry.payload as Record<string, unknown> | undefined;
    if (!payload) {
      return [];
    }

    if (entry.type === "event_msg" && payload.type === "user_message" && typeof payload.message === "string") {
      return [payload.message];
    }

    if (entry.type === "response_item" && payload.type === "message" && payload.role === "user") {
      return extractTextContent(payload.content);
    }
  } catch {
    return [];
  }

  return [];
}

function extractTextContent(content: unknown): string[] {
  if (typeof content === "string") {
    return [content];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const messages: string[] = [];
  for (const item of content) {
    if (typeof item === "object" && item !== null) {
      const record = item as Record<string, unknown>;
      if (record.type === "input_text" && typeof record.text === "string") {
        messages.push(record.text);
      }
    }
  }

  return messages;
}

function titleMatchesText(title: string, normalizedText: string): boolean {
  const normalizedTitle = normalizeMatchText(title);
  if (!normalizedTitle) {
    return false;
  }

  if (normalizedText.includes(normalizedTitle)) {
    return true;
  }

  const titlePrefix = normalizedTitle.slice(0, Math.min(normalizedTitle.length, 32));
  return titlePrefix.length >= 12 && normalizedText.includes(titlePrefix);
}
