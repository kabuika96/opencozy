import { constants, createWriteStream } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export type AssetKind = "text" | "html" | "pdf" | "image" | "video" | "audio" | "file";
export type FileAsset = {
  id: string; name: string; title: string; description: string; size: number;
  mediaType: string; kind: AssetKind; createdAt: string; sourceThreadId: string;
  source?: { type: 'openwrite'; recordId: string; revision: number; status: 'active' | 'archived' | 'invalid'; statusReason: string; capturedAt: string };
  sha256: string; searchStatus: "content" | "metadata" | "partial"; searchNote: string | null;
};
export const maxAssetBytes = 250 * 1024 * 1024;
const maxTextBytes = 4 * 1024 * 1024;
const maxIndexedCharacters = 500_000;
const media: Record<string, [AssetKind, string]> = {
  '.html': ['html', 'text/html'], '.htm': ['html', 'text/html'], '.pdf': ['pdf', 'application/pdf'],
  '.png': ['image', 'image/png'], '.jpg': ['image', 'image/jpeg'], '.jpeg': ['image', 'image/jpeg'], '.gif': ['image', 'image/gif'], '.webp': ['image', 'image/webp'], '.avif': ['image', 'image/avif'], '.bmp': ['image', 'image/bmp'], '.svg': ['image', 'image/svg+xml'], '.ico': ['image', 'image/x-icon'],
  '.mp4': ['video', 'video/mp4'], '.webm': ['video', 'video/webm'], '.mov': ['video', 'video/quicktime'], '.m4v': ['video', 'video/mp4'], '.ogv': ['video', 'video/ogg'],
  '.mp3': ['audio', 'audio/mpeg'], '.m4a': ['audio', 'audio/mp4'], '.aac': ['audio', 'audio/aac'], '.wav': ['audio', 'audio/wav'], '.ogg': ['audio', 'audio/ogg'], '.oga': ['audio', 'audio/ogg'], '.flac': ['audio', 'audio/flac'], '.opus': ['audio', 'audio/ogg'],
};
const textExtensions = new Set('txt text md markdown csv tsv json jsonl ndjson yaml yml toml ini cfg conf log xml css scss sass less js jsx mjs cjs ts tsx py rb go rs java kt c h cc cpp hpp cs php sh bash zsh fish sql graphql gql r swift svelte vue env gitignore dockerfile makefile rst tex diff patch'.split(' '));
export function assetFormat(name: string, sample: Buffer): [AssetKind, string] {
  if (sample.subarray(0, 5).toString() === '%PDF-') return ['pdf', 'application/pdf'];
  if (sample.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return ['image', 'image/png'];
  if (sample[0] === 255 && sample[1] === 216 && sample[2] === 255) return ['image', 'image/jpeg'];
  const extension = extname(name).toLowerCase();
  if (media[extension]) return media[extension];
  if (textExtensions.has(extension.slice(1)) || textExtensions.has(name.toLowerCase()) || !sample.includes(0) && !sample.toString('utf8').includes('\uFFFD')) return ['text', 'text/plain'];
  return ['file', 'application/octet-stream'];
}

export class AssetLibrary {
  private db: DatabaseSync;
  constructor(readonly directory: string) {
    this.db = new DatabaseSync(join(directory, 'assets.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, owner TEXT NOT NULL, metadata TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS assets_owner ON assets(owner);
      CREATE VIRTUAL TABLE IF NOT EXISTS asset_search USING fts5(id UNINDEXED, title, name, description, content, tokenize='unicode61');`);
  }
  close() { this.db.close(); }
  filePath(asset: FileAsset) { return join(this.directory, 'files', asset.id, asset.name); }
  get(owner: string, id: string): FileAsset | null {
    const row = this.db.prepare('SELECT metadata FROM assets WHERE id=? AND owner=?').get(id, owner) as { metadata: string } | undefined;
    return row ? JSON.parse(row.metadata) : null;
  }
  search(owner: string, query: string, limit = 20, offset = 0): { assets: Array<FileAsset & { snippet?: string }>; hasMore: boolean } {
    const terms = query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 20) ?? [];
    const match = terms.map(term => '"' + term + '"*').join(' AND ');
    const rows = match
      ? this.db.prepare(`SELECT a.metadata, snippet(asset_search, 4, '', '', '…', 24) AS snippet FROM asset_search JOIN assets a ON a.id=asset_search.id WHERE asset_search MATCH ? AND a.owner=? ORDER BY bm25(asset_search, 0, 6, 4, 3, 1), a.rowid DESC LIMIT ? OFFSET ?`).all(match, owner, limit + 1, offset)
      : this.db.prepare('SELECT metadata FROM assets WHERE owner=? ORDER BY rowid DESC LIMIT ? OFFSET ?').all(owner, limit + 1, offset);
    return { assets: rows.slice(0, limit).map(row => ({ ...JSON.parse(String(row.metadata)), ...(row.snippet ? { snippet: row.snippet } : {}) })), hasMore: rows.length > limit };
  }
  async publish(input: { owner: string; sourceThreadId: string; path: string; title?: string; description?: string; source?: FileAsset['source'] }): Promise<FileAsset> {
    const handle = await open(input.path, constants.O_RDONLY | constants.O_NONBLOCK);
    const id = randomUUID();
    let name = basename(input.path).replace(/[\x00-\x1f\x7f]/g, '_').replace(/^\.+/, '_') || 'file';
    while (Buffer.byteLength(name) > 200) name = Array.from(name).slice(0, -1).join('');
    const directory = join(this.directory, 'files', id);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new Error('Publish a regular file, not a directory or device.');
      if (info.size > maxAssetBytes) throw new Error('Files must be 250 MiB or smaller.');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      let size = 0;
      const hash = createHash('sha256');
      await pipeline(handle.createReadStream({ autoClose: false }), new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > maxAssetBytes) return callback(new Error('File exceeds 250 MiB.'));
        hash.update(chunk); callback(null, chunk);
      } }), createWriteStream(join(directory, name), { flags: 'wx', mode: 0o600 }));
      const snapshot = await open(join(directory, name), 'r');
      const sample = Buffer.alloc(Math.min(size, 8192));
      await snapshot.read(sample); await snapshot.close();
      const [kind, mediaType] = assetFormat(name, sample);
      const asset: FileAsset = { ...(input.source ? { source: input.source } : {}), id, name, title: input.title || name, description: input.description ?? '', size, kind, mediaType, sourceThreadId: input.sourceThreadId, createdAt: new Date().toISOString(), sha256: hash.digest('hex'), searchStatus: 'metadata', searchNote: null };
      const extracted = await extractText(this.filePath(asset), asset);
      asset.searchStatus = extracted.status; asset.searchNote = extracted.note;
      this.db.exec('BEGIN');
      try {
        this.db.prepare('INSERT INTO assets (id,owner,metadata) VALUES (?,?,?)').run(id, input.owner, JSON.stringify(asset));
        this.db.prepare('INSERT INTO asset_search (id,title,name,description,content) VALUES (?,?,?,?,?)').run(id, asset.title, name, asset.description, extracted.text);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      return asset;
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
    finally { await handle.close(); }
  }
}

async function extractText(path: string, asset: FileAsset): Promise<{ text: string; status: FileAsset['searchStatus']; note: string | null }> {
  if (asset.kind === 'text' || asset.kind === 'html') {
    const handle = await open(path, 'r');
    const bytes = Buffer.alloc(Math.min(asset.size, maxTextBytes));
    try { await handle.read(bytes); } finally { await handle.close(); }
    let text = bytes.toString('utf8');
    if (asset.kind === 'html') text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|amp|lt|gt|quot);/g, ' ');
    const partial = asset.size > maxTextBytes || text.length > maxIndexedCharacters;
    return { text: text.slice(0, maxIndexedCharacters), status: partial ? 'partial' : 'content', note: partial ? 'Search indexes the beginning of this large document.' : null };
  }
  if (asset.kind === 'pdf') {
    // Use a separate process with a deadline: malformed PDFs must not block the API.
    try {
      const { execFile } = await import('node:child_process');
      const text = await new Promise<string>((resolve, reject) => execFile('pdftotext', ['-f', '1', '-l', '200', '-enc', 'UTF-8', path, '-'], { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
      return { text: text.slice(0, maxIndexedCharacters), status: text.trim() ? 'partial' : 'metadata', note: text.trim() ? 'PDF search covers up to 200 pages and 500,000 characters.' : 'No extractable text; scanned PDFs require OCR. Search by title or description.' };
    } catch { return { text: '', status: 'metadata', note: 'PDF text extraction unavailable. Search by title or description.' }; }
  }
  return { text: '', status: 'metadata', note: 'Search uses filename, title, and description.' };
}
