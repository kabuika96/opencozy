import { it, expect } from 'vitest';
import Fastify from 'fastify';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenWriteRecords } from '../src/assets/openwriteRecords.js';
import { registerAssetRoutes } from '../src/assets/assetRoutes.js';
import { createStore } from '../src/db/store.js';
import { createTimelineHub } from '../src/events/timelineHub.js';

it('finds an OpenWrite record and preserves its original and provenance in the shared viewer after OpenWrite goes offline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lh-openwrite-'));
  const bytes = Buffer.from('# Household record\nA bluebird document.');
  const record = { id: randomUUID(), sha256: createHash('sha256').update(bytes).digest('hex'), filename: 'record.md', mime: 'text/markdown', size: bytes.length, title: 'Household record', status: 'archived', statusReason: 'Replaced by renewal', revision: 2, category: 'Insurance', notes: '', tags: ['policy'], members: [], expiresOn: '', updatedAt: new Date().toISOString() };
  let corrupt = false;
  const upstream = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    expect(req.method).toBe('GET');
    if (url.pathname.endsWith('/original')) { res.setHeader('X-Content-SHA256', record.sha256); return res.end(corrupt ? Buffer.alloc(bytes.length, 0) : bytes); }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(url.pathname === '/api/records' ? { records: url.searchParams.get('status') === 'all' ? [record] : [], total: 1, limit: 20, offset: 0 } : { record }));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const previous = process.env.LITEHARNESS_OPENWRITE_ORIGIN;
  process.env.LITEHARNESS_OPENWRITE_ORIGIN = `http://127.0.0.1:${(upstream.address() as any).port}`;
  const store = createStore(join(directory, 'test.sqlite'));
  const app = Fastify();
  const routes = registerAssetRoutes(app, store, createTimelineHub(), () => 'owner');
  try {
    const thread = store.createThread({ harnessType: 'codex', harnessThreadId: null, title: 'Records', workspacePath: directory, deviceId: 'owner' });
    const run = store.createRun({ threadId: thread.id, prompt: 'Show my record' });
    store.updateRunStatus(run.id, 'running');
    const tools = routes.prepare(run);
    expect(await tools.invoke('search_records', { query: 'bluebird' })).toMatchObject({ records: [] });
    expect(await tools.invoke('search_records', { query: 'bluebird', status: 'all' })).toMatchObject({ records: [{ id: record.id }] });
    const asset: any = await tools.invoke('show_record', { id: record.id });
    expect(asset.source).toMatchObject({ type: 'openwrite', recordId: record.id, revision: 2, status: 'archived', statusReason: 'Replaced by renewal' });
    expect(store.listTimeline(thread.id).find(event => event.type === 'asset.shared')?.payload.asset).toMatchObject({ id: asset.id });
    corrupt = true;
    await expect(tools.invoke('show_record', { id: record.id })).rejects.toThrow(/checksum/);
    expect(store.listTimeline(thread.id).filter(event => event.type === 'asset.shared')).toHaveLength(1);
    await new Promise<void>(resolve => upstream.close(() => resolve()));
    store.setThreadClosed(thread.id, true);
    const access = (await app.inject({ method: 'POST', url: `/api/assets/${asset.id}/access` })).json();
    expect((await app.inject({ method: 'GET', url: access.url })).rawPayload).toEqual(bytes);
    expect((await app.inject({ method: 'GET', url: '/api/assets?q=bluebird' })).json().assets[0].source.recordId).toBe(record.id);
    await expect(tools.invoke('search_records', { query: 'bluebird' })).rejects.toThrow(/OpenWrite/);
  } finally {
    if (previous === undefined) delete process.env.LITEHARNESS_OPENWRITE_ORIGIN; else process.env.LITEHARNESS_OPENWRITE_ORIGIN = previous;
    upstream.closeAllConnections(); if (upstream.listening) await new Promise<void>(resolve => upstream.close(() => resolve()));
    await app.close(); store.close(); await rm(directory, { recursive: true, force: true });
  }
});

it.each(['https://example.com', 'http://example.com', 'http://127.0.0.1/path', 'http://user:secret@127.0.0.1'])('rejects nonlocal or credential-bearing OpenWrite origin %s', async origin => {
  await expect(new OpenWriteRecords(origin).search({ query: '', status: 'active', limit: 20, offset: 0 })).rejects.toThrow(/loopback/);
});
