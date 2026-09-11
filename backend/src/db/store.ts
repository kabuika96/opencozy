import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolveExecutionProfile } from "../profiles/executionProfiles.js";
import type {
  HarnessType,
  PreviewCommandInput,
  PreviewDependencyServiceInput,
  PreviewManifest,
  PreviewManifestApproval,
  PreviewManifestInput,
  PreviewManifestStatus,
  PreviewPublishedOrigin,
  PreviewPublishedOriginInput,
  RunRecord,
  RunStatus,
  ThreadRecord,
  ThreadStatus,
  TimelineEventRecord,
  WiredPreview,
  WiredPreviewInput,
  WorkspaceRecord,
} from "../types.js";

type ThreadRow = {
  created_at: string;
  fast_mode: number;
  harness_thread_id: string | null;
  harness_type: HarnessType;
  id: string;
  owner_device_id: string | null;
  closed_at: string | null;
  profile_id: string;
  status: ThreadStatus;
  title: string;
  updated_at: string;
  wired_preview_id: string | null;
  workspace_path: string;
};

type RunRow = {
  completed_at: string | null;
  created_at: string;
  id: string;
  owner_heartbeat_at: string | null;
  owner_id: string | null;
  prompt: string;
  started_at: string | null;
  status: RunStatus;
  thread_id: string;
};

type TimelineEventRow = {
  compacted_by_event_id: string | null;
  created_at: string;
  hidden_from_timeline: number;
  id: string;
  payload_json: string;
  run_id: string | null;
  sequence: number;
  thread_id: string;
  type: string;
};

type WorkspaceRow = {
  path: string;
  updated_at: string;
};

type WiredPreviewRow = {
  commands: string;
  created_at: string;
  dependency_services: string;
  id: string;
  name: string;
  project_directory: string;
  published_origins: string;
  requested_published_origins: string;
  target_name: string;
  target_url: string;
  updated_at: string;
  wiring_thread_id: string | null;
};

type PreviewManifestRow = {
  approved_at: string | null;
  approved_wired_preview_id: string | null;
  commands: string;
  created_at: string;
  dependency_services: string;
  id: string;
  material_hash: string;
  project_directory: string;
  proposed_name: string;
  requested_published_origins: string;
  status: string;
  target_name: string;
  target_url: string;
  updated_at: string;
  wired_preview_id: string | null;
  wiring_thread_id: string | null;
};

type PreviewMaterial = {
  commands: PreviewCommandInput[];
  dependencyServices: PreviewDependencyServiceInput[];
  projectDirectory: string;
  requestedPublishedOrigins: PreviewPublishedOriginInput[];
  target: {
    name: string;
    url: string;
  };
};

type ManifestSubmitResult = {
  manifest: PreviewManifest;
  reused: boolean;
};

const wiredPreviewColumns = `
  id, name, wiring_thread_id, project_directory, target_name, target_url,
  dependency_services, commands, requested_published_origins, published_origins,
  created_at, updated_at
`;

const previewManifestColumns = `
  id, status, wired_preview_id, wiring_thread_id, approved_wired_preview_id,
  proposed_name, project_directory, target_name, target_url, dependency_services,
  commands, requested_published_origins, material_hash, created_at, updated_at,
  approved_at
`;

const maxThreadTitleLength = 120;

export type LiteHarnessStore = {
  attachmentDirectory: string;
  getThreadOwnerDeviceId(id: string): string | null;
  approvePreviewManifest(id: string, name: string): PreviewManifestApproval | null;
  claimRunOwner(id: string, ownerId: string): RunRecord | null;
  claimUnownedThreadsForDevice(deviceId: string): void;
  close(): void;
  createWiredPreview(input: WiredPreviewInput): WiredPreview;
  createRun(input: { prompt: string; threadId: string }): RunRecord;
  createThread(input: {
    deviceId?: string | null;
    fastMode?: boolean;
    harnessThreadId: string | null;
    harnessType: HarnessType;
    profileId?: string;
    title: string;
    workspacePath: string;
  }): ThreadRecord;
  deleteWiredPreview(id: string): boolean;
  deleteThread(id: string): boolean;
  setThreadClosed(id: string, closed: boolean): ThreadRecord | null;
  setThreadsClosed(ids: string[], closed: boolean): void;
  listClosedThreadsForDevice(deviceId: string): ThreadRecord[];
  getPreviewManifest(id: string): PreviewManifest | null;
  getRun(id: string): RunRecord | null;
  getThread(id: string): ThreadRecord | null;
  getThreadForDevice(id: string, deviceId: string, includeClosed?: boolean): ThreadRecord | null;
  getWiredPreview(id: string): WiredPreview | null;
  heartbeatRunOwner(id: string, ownerId: string): void;
  listActiveRunLeases(): RunLeaseRecord[];
  listActiveRuns(): RunRecord[];
  listPreviewManifests(status?: PreviewManifestStatus): PreviewManifest[];
  listThreads(): ThreadRecord[];
  listThreadsForDevice(deviceId: string): ThreadRecord[];
  listTimeline(threadId: string): TimelineEventRecord[];
  listWiredPreviews(search?: string): WiredPreview[];
  latestCompactionEvent(threadId: string): TimelineEventRecord | null;
  compactTimeline(input: {
    hiddenEventIds: string[];
    payload: Record<string, unknown>;
    threadId: string;
    type: string;
  }): TimelineEventRecord;
  recordTimelineEvent(input: {
    payload?: Record<string, unknown>;
    runId: string | null;
    threadId: string;
    type: string;
  }): TimelineEventRecord;
  rememberWorkspace(path: string): WorkspaceRecord;
  savePublishedOrigin(id: string, origin: PreviewPublishedOrigin): WiredPreview | null;
  setWiredPreviewWiringThreadId(id: string, wiringThreadId: string): WiredPreview | null;
  submitPreviewManifest(input: PreviewManifestInput): ManifestSubmitResult;
  updatePublishedOrigin(id: string, originId: string, update: Partial<Pick<PreviewPublishedOrigin, "error" | "status" | "updatedAt">>): WiredPreview | null;
  updateRunStatus(id: string, status: RunStatus): RunRecord | null;
  updateThread(input: {
    fastMode?: boolean;
    harnessThreadId?: string | null;
    id: string;
    profileId?: string;
    status?: ThreadStatus;
    title?: string;
    wiredPreviewId?: string | null;
  }): ThreadRecord | null;
  updateWiredPreview(id: string, input: WiredPreviewInput): WiredPreview | null;
};

export type RunLeaseRecord = RunRecord & {
  ownerHeartbeatAt: string | null;
  ownerId: string | null;
};

export function createStore(dbPath = process.env.LITEHARNESS_DB_PATH ?? "./data/liteharness.sqlite"): LiteHarnessStore {
  const resolvedPath = resolve(process.cwd(), dbPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  const db = new DatabaseSync(resolvedPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);

  return {
    attachmentDirectory: resolve(dirname(resolvedPath), "attachments"),
    getThreadOwnerDeviceId(id) {
      const row = db.prepare("SELECT owner_device_id FROM threads WHERE id=?").get(id) as { owner_device_id: string | null } | undefined;
      return row?.owner_device_id ?? null;
    },
    claimRunOwner(id, ownerId) {
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE runs
        SET status = 'running',
            started_at = COALESCE(started_at, ?),
            completed_at = NULL,
            owner_id = ?,
            owner_heartbeat_at = ?
        WHERE id = ?
      `).run(now, ownerId, now, id);
      const row = selectRun(db, id);
      return row ? rowToRun(row) : null;
    },
    claimUnownedThreadsForDevice(deviceId) {
      db.prepare(`
        UPDATE threads
        SET owner_device_id = ?
        WHERE owner_device_id IS NULL
      `).run(deviceId);
      deduplicateThreadTitles(db);
    },
    close() {
      db.close();
    },
    approvePreviewManifest(id, name) {
      const manifest = selectPreviewManifest(db, id);
      if (!manifest) {
        return null;
      }
      const current = rowToPreviewManifest(manifest);

      if (current.status === "approved") {
        const approvedPreview = current.approvedWiredPreviewId ? selectWiredPreview(db, current.approvedWiredPreviewId) : null;
        return approvedPreview ? { manifest: current, wiredPreview: rowToWiredPreview(approvedPreview) } : null;
      }

      const input = manifestToWiredPreviewInput(current, name);
      const existingPreview = current.wiredPreviewId ? selectWiredPreview(db, current.wiredPreviewId) : null;
      const wiredPreview = existingPreview
        ? updateWiredPreviewRow(db, existingPreview.id, input)
        : createWiredPreviewRow(db, input);
      if (!wiredPreview) {
        return null;
      }

      const withThread = current.wiringThreadId
        ? setWiredPreviewWiringThreadIdRow(db, wiredPreview.id, current.wiringThreadId) ?? wiredPreview
        : wiredPreview;
      const approved = markPreviewManifestApproved(db, current.id, name, wiredPreview.id);
      return approved ? { manifest: approved, wiredPreview: withThread } : null;
    },
    createWiredPreview(input) {
      return createWiredPreviewRow(db, input);
    },
    createRun(input) {
      const now = new Date().toISOString();
      const id = randomUUID();
      db.prepare(`
        INSERT INTO runs (id, thread_id, prompt, status, started_at, completed_at, created_at)
        VALUES (?, ?, ?, 'queued', NULL, NULL, ?)
      `).run(id, input.threadId, input.prompt, now);
      return rowToRun(selectRequiredRun(db, id));
    },
    createThread(input) {
      const now = new Date().toISOString();
      const id = randomUUID();
      const ownerDeviceId = normalizeOwnerDeviceId(input.deviceId);
      const title = uniqueThreadTitle(db, input.title, undefined, ownerDeviceId);
      db.prepare(`
        INSERT INTO threads (
          id, owner_device_id, harness_type, harness_thread_id, title, workspace_path,
          wired_preview_id, profile_id, fast_mode, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'idle', ?, ?)
      `).run(
        id,
        ownerDeviceId,
        input.harnessType,
        input.harnessThreadId,
        title,
        input.workspacePath,
        resolveExecutionProfile(input.profileId).id,
        input.fastMode === false ? 0 : 1,
        now,
        now,
      );
      return rowToThread(selectThread(db, id));
    },
    setThreadsClosed(ids, closed) {
      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        const statement = db.prepare("UPDATE threads SET closed_at = ?, updated_at = ? WHERE id = ?");
        for (const id of ids) statement.run(closed ? now : null, now, id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    setThreadClosed(id, closed) {
      db.prepare("UPDATE threads SET closed_at = ?, updated_at = ? WHERE id = ?").run(
        closed ? new Date().toISOString() : null, new Date().toISOString(), id,
      );
      const row = selectThread(db, id);
      return row ? rowToThread(row) : null;
    },
    listClosedThreadsForDevice(deviceId) {
      return db.prepare("SELECT * FROM threads WHERE owner_device_id = ? AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 100")
        .all(deviceId).map(row => rowToThread(row as ThreadRow));
    },
    deleteThread(id) {
      const result = db.prepare("DELETE FROM threads WHERE id = ?").run(id);
      return result.changes > 0;
    },
    deleteWiredPreview(id) {
      db.prepare("UPDATE threads SET wired_preview_id = NULL, updated_at = ? WHERE wired_preview_id = ?")
        .run(new Date().toISOString(), id);
      const result = db.prepare("DELETE FROM wired_previews WHERE id = ?").run(id);
      return result.changes > 0;
    },
    getPreviewManifest(id) {
      const row = selectPreviewManifest(db, id);
      return row ? rowToPreviewManifest(row) : null;
    },
    getRun(id) {
      const row = selectRun(db, id);
      return row ? rowToRun(row) : null;
    },
    getThread(id) {
      const row = selectThread(db, id);
      return row ? rowToThread(row) : null;
    },
    getThreadForDevice(id, deviceId, includeClosed = false) {
      const row = selectThreadForDevice(db, id, deviceId);
      return row && (includeClosed || !row.closed_at) ? rowToThread(row) : null;
    },
    getWiredPreview(id) {
      const row = selectWiredPreview(db, id);
      return row ? rowToWiredPreview(row) : null;
    },
    heartbeatRunOwner(id, ownerId) {
      db.prepare(`
        UPDATE runs
        SET owner_heartbeat_at = ?
        WHERE id = ?
          AND owner_id = ?
          AND status IN ('queued', 'running', 'needs_approval', 'needs_input')
      `).run(new Date().toISOString(), id, ownerId);
    },
    listActiveRunLeases() {
      return db.prepare(`
        SELECT * FROM runs
        WHERE status IN ('queued', 'running', 'needs_approval', 'needs_input')
        ORDER BY created_at ASC
      `).all().map((row) => rowToRunLease(row as RunRow));
    },
    listActiveRuns() {
      return db.prepare(`
        SELECT * FROM runs
        WHERE status IN ('queued', 'running', 'needs_approval', 'needs_input')
        ORDER BY created_at ASC
      `).all().map((row) => rowToRun(row as RunRow));
    },
    listPreviewManifests(status) {
      const rows = status
        ? db.prepare(`
          SELECT ${previewManifestColumns}
          FROM preview_manifests
          WHERE status = ?
          ORDER BY updated_at DESC, created_at DESC
        `).all(status)
        : db.prepare(`
          SELECT ${previewManifestColumns}
          FROM preview_manifests
          ORDER BY updated_at DESC, created_at DESC
        `).all();
      return rows.map((row) => rowToPreviewManifest(row as PreviewManifestRow));
    },
    listThreads() {
      return db.prepare(`
        SELECT * FROM threads
        WHERE closed_at IS NULL
        ORDER BY updated_at DESC
      `).all().map((row) => rowToThread(row as ThreadRow));
    },
    listThreadsForDevice(deviceId) {
      return db.prepare(`
        SELECT * FROM threads
        WHERE owner_device_id = ? AND closed_at IS NULL
        ORDER BY updated_at DESC
      `).all(deviceId).map((row) => rowToThread(row as ThreadRow));
    },
    listTimeline(threadId) {
      return db.prepare(`
        SELECT * FROM timeline_events
        WHERE thread_id = ?
          AND hidden_from_timeline = 0
        ORDER BY sequence ASC
      `).all(threadId)
        .map((row) => rowToTimelineEvent(row as TimelineEventRow))
        .filter((event) => !isBackendRecoveryEvent(event));
    },
    listWiredPreviews(search) {
      const term = search?.trim();
      const rows = term
        ? db.prepare(`
          SELECT ${wiredPreviewColumns}
          FROM wired_previews
          WHERE name LIKE ? ESCAPE '\\'
            OR project_directory LIKE ? ESCAPE '\\'
            OR target_url LIKE ? ESCAPE '\\'
          ORDER BY updated_at DESC, name COLLATE NOCASE ASC
        `).all(searchPattern(term), searchPattern(term), searchPattern(term))
        : db.prepare(`
          SELECT ${wiredPreviewColumns}
          FROM wired_previews
          ORDER BY updated_at DESC, name COLLATE NOCASE ASC
        `).all();
      return rows.map((row) => rowToWiredPreview(row as WiredPreviewRow));
    },
    latestCompactionEvent(threadId) {
      const row = db.prepare(`
        SELECT * FROM timeline_events
        WHERE thread_id = ?
          AND hidden_from_timeline = 0
          AND type = 'thread.compacted'
        ORDER BY sequence DESC
        LIMIT 1
      `).get(threadId) as TimelineEventRow | undefined;
      return row ? rowToTimelineEvent(row) : null;
    },
    compactTimeline(input) {
      if (input.hiddenEventIds.length === 0) {
        throw new Error("Compaction requires at least one hidden event");
      }
      const now = new Date().toISOString();
      const id = randomUUID();
      db.exec("BEGIN IMMEDIATE");
      try {
        const insertionSequence = minSequenceForEvents(db, input.threadId, input.hiddenEventIds);
        if (insertionSequence === null) {
          throw new Error("Compaction event range was not found");
        }
        db.prepare(`
          UPDATE timeline_events
          SET sequence = sequence + 1000000
          WHERE thread_id = ?
            AND sequence >= ?
        `).run(input.threadId, insertionSequence);
        db.prepare(`
          UPDATE timeline_events
          SET sequence = sequence - 999999
          WHERE thread_id = ?
            AND sequence >= ?
        `).run(input.threadId, insertionSequence + 1000000);
        db.prepare(`
          INSERT INTO timeline_events (id, thread_id, run_id, sequence, type, payload_json, created_at)
          VALUES (?, ?, NULL, ?, ?, ?, ?)
        `).run(
          id,
          input.threadId,
          insertionSequence,
          input.type,
          JSON.stringify(input.payload),
          now,
        );
        for (const chunk of chunks(input.hiddenEventIds, 300)) {
          const placeholders = chunk.map(() => "?").join(", ");
          db.prepare(`
            UPDATE timeline_events
            SET compacted_by_event_id = ?,
                hidden_from_timeline = 1
            WHERE thread_id = ?
              AND id IN (${placeholders})
          `).run(id, input.threadId, ...chunk);
        }
        db.prepare(`
          UPDATE threads
          SET harness_thread_id = NULL,
              updated_at = ?
          WHERE id = ?
        `).run(now, input.threadId);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return rowToTimelineEvent(selectTimelineEvent(db, id));
    },
    recordTimelineEvent(input) {
      const now = new Date().toISOString();
      const id = randomUUID();
      const sequenceRow = db.prepare(`
        SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
        FROM timeline_events
        WHERE thread_id = ?
      `).get(input.threadId) as { sequence: number };
      const sequence = sequenceRow.sequence;
      db.prepare(`
        INSERT INTO timeline_events (id, thread_id, run_id, sequence, type, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.threadId,
        input.runId,
        sequence,
        input.type,
        JSON.stringify(input.payload ?? {}),
        now,
      );
      return rowToTimelineEvent(selectTimelineEvent(db, id));
    },
    rememberWorkspace(path) {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO workspaces (path, updated_at)
        VALUES (?, ?)
        ON CONFLICT(path) DO UPDATE SET updated_at = excluded.updated_at
      `).run(path, now);
      return rowToWorkspace(db.prepare("SELECT * FROM workspaces WHERE path = ?").get(path) as WorkspaceRow);
    },
    savePublishedOrigin(id, origin) {
      const preview = selectWiredPreview(db, id);
      if (!preview) {
        return null;
      }
      const current = rowToWiredPreview(preview);
      const origins = [
        origin,
        ...current.publishedOrigins.filter((item) => item.id !== origin.id),
      ];
      return replacePublishedOrigins(db, id, origins);
    },
    setWiredPreviewWiringThreadId(id, wiringThreadId) {
      return setWiredPreviewWiringThreadIdRow(db, id, wiringThreadId);
    },
    submitPreviewManifest(input) {
      return submitPreviewManifestRow(db, input);
    },
    updatePublishedOrigin(id, originId, update) {
      const preview = selectWiredPreview(db, id);
      if (!preview) {
        return null;
      }
      const current = rowToWiredPreview(preview);
      if (!current.publishedOrigins.some((origin) => origin.id === originId)) {
        return null;
      }
      const updatedAt = update.updatedAt ?? new Date().toISOString();
      const origins = current.publishedOrigins.map((origin) => (
        origin.id === originId
          ? { ...origin, ...update, updatedAt }
          : origin
      ));
      return replacePublishedOrigins(db, id, origins);
    },
    updateRunStatus(id, status) {
      const completedAt = isTerminalRunStatus(status) ? new Date().toISOString() : null;
      const startedAt = status === "running" ? new Date().toISOString() : null;
      if (completedAt) {
        db.prepare(`
          UPDATE runs
          SET status = ?,
              started_at = COALESCE(started_at, ?),
              completed_at = ?,
              owner_id = NULL,
              owner_heartbeat_at = NULL
          WHERE id = ?
        `).run(status, startedAt, completedAt, id);
      } else {
        db.prepare(`
          UPDATE runs
          SET status = ?,
              started_at = COALESCE(started_at, ?),
              completed_at = COALESCE(?, completed_at)
          WHERE id = ?
        `).run(status, startedAt, completedAt, id);
      }
      const row = selectRun(db, id);
      return row ? rowToRun(row) : null;
    },
    updateThread(input) {
      const current = selectThread(db, input.id);
      if (!current) {
        return null;
      }
      const next = {
        fastMode: input.fastMode === undefined ? current.fast_mode : input.fastMode ? 1 : 0,
        harnessThreadId: input.harnessThreadId === undefined ? current.harness_thread_id : input.harnessThreadId,
        profileId: input.profileId === undefined ? current.profile_id : resolveExecutionProfile(input.profileId).id,
        status: input.status ?? current.status,
        title: input.title === undefined ? current.title : uniqueThreadTitle(db, input.title, input.id, current.owner_device_id),
        wiredPreviewId: input.wiredPreviewId === undefined ? current.wired_preview_id : input.wiredPreviewId,
      };
      db.prepare(`
        UPDATE threads
        SET fast_mode = ?,
            harness_thread_id = ?,
            profile_id = ?,
            status = ?,
            title = ?,
            wired_preview_id = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        next.fastMode,
        next.harnessThreadId,
        next.profileId,
        next.status,
        next.title,
        next.wiredPreviewId,
        new Date().toISOString(),
        input.id,
      );
      return rowToThread(selectThread(db, input.id));
    },
    updateWiredPreview(id, input) {
      return updateWiredPreviewRow(db, id, input);
    },
  };
}

function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      path TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      owner_device_id TEXT,
      harness_type TEXT NOT NULL,
      harness_thread_id TEXT,
      profile_id TEXT NOT NULL DEFAULT 'default',
      fast_mode INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      wired_preview_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      owner_id TEXT,
      owner_heartbeat_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS timeline_events (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      hidden_from_timeline INTEGER NOT NULL DEFAULT 0,
      compacted_by_event_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(thread_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS wired_previews (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      wiring_thread_id TEXT,
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

    CREATE TABLE IF NOT EXISTS preview_manifests (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
      wired_preview_id TEXT,
      wiring_thread_id TEXT,
      approved_wired_preview_id TEXT,
      proposed_name TEXT NOT NULL,
      project_directory TEXT NOT NULL,
      target_name TEXT NOT NULL,
      target_url TEXT NOT NULL,
      dependency_services TEXT NOT NULL DEFAULT '[]',
      commands TEXT NOT NULL DEFAULT '[]',
      requested_published_origins TEXT NOT NULL DEFAULT '[]',
      material_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      approved_at TEXT
    );

    CREATE INDEX IF NOT EXISTS preview_manifests_status_idx
      ON preview_manifests(status, updated_at);

    CREATE INDEX IF NOT EXISTS preview_manifests_material_idx
      ON preview_manifests(material_hash, status);
  `);
  ensureColumn(db, "runs", "owner_id", "owner_id TEXT");
  ensureColumn(db, "runs", "owner_heartbeat_at", "owner_heartbeat_at TEXT");
  ensureColumn(db, "threads", "owner_device_id", "owner_device_id TEXT");
  ensureColumn(db, "threads", "closed_at", "closed_at TEXT");
  ensureColumn(db, "threads", "profile_id", "profile_id TEXT NOT NULL DEFAULT 'default'");
  ensureColumn(db, "threads", "fast_mode", "fast_mode INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "threads", "wired_preview_id", "wired_preview_id TEXT");
  ensureColumn(db, "timeline_events", "hidden_from_timeline", "hidden_from_timeline INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "timeline_events", "compacted_by_event_id", "compacted_by_event_id TEXT");
  ensureColumn(db, "wired_previews", "wiring_thread_id", "wiring_thread_id TEXT");
  ensureColumn(db, "wired_previews", "requested_published_origins", "requested_published_origins TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "wired_previews", "published_origins", "published_origins TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "preview_manifests", "wiring_thread_id", "wiring_thread_id TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS threads_owner_device_updated_idx
      ON threads(owner_device_id, updated_at);
  `);
  deduplicateThreadTitles(db);
}

function ensureColumn(db: DatabaseSync, tableName: string, columnName: string, ddl: string): void {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${ddl}`);
}

function selectThread(db: DatabaseSync, id: string): ThreadRow | null {
  return (db.prepare("SELECT * FROM threads WHERE id = ?").get(id) as ThreadRow | undefined) ?? null;
}

function selectThreadForDevice(db: DatabaseSync, id: string, deviceId: string): ThreadRow | null {
  return (db.prepare(`
    SELECT * FROM threads
    WHERE id = ?
      AND owner_device_id = ?
  `).get(id, deviceId) as ThreadRow | undefined) ?? null;
}

function selectRun(db: DatabaseSync, id: string): RunRow | null {
  const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
  return row ?? null;
}

function selectRequiredRun(db: DatabaseSync, id: string): RunRow {
  const row = selectRun(db, id);
  if (!row) {
    throw new Error(`Run not found: ${id}`);
  }
  return row;
}

function selectTimelineEvent(db: DatabaseSync, id: string): TimelineEventRow {
  const row = db.prepare("SELECT * FROM timeline_events WHERE id = ?").get(id) as TimelineEventRow | undefined;
  if (!row) {
    throw new Error(`Timeline event not found: ${id}`);
  }
  return row;
}

function selectWiredPreview(db: DatabaseSync, id: string): WiredPreviewRow | null {
  return (db.prepare(`
    SELECT ${wiredPreviewColumns}
    FROM wired_previews
    WHERE id = ?
  `).get(id) as WiredPreviewRow | undefined) ?? null;
}

function selectPreviewManifest(db: DatabaseSync, id: string): PreviewManifestRow | null {
  return (db.prepare(`
    SELECT ${previewManifestColumns}
    FROM preview_manifests
    WHERE id = ?
  `).get(id) as PreviewManifestRow | undefined) ?? null;
}

function createWiredPreviewRow(db: DatabaseSync, input: WiredPreviewInput): WiredPreview {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO wired_previews (
      id, name, project_directory, target_name, target_url, dependency_services,
      commands, requested_published_origins, published_origins, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.projectDirectory,
    input.target.name,
    input.target.url,
    JSON.stringify(input.dependencyServices),
    JSON.stringify(input.commands),
    JSON.stringify(input.requestedPublishedOrigins),
    JSON.stringify([]),
    now,
    now,
  );

  const row = selectWiredPreview(db, id);
  if (!row) {
    throw new Error("Failed to create Wired Preview");
  }
  return rowToWiredPreview(row);
}

function updateWiredPreviewRow(db: DatabaseSync, id: string, input: WiredPreviewInput): WiredPreview | null {
  const result = db.prepare(`
    UPDATE wired_previews
    SET name = ?,
        project_directory = ?,
        target_name = ?,
        target_url = ?,
        dependency_services = ?,
        commands = ?,
        requested_published_origins = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    input.name,
    input.projectDirectory,
    input.target.name,
    input.target.url,
    JSON.stringify(input.dependencyServices),
    JSON.stringify(input.commands),
    JSON.stringify(input.requestedPublishedOrigins),
    new Date().toISOString(),
    id,
  );
  return result.changes > 0 ? rowToWiredPreview(selectWiredPreviewRequired(db, id)) : null;
}

function setWiredPreviewWiringThreadIdRow(db: DatabaseSync, id: string, wiringThreadId: string): WiredPreview | null {
  const result = db.prepare(`
    UPDATE wired_previews
    SET wiring_thread_id = ?,
        updated_at = ?
    WHERE id = ?
  `).run(wiringThreadId, new Date().toISOString(), id);
  return result.changes > 0 ? rowToWiredPreview(selectWiredPreviewRequired(db, id)) : null;
}

function replacePublishedOrigins(db: DatabaseSync, id: string, origins: PreviewPublishedOrigin[]): WiredPreview | null {
  const result = db.prepare(`
    UPDATE wired_previews
    SET published_origins = ?,
        updated_at = ?
    WHERE id = ?
  `).run(JSON.stringify(origins), new Date().toISOString(), id);
  return result.changes > 0 ? rowToWiredPreview(selectWiredPreviewRequired(db, id)) : null;
}

function selectWiredPreviewRequired(db: DatabaseSync, id: string): WiredPreviewRow {
  const row = selectWiredPreview(db, id);
  if (!row) {
    throw new Error(`Wired Preview not found: ${id}`);
  }
  return row;
}

function submitPreviewManifestRow(db: DatabaseSync, input: PreviewManifestInput): ManifestSubmitResult {
  const materialHash = computePreviewMaterialHash(input);

  if (input.wiredPreviewId) {
    const existingPreview = selectWiredPreview(db, input.wiredPreviewId);
    if (existingPreview && computePreviewMaterialHash(rowToWiredPreview(existingPreview)) === materialHash) {
      return {
        manifest: findApprovedPreviewManifestByPreviewAndHash(db, input.wiredPreviewId, materialHash)
          ?? createPreviewManifestRow(db, input, "approved", input.wiredPreviewId),
        reused: true,
      };
    }

    const pending = findPendingPreviewManifestByHash(db, materialHash, input.wiredPreviewId);
    if (pending) {
      return { manifest: pending, reused: true };
    }

    return { manifest: createPreviewManifestRow(db, input, "pending", null), reused: false };
  }

  const approved = findApprovedPreviewManifestByHash(db, materialHash);
  if (approved) {
    return { manifest: approved, reused: true };
  }

  const matchingPreview = findWiredPreviewByMaterialHash(db, materialHash);
  if (matchingPreview) {
    return {
      manifest: findApprovedPreviewManifestByPreviewAndHash(db, matchingPreview.id, materialHash)
        ?? createPreviewManifestRow(db, { ...input, wiredPreviewId: matchingPreview.id }, "approved", matchingPreview.id),
      reused: true,
    };
  }

  const pending = findPendingPreviewManifestByHash(db, materialHash, null);
  if (pending) {
    return { manifest: pending, reused: true };
  }

  return { manifest: createPreviewManifestRow(db, input, "pending", null), reused: false };
}

function createPreviewManifestRow(
  db: DatabaseSync,
  input: PreviewManifestInput,
  status: PreviewManifestStatus,
  approvedWiredPreviewId: string | null,
): PreviewManifest {
  const id = randomUUID();
  const now = new Date().toISOString();
  const approvedAt = status === "approved" ? now : null;
  db.prepare(`
    INSERT INTO preview_manifests (
      id, status, wired_preview_id, wiring_thread_id, approved_wired_preview_id,
      proposed_name, project_directory, target_name, target_url, dependency_services,
      commands, requested_published_origins, material_hash, created_at, updated_at, approved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    status,
    input.wiredPreviewId ?? null,
    input.wiringThreadId ?? null,
    approvedWiredPreviewId,
    input.name,
    input.projectDirectory,
    input.target.name,
    input.target.url,
    JSON.stringify(input.dependencyServices),
    JSON.stringify(input.commands),
    JSON.stringify(input.requestedPublishedOrigins),
    computePreviewMaterialHash(input),
    now,
    now,
    approvedAt,
  );

  const row = selectPreviewManifest(db, id);
  if (!row) {
    throw new Error("Failed to create Preview Manifest");
  }
  return rowToPreviewManifest(row);
}

function markPreviewManifestApproved(db: DatabaseSync, id: string, name: string, approvedWiredPreviewId: string): PreviewManifest | null {
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE preview_manifests
    SET status = 'approved',
        proposed_name = ?,
        approved_wired_preview_id = ?,
        updated_at = ?,
        approved_at = ?
    WHERE id = ?
  `).run(name, approvedWiredPreviewId, now, now, id);
  const row = result.changes > 0 ? selectPreviewManifest(db, id) : null;
  return row ? rowToPreviewManifest(row) : null;
}

function findApprovedPreviewManifestByHash(db: DatabaseSync, materialHash: string): PreviewManifest | null {
  const row = db.prepare(`
    SELECT ${previewManifestColumns}
    FROM preview_manifests
    WHERE status = 'approved'
      AND material_hash = ?
      AND approved_wired_preview_id IS NOT NULL
    ORDER BY approved_at DESC, updated_at DESC
    LIMIT 1
  `).get(materialHash) as PreviewManifestRow | undefined;
  return row ? rowToPreviewManifest(row) : null;
}

function findApprovedPreviewManifestByPreviewAndHash(db: DatabaseSync, wiredPreviewId: string, materialHash: string): PreviewManifest | null {
  const row = db.prepare(`
    SELECT ${previewManifestColumns}
    FROM preview_manifests
    WHERE status = 'approved'
      AND material_hash = ?
      AND approved_wired_preview_id = ?
    ORDER BY approved_at DESC, updated_at DESC
    LIMIT 1
  `).get(materialHash, wiredPreviewId) as PreviewManifestRow | undefined;
  return row ? rowToPreviewManifest(row) : null;
}

function findPendingPreviewManifestByHash(db: DatabaseSync, materialHash: string, wiredPreviewId: string | null): PreviewManifest | null {
  const row = wiredPreviewId
    ? db.prepare(`
      SELECT ${previewManifestColumns}
      FROM preview_manifests
      WHERE status = 'pending'
        AND material_hash = ?
        AND wired_preview_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(materialHash, wiredPreviewId) as PreviewManifestRow | undefined
    : db.prepare(`
      SELECT ${previewManifestColumns}
      FROM preview_manifests
      WHERE status = 'pending'
        AND material_hash = ?
        AND wired_preview_id IS NULL
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(materialHash) as PreviewManifestRow | undefined;
  return row ? rowToPreviewManifest(row) : null;
}

function findWiredPreviewByMaterialHash(db: DatabaseSync, materialHash: string): WiredPreview | null {
  const rows = db.prepare(`
    SELECT ${wiredPreviewColumns}
    FROM wired_previews
    ORDER BY updated_at DESC, name COLLATE NOCASE ASC
  `).all() as WiredPreviewRow[];
  return rows.map(rowToWiredPreview).find((preview) => computePreviewMaterialHash(preview) === materialHash) ?? null;
}

function deduplicateThreadTitles(db: DatabaseSync): void {
  const rows = db.prepare(`
    SELECT id, owner_device_id, title
    FROM threads
    ORDER BY created_at ASC, id ASC
  `).all() as Array<{ id: string; owner_device_id: string | null; title: string }>;
  const occupiedByOwner = new Map<string, Set<string>>();
  for (const row of rows) {
    const groupKey = row.owner_device_id ?? "";
    const occupied = occupiedByOwner.get(groupKey) ?? new Set<string>();
    occupiedByOwner.set(groupKey, occupied);
    const title = nextUniqueThreadTitle(row.title, occupied);
    occupied.add(normalizeThreadTitle(title));
    if (title !== row.title) {
      db.prepare("UPDATE threads SET title = ? WHERE id = ?").run(title, row.id);
    }
  }
}

function uniqueThreadTitle(
  db: DatabaseSync,
  requestedTitle: string,
  excludedThreadId?: string,
  ownerDeviceId?: string | null,
): string {
  const rows = ownerDeviceId
    ? excludedThreadId
      ? db.prepare("SELECT title FROM threads WHERE owner_device_id = ? AND id != ?").all(ownerDeviceId, excludedThreadId)
      : db.prepare("SELECT title FROM threads WHERE owner_device_id = ?").all(ownerDeviceId)
    : excludedThreadId
      ? db.prepare("SELECT title FROM threads WHERE owner_device_id IS NULL AND id != ?").all(excludedThreadId)
      : db.prepare("SELECT title FROM threads WHERE owner_device_id IS NULL").all();
  const occupied = new Set(
    (rows as Array<{ title: string }>).map((row) => normalizeThreadTitle(row.title)),
  );
  return nextUniqueThreadTitle(requestedTitle, occupied);
}

function normalizeOwnerDeviceId(deviceId: string | null | undefined): string | null {
  const normalized = deviceId?.trim();
  return normalized ? normalized : null;
}

function nextUniqueThreadTitle(requestedTitle: string, occupied: Set<string>): string {
  const base = cleanThreadTitle(requestedTitle);
  if (!occupied.has(normalizeThreadTitle(base))) {
    return base;
  }

  for (let suffixNumber = 2; ; suffixNumber += 1) {
    const suffix = ` ${suffixNumber}`;
    const candidate = `${cleanThreadTitle(base, maxThreadTitleLength - suffix.length)}${suffix}`;
    if (!occupied.has(normalizeThreadTitle(candidate))) {
      return candidate;
    }
  }
}

function cleanThreadTitle(title: string, maxLength = maxThreadTitleLength): string {
  return (title.trim() || "Thread").slice(0, Math.max(1, maxLength)).trimEnd() || "Thread";
}

function normalizeThreadTitle(title: string): string {
  return cleanThreadTitle(title).toLowerCase();
}

function minSequenceForEvents(db: DatabaseSync, threadId: string, eventIds: string[]): number | null {
  let minSequence: number | null = null;
  for (const chunk of chunks(eventIds, 300)) {
    const placeholders = chunk.map(() => "?").join(", ");
    const row = db.prepare(`
      SELECT MIN(sequence) AS sequence
      FROM timeline_events
      WHERE thread_id = ?
        AND hidden_from_timeline = 0
        AND id IN (${placeholders})
    `).get(threadId, ...chunk) as { sequence: number | null };
    if (typeof row.sequence === "number" && (minSequence === null || row.sequence < minSequence)) {
      minSequence = row.sequence;
    }
  }
  return minSequence;
}

function chunks<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

function rowToThread(row: ThreadRow | null): ThreadRecord {
  if (!row) {
    throw new Error("Thread row was not found");
  }
  return {
    createdAt: row.created_at,
    fastMode: row.fast_mode !== 0,
    harnessThreadId: row.harness_thread_id,
    harnessType: row.harness_type,
    id: row.id,
    profileId: resolveExecutionProfile(row.profile_id).id,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
    wiredPreviewId: row.wired_preview_id ?? null,
    workspacePath: row.workspace_path,
  };
}

function rowToRun(row: RunRow): RunRecord {
  return {
    completedAt: row.completed_at,
    createdAt: row.created_at,
    id: row.id,
    prompt: row.prompt,
    startedAt: row.started_at,
    status: row.status,
    threadId: row.thread_id,
  };
}

function rowToRunLease(row: RunRow): RunLeaseRecord {
  return {
    ...rowToRun(row),
    ownerHeartbeatAt: row.owner_heartbeat_at,
    ownerId: row.owner_id,
  };
}

function rowToTimelineEvent(row: TimelineEventRow): TimelineEventRecord {
  return {
    createdAt: row.created_at,
    id: row.id,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    runId: row.run_id,
    sequence: row.sequence,
    threadId: row.thread_id,
    type: row.type,
  };
}

function isBackendRecoveryEvent(event: TimelineEventRecord): boolean {
  return event.type === "harness.status"
    && typeof event.payload.stableKey === "string"
    && /^run:[^:]+:backend-recovery$/.test(event.payload.stableKey);
}

function rowToWorkspace(row: WorkspaceRow): WorkspaceRecord {
  return {
    path: row.path,
    updatedAt: row.updated_at,
  };
}

function rowToWiredPreview(row: WiredPreviewRow): WiredPreview {
  return {
    commands: parseJsonArray<PreviewCommandInput>(row.commands),
    createdAt: row.created_at,
    dependencyServices: parseJsonArray<PreviewDependencyServiceInput>(row.dependency_services),
    id: row.id,
    name: row.name,
    projectDirectory: row.project_directory,
    publishedOrigins: parseJsonArray<PreviewPublishedOrigin>(row.published_origins),
    requestedPublishedOrigins: parseJsonArray<PreviewPublishedOriginInput>(row.requested_published_origins),
    target: {
      name: row.target_name,
      url: row.target_url,
    },
    updatedAt: row.updated_at,
    wiringThreadId: row.wiring_thread_id,
  };
}

function rowToPreviewManifest(row: PreviewManifestRow): PreviewManifest {
  return {
    approvedAt: row.approved_at,
    approvedWiredPreviewId: row.approved_wired_preview_id,
    commands: parseJsonArray<PreviewCommandInput>(row.commands),
    createdAt: row.created_at,
    dependencyServices: parseJsonArray<PreviewDependencyServiceInput>(row.dependency_services),
    id: row.id,
    materialHash: row.material_hash,
    projectDirectory: row.project_directory,
    proposedName: row.proposed_name,
    requestedPublishedOrigins: parseJsonArray<PreviewPublishedOriginInput>(row.requested_published_origins),
    status: row.status === "approved" ? "approved" : "pending",
    target: {
      name: row.target_name,
      url: row.target_url,
    },
    updatedAt: row.updated_at,
    wiredPreviewId: row.wired_preview_id,
    wiringThreadId: row.wiring_thread_id,
  };
}

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function toPreviewMaterial(input: PreviewManifestInput | WiredPreview): PreviewMaterial {
  return {
    commands: input.commands,
    dependencyServices: input.dependencyServices,
    projectDirectory: input.projectDirectory,
    requestedPublishedOrigins: input.requestedPublishedOrigins,
    target: input.target,
  };
}

export function computePreviewMaterialHash(input: PreviewManifestInput | WiredPreview): string {
  return createHash("sha256")
    .update(JSON.stringify(toPreviewMaterial(input)))
    .digest("hex");
}

function manifestToWiredPreviewInput(manifest: PreviewManifest, name: string): WiredPreviewInput {
  return {
    commands: manifest.commands,
    dependencyServices: manifest.dependencyServices,
    name,
    projectDirectory: manifest.projectDirectory,
    requestedPublishedOrigins: manifest.requestedPublishedOrigins,
    target: manifest.target,
  };
}

function searchPattern(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped}%`;
}
