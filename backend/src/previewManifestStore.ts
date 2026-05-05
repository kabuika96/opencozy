import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  PreviewCommandInput,
  PreviewDependencyServiceInput,
  PreviewManifest,
  PreviewManifestApproval,
  PreviewManifestInput,
  PreviewManifestStatus,
  PreviewPublishedOriginInput,
  WiredPreview,
  WiredPreviewInput
} from "./types.js";
import { WiredPreviewStore } from "./wiredPreviewStore.js";

type PreviewManifestRow = {
  id: string;
  status: string;
  wired_preview_id: string | null;
  wiring_session_id: string | null;
  approved_wired_preview_id: string | null;
  proposed_name: string;
  project_directory: string;
  target_name: string;
  target_url: string;
  dependency_services: string;
  commands: string;
  requested_published_origins: string;
  material_hash: string;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
};

type PreviewMaterial = {
  projectDirectory: string;
  target: {
    name: string;
    url: string;
  };
  dependencyServices: PreviewDependencyServiceInput[];
  commands: PreviewCommandInput[];
  requestedPublishedOrigins: PreviewPublishedOriginInput[];
};

type ManifestSubmitResult = {
  manifest: PreviewManifest;
  reused: boolean;
};

const MANIFEST_COLUMNS = `
  id, status, wired_preview_id, approved_wired_preview_id, proposed_name, project_directory,
  wiring_session_id, target_name, target_url, dependency_services, commands, requested_published_origins,
  material_hash, created_at, updated_at, approved_at
`;

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

function toManifest(row: PreviewManifestRow): PreviewManifest {
  return {
    id: row.id,
    status: row.status === "approved" ? "approved" : "pending",
    wiredPreviewId: row.wired_preview_id,
    wiringSessionId: row.wiring_session_id,
    approvedWiredPreviewId: row.approved_wired_preview_id,
    proposedName: row.proposed_name,
    projectDirectory: row.project_directory,
    target: {
      name: row.target_name,
      url: row.target_url
    },
    dependencyServices: parseJsonArray<PreviewDependencyServiceInput>(row.dependency_services),
    commands: parseJsonArray<PreviewCommandInput>(row.commands),
    requestedPublishedOrigins: parseJsonArray<PreviewPublishedOriginInput>(row.requested_published_origins),
    materialHash: row.material_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at
  };
}

function toMaterial(input: PreviewManifestInput | WiredPreview): PreviewMaterial {
  return {
    projectDirectory: input.projectDirectory,
    target: input.target,
    dependencyServices: input.dependencyServices,
    commands: input.commands,
    requestedPublishedOrigins: input.requestedPublishedOrigins
  };
}

export function computePreviewMaterialHash(input: PreviewManifestInput | WiredPreview): string {
  return createHash("sha256")
    .update(JSON.stringify(toMaterial(input)))
    .digest("hex");
}

function manifestToWiredPreviewInput(manifest: PreviewManifest, name: string): WiredPreviewInput {
  return {
    name,
    projectDirectory: manifest.projectDirectory,
    target: manifest.target,
    dependencyServices: manifest.dependencyServices,
    commands: manifest.commands,
    requestedPublishedOrigins: manifest.requestedPublishedOrigins
  };
}

export class PreviewManifestStore {
  private readonly db: DatabaseSync;

  constructor(private readonly wiredPreviewStore: WiredPreviewStore) {
    this.db = wiredPreviewStore.db;
    this.migrate();
  }

  list(status?: PreviewManifestStatus): PreviewManifest[] {
    const rows = status
      ? this.db
        .prepare(`
          SELECT ${MANIFEST_COLUMNS}
          FROM preview_manifests
          WHERE status = ?
          ORDER BY updated_at DESC, created_at DESC
        `)
        .all(status) as PreviewManifestRow[]
      : this.db
        .prepare(`
          SELECT ${MANIFEST_COLUMNS}
          FROM preview_manifests
          ORDER BY updated_at DESC, created_at DESC
        `)
        .all() as PreviewManifestRow[];

    return rows.map(toManifest);
  }

  get(id: string): PreviewManifest | null {
    const row = this.db
      .prepare(`
        SELECT ${MANIFEST_COLUMNS}
        FROM preview_manifests
        WHERE id = ?
      `)
      .get(id) as PreviewManifestRow | undefined;

    return row ? toManifest(row) : null;
  }

  submit(input: PreviewManifestInput): ManifestSubmitResult {
    const materialHash = computePreviewMaterialHash(input);

    if (input.wiredPreviewId) {
      const existingPreview = this.wiredPreviewStore.get(input.wiredPreviewId);
      if (existingPreview && computePreviewMaterialHash(existingPreview) === materialHash) {
        return {
          manifest: this.findApprovedByPreviewAndHash(input.wiredPreviewId, materialHash)
            ?? this.create(input, "approved", input.wiredPreviewId),
          reused: true
        };
      }

      const pending = this.findPendingByHash(materialHash, input.wiredPreviewId);
      if (pending) {
        return { manifest: pending, reused: true };
      }

      return { manifest: this.create(input, "pending", null), reused: false };
    }

    const approved = this.findApprovedByHash(materialHash);
    if (approved) {
      return { manifest: approved, reused: true };
    }

    const matchingPreview = this.findWiredPreviewByMaterialHash(materialHash);
    if (matchingPreview) {
      return {
        manifest: this.findApprovedByPreviewAndHash(matchingPreview.id, materialHash)
          ?? this.create({ ...input, wiredPreviewId: matchingPreview.id }, "approved", matchingPreview.id),
        reused: true
      };
    }

    const pending = this.findPendingByHash(materialHash, null);
    if (pending) {
      return { manifest: pending, reused: true };
    }

    return { manifest: this.create(input, "pending", null), reused: false };
  }

  approve(id: string, name: string): PreviewManifestApproval | null {
    const manifest = this.get(id);
    if (!manifest) {
      return null;
    }

    if (manifest.status === "approved") {
      const approvedPreview = manifest.approvedWiredPreviewId ? this.wiredPreviewStore.get(manifest.approvedWiredPreviewId) : null;
      return approvedPreview ? { manifest, wiredPreview: approvedPreview } : null;
    }

    const input = manifestToWiredPreviewInput(manifest, name);
    const existingPreview = manifest.wiredPreviewId ? this.wiredPreviewStore.get(manifest.wiredPreviewId) : null;
    const wiredPreview = existingPreview
      ? this.wiredPreviewStore.update(existingPreview.id, input)
      : this.wiredPreviewStore.create(input);

    if (!wiredPreview) {
      return null;
    }

    const wiredPreviewWithSession = manifest.wiringSessionId
      ? this.wiredPreviewStore.setWiringSessionId(wiredPreview.id, manifest.wiringSessionId) ?? wiredPreview
      : wiredPreview;
    const approved = this.markApproved(manifest.id, name, wiredPreview.id);
    return approved ? { manifest: approved, wiredPreview: wiredPreviewWithSession } : null;
  }

  private create(input: PreviewManifestInput, status: PreviewManifestStatus, approvedWiredPreviewId: string | null): PreviewManifest {
    const id = randomUUID();
    const timestamp = nowIso();
    const approvedAt = status === "approved" ? timestamp : null;

    this.db
      .prepare(`
        INSERT INTO preview_manifests (
          id, status, wired_preview_id, wiring_session_id, approved_wired_preview_id, proposed_name, project_directory,
          target_name, target_url, dependency_services, commands, requested_published_origins,
          material_hash, created_at, updated_at, approved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        status,
        input.wiredPreviewId ?? null,
        input.wiringSessionId ?? null,
        approvedWiredPreviewId,
        input.name,
        input.projectDirectory,
        input.target.name,
        input.target.url,
        JSON.stringify(input.dependencyServices),
        JSON.stringify(input.commands),
        JSON.stringify(input.requestedPublishedOrigins),
        computePreviewMaterialHash(input),
        timestamp,
        timestamp,
        approvedAt
      );

    const manifest = this.get(id);
    if (!manifest) {
      throw new Error("Failed to create Preview Manifest");
    }

    return manifest;
  }

  private markApproved(id: string, name: string, approvedWiredPreviewId: string): PreviewManifest | null {
    const timestamp = nowIso();
    const result = this.db
      .prepare(`
        UPDATE preview_manifests
        SET status = 'approved', proposed_name = ?, approved_wired_preview_id = ?, updated_at = ?, approved_at = ?
        WHERE id = ?
      `)
      .run(name, approvedWiredPreviewId, timestamp, timestamp, id);

    return result.changes > 0 ? this.get(id) : null;
  }

  private findApprovedByHash(materialHash: string): PreviewManifest | null {
    const row = this.db
      .prepare(`
        SELECT ${MANIFEST_COLUMNS}
        FROM preview_manifests
        WHERE status = 'approved'
          AND material_hash = ?
          AND approved_wired_preview_id IS NOT NULL
        ORDER BY approved_at DESC, updated_at DESC
        LIMIT 1
      `)
      .get(materialHash) as PreviewManifestRow | undefined;

    return row ? toManifest(row) : null;
  }

  private findApprovedByPreviewAndHash(wiredPreviewId: string, materialHash: string): PreviewManifest | null {
    const row = this.db
      .prepare(`
        SELECT ${MANIFEST_COLUMNS}
        FROM preview_manifests
        WHERE status = 'approved'
          AND material_hash = ?
          AND approved_wired_preview_id = ?
        ORDER BY approved_at DESC, updated_at DESC
        LIMIT 1
      `)
      .get(materialHash, wiredPreviewId) as PreviewManifestRow | undefined;

    return row ? toManifest(row) : null;
  }

  private findPendingByHash(materialHash: string, wiredPreviewId: string | null): PreviewManifest | null {
    const row = wiredPreviewId
      ? this.db
        .prepare(`
          SELECT ${MANIFEST_COLUMNS}
          FROM preview_manifests
          WHERE status = 'pending'
            AND material_hash = ?
            AND wired_preview_id = ?
          ORDER BY updated_at DESC
          LIMIT 1
        `)
        .get(materialHash, wiredPreviewId) as PreviewManifestRow | undefined
      : this.db
        .prepare(`
          SELECT ${MANIFEST_COLUMNS}
          FROM preview_manifests
          WHERE status = 'pending'
            AND material_hash = ?
            AND wired_preview_id IS NULL
          ORDER BY updated_at DESC
          LIMIT 1
        `)
        .get(materialHash) as PreviewManifestRow | undefined;

    return row ? toManifest(row) : null;
  }

  private findWiredPreviewByMaterialHash(materialHash: string): WiredPreview | null {
    return this.wiredPreviewStore.list().find((preview) => computePreviewMaterialHash(preview) === materialHash) ?? null;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS preview_manifests (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
        wired_preview_id TEXT,
        wiring_session_id TEXT,
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
    ensureColumn(this.db, "preview_manifests", "wiring_session_id", "TEXT");
  }
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
