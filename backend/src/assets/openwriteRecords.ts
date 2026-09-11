import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { AssetLibrary, maxAssetBytes } from './assetLibrary.js';

const recordSchema = z.object({
  id: z.string().uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/), filename: z.string().min(1).max(1000),
  size: z.number().int().nonnegative(), title: z.string().max(1000), status: z.enum(['active', 'archived', 'invalid']),
  statusReason: z.string().max(10000), revision: z.number().int().positive(), category: z.string().max(1000),
  tags: z.array(z.string()).max(100), expiresOn: z.string(), snippet: z.string().optional(),
});

// A read-only adapter: OpenWrite remains responsible for record management.
// Its loopback API is never forwarded to the PWA. Only explicitly shown originals
// become Device-owned snapshots through the existing asset publication path.
export class OpenWriteRecords {
  constructor(private readonly origin = process.env.LITEHARNESS_OPENWRITE_ORIGIN ?? 'http://127.0.0.1:8787') {}
  private async request(path: string, timeout = 15_000) {
    const origin = new URL(this.origin);
    if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('OpenWrite must use a loopback HTTP origin.');
    let response: Response;
    try { response = await fetch(new URL(path, origin), { redirect: 'error', signal: AbortSignal.timeout(timeout) }); }
    catch { throw new Error('OpenWrite is unavailable. Existing shared snapshots can still be opened.'); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(response.status === 404 ? 'OpenWrite record not found.' : `OpenWrite request failed (${response.status}).`); }
    return response;
  }
  private async json(path: string): Promise<unknown> {
    const response = await this.request(path);
    const chunks: Buffer[] = []; let size = 0;
    if (!response.body) throw new Error('OpenWrite returned no content.');
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) throw new Error('OpenWrite metadata response is too large. Narrow the search.');
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async search(input: { query: string; status: 'active' | 'archived' | 'invalid' | 'all'; limit: number; offset: number }) {
    const query = new URLSearchParams({ q: input.query, status: input.status, limit: String(input.limit), offset: String(input.offset) });
    return z.object({ records: z.array(recordSchema), total: z.number(), limit: z.number(), offset: z.number() }).parse(await this.json(`/api/records?${query}`));
  }
  async publish(id: string, library: AssetLibrary, owner: string, sourceThreadId: string) {
    z.string().uuid().parse(id);
    const { record } = z.object({ record: recordSchema }).parse(await this.json(`/api/records/${id}`));
    if (record.id !== id) throw new Error('OpenWrite returned a different record.');
    if (record.size > maxAssetBytes) throw new Error('This record exceeds the 250 MiB preview limit.');
    const response = await this.request(`/api/records/${id}/original`, 60_000);
    if (!response.body) throw new Error('OpenWrite returned no original.');
    const directory = await mkdtemp(join(tmpdir(), 'liteharness-record-'));
    try {
      const name = basename(record.filename).replace(/[\x00-\x1f\x7f]/g, '_').replace(/^\.+/, '_').slice(-180) || 'record';
      const path = join(directory, name);
      let size = 0; const hash = createHash('sha256');
      await pipeline(Readable.fromWeb(response.body as any), new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > maxAssetBytes || size > record.size) return callback(new Error('OpenWrite original exceeds its declared size.'));
        hash.update(chunk); callback(null, chunk);
      } }), createWriteStream(path, { flags: 'wx', mode: 0o600 }));
      if (size !== record.size || hash.digest('hex') !== record.sha256) throw new Error('OpenWrite original checksum or size does not match its record.');
      return await library.publish({ path, owner, sourceThreadId, title: record.title.slice(0, 200) || name, description: [record.category, ...record.tags].filter(Boolean).join(' · ').slice(0, 4000),
        source: { type: 'openwrite', recordId: id, revision: record.revision, status: record.status, statusReason: record.statusReason, capturedAt: new Date().toISOString() },
      });
    } finally { await response.body.cancel().catch(() => {}); await rm(directory, { recursive: true, force: true }); }
  }
}
