import { mkdirSync, createReadStream, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { LiteHarnessStore } from '../db/store.js';
import type { TimelineHub } from '../events/timelineHub.js';
import type { RunRecord } from '../types.js';
import type { HarnessFileAssets } from '../harnesses/types.js';
import { OpenWriteRecords } from './openwriteRecords.js';
import { AssetLibrary, type FileAsset } from './assetLibrary.js';

const publishSchema = z.object({ path: z.string().min(1).max(4096), title: z.string().trim().min(1).max(200).optional(), description: z.string().trim().max(4000).optional() }).strict();
const searchSchema = z.object({ query: z.string().max(500).default(''), limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).max(10_000).default(0) }).strict();
const showSchema = z.object({ id: z.string().uuid() }).strict();
const grantLifetimeMs = 12 * 60 * 60 * 1000;

export function registerAssetRoutes(app: FastifyInstance, store: LiteHarnessStore, hub: TimelineHub, deviceId: (request: FastifyRequest) => string) {
  const directory = join(dirname(store.attachmentDirectory), 'assets');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const library = new AssetLibrary(directory);
  const records = new OpenWriteRecords();
  const grants = new Map<string, { owner: string; id: string; expires: number }>();
  const contexts = new Map<string, { runId: string; invoke: HarnessFileAssets['invoke'] }>();
  const runTokens = new Map<string, string>();
  app.addHook('onClose', async () => { library.close(); contexts.clear(); grants.clear(); });

  app.get('/api/assets', async (request, reply) => {
    const parsed = z.object({ q: z.string().max(500).default(''), limit: z.coerce.number().int().min(1).max(50).default(20), offset: z.coerce.number().int().min(0).max(10_000).default(0) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid search parameters' });
    return library.search(deviceId(request), parsed.data.q, parsed.data.limit, parsed.data.offset);
  });
  app.get('/api/assets/:id', async (request, reply) => {
    const asset = library.get(deviceId(request), (request.params as { id: string }).id);
    return asset ?? reply.code(404).send({ error: 'File not found' });
  });
  app.post('/api/assets/:id/access', async (request, reply) => {
    const owner = deviceId(request);
    const asset = library.get(owner, (request.params as { id: string }).id);
    if (!asset) return reply.code(404).send({ error: 'File not found' });
    for (const [key, grant] of grants) if (grant.expires < Date.now()) grants.delete(key);
    if (grants.size >= 1000) grants.delete(grants.keys().next().value!);
    const token = randomBytes(32).toString('hex');
    const expires = Date.now() + grantLifetimeMs;
    grants.set(token, { owner, id: asset.id, expires });
    reply.header('Cache-Control', 'no-store');
    return { url: `/api/assets/${asset.id}/content?grant=${token}`, expiresAt: new Date(expires).toISOString() };
  });
  app.get('/api/assets/:id/content', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { grant?: string; download?: string };
    const grant = typeof query.grant === 'string' ? grants.get(query.grant) : undefined;
    if (!grant || grant.id !== id || grant.expires <= Date.now()) return reply.code(404).send({ error: 'File access expired; reopen the preview' });
    const asset = library.get(grant.owner, id);
    if (!asset) return reply.code(404).send({ error: 'File not found' });
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Disposition', `${query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(asset.name).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16))}`);
    // HTML is fetched as inert text and rendered by the isolated frontend viewer.
    reply.type(asset.kind === 'html' || asset.kind === 'text' ? 'text/plain; charset=utf-8' : asset.mediaType);
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const start = match?.[1] ? Number(match[1]) : Math.max(0, asset.size - Number(match?.[2]));
      const end = match?.[1] && match[2] ? Math.min(Number(match[2]), asset.size - 1) : asset.size - 1;
      if (!match || !match[1] && !match[2] || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= asset.size) return reply.code(416).header('Content-Range', `bytes */${asset.size}`).send();
      reply.code(206).header('Content-Range', `bytes ${start}-${end}/${asset.size}`).header('Content-Length', end - start + 1);
      return reply.send(createReadStream(library.filePath(asset), { start, end }));
    }
    reply.header('Content-Length', asset.size);
    return reply.send(createReadStream(library.filePath(asset)));
  });

  // A Run-scoped local capability lets older Harness histories use the same tools
  // without replacing their immutable native dynamic-tool definitions.
  app.post('/api/file-tools/:tool', async (request, reply) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) return reply.code(403).send({ error: 'Local tool endpoint only' });
    const token = request.headers.authorization?.replace(/^Bearer /, '');
    const context = token ? contexts.get(token) : undefined;
    if (!context) return reply.code(403).send({ error: 'File tool context expired' });
    try { return await context.invoke((request.params as { tool: string }).tool, request.body); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) }); }
  });

  return {
    prepare(run: RunRecord): HarnessFileAssets {
      const thread = store.getThread(run.threadId);
      const owner = store.getThreadOwnerDeviceId(run.threadId);
      if (!thread || !owner) throw new Error('File library requires a Device-owned thread');
      const ensureActive = () => {
        const current = store.getRun(run.id);
        if (!current || !['running', 'needs_approval', 'needs_input'].includes(current.status)) throw new Error('File tools require an active Run');
      };
      const show = (asset: FileAsset) => {
        ensureActive();
        const event = store.recordTimelineEvent({ threadId: thread.id, runId: run.id, type: 'asset.shared', payload: { liteharnessType: 'file-asset', stableKey: `asset:${randomUUID()}`, text: asset.title, asset } });
        hub.publish(event);
        return asset;
      };
      const invoke: HarnessFileAssets['invoke'] = async (tool, args) => {
        ensureActive();
        if (tool === 'search_records') {
          const input = searchSchema.extend({ status: z.enum(['active', 'archived', 'invalid', 'all']).default('active') }).parse(args);
          return records.search(input);
        }
        if (tool === 'show_record') {
          const { id } = showSchema.parse(args);
          return show(await records.publish(id, library, owner, thread.id));
        }
        if (tool === 'publish') {
          const input = publishSchema.parse(args);
          const asset = await library.publish({ ...input, path: resolve(thread.workspacePath, input.path), owner, sourceThreadId: thread.id });
          return show(asset);
        }
        if (tool === 'search') { const input = searchSchema.parse(args); return library.search(owner, input.query, input.limit, input.offset); }
        if (tool === 'show' || tool === 'read') {
          const { id } = showSchema.parse(args);
          const asset = library.get(owner, id);
          if (!asset) throw new Error('File not found in this Device library');
          return tool === 'show' ? show(asset) : { asset, path: library.filePath(asset) };
        }
        throw new Error('Unknown file tool');
      };
      const token = randomBytes(32).toString('hex');
      contexts.set(token, { runId: run.id, invoke }); runTokens.set(run.id, token);
      const contextDirectory = join(directory, 'tool-contexts');
      mkdirSync(contextDirectory, { recursive: true, mode: 0o700 });
      const contextPath = join(contextDirectory, `${thread.id}.json`);
      const address = app.server.address();
      const port = address && typeof address !== 'string' ? address.port : Number(process.env.LITEHARNESS_BACKEND_PORT ?? 8787);
      writeFileSync(contextPath, JSON.stringify({ url: `http://127.0.0.1:${port}/api/file-tools`, token }), { mode: 0o600 });
      return { contextPath, cliPath: [fileURLToPath(new URL('../../../scripts/file-assets.mjs', import.meta.url)), fileURLToPath(new URL('../../../../scripts/file-assets.mjs', import.meta.url))].find(existsSync)!, invoke };
    },
    finish(runId: string) { const token = runTokens.get(runId); if (token) contexts.delete(token); runTokens.delete(runId); },
  };
}
