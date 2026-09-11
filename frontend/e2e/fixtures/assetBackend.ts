import Fastify from 'fastify';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import websocket from '@fastify/websocket';
import { dirname, join } from 'node:path';
import { createStore } from '../../../backend/src/db/store.js';
import { createTimelineHub } from '../../../backend/src/events/timelineHub.js';
import { registerApiRoutes } from '../../../backend/src/routes/api.js';
import type { HarnessAdapter } from '../../../backend/src/harnesses/types.js';
import { createAssetFiles } from './assetFiles.js';
const app = Fastify();
await app.register(websocket);
const store = createStore(process.argv[2]);
const files = await createAssetFiles(join(dirname(process.argv[2]!), 'source-files'));
const original = await readFile(files.find(file => file.title === 'PDF report')!.path);
const record = { id: randomUUID(), sha256: createHash('sha256').update(original).digest('hex'), filename: 'record.pdf', size: original.length, title: 'OpenWrite record', status: 'invalid', statusReason: 'Superseded by renewal', revision: 3, category: 'Insurance', tags: [], expiresOn: '' };
const openwrite = createServer((req, res) => {
  if (req.url?.endsWith('/original')) return res.end(original);
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(req.url?.startsWith('/api/records?') ? { records: [record], total: 1, limit: 20, offset: 0 } : { record }));
});
await new Promise<void>(resolve => openwrite.listen(0, '127.0.0.1', resolve));
process.env.LITEHARNESS_OPENWRITE_ORIGIN = `http://127.0.0.1:${(openwrite.address() as { port: number }).port}`;
const adapter: HarnessAdapter = {
  type: 'codex', label: 'Codex', capabilities: { approvals: false, fastMode: true, resume: true, streaming: true, userInput: true },
  async discoverWorkspace() { throw new Error('unused'); }, async startThread() { return { harnessThreadId: null }; },
  async *run(input) {
    if (input.prompt === 'Share example files') {
      for (const file of files) await input.fileAssets!.invoke('publish', file);
    } else if (input.prompt === 'Find OpenWrite record') {
      const result = await input.fileAssets!.invoke('search_records', { query: 'record', status: 'all' }) as { records: Array<{ id: string }> };
      await input.fileAssets!.invoke('show_record', { id: result.records[0]!.id });
    } else {
      const result = await input.fileAssets!.invoke('search', { query: 'bluebird' }) as { assets: Array<{ id: string }> };
      if (!result.assets.length) throw new Error('Could not retrieve previous file');
      await input.fileAssets!.invoke('show', { id: result.assets[0]!.id });
    }
    yield { type: 'harness.output', text: '<p>Files ready.</p>', payload: { liteharnessType: 'assistant-message' } };
    yield { type: 'run.completed', text: 'Done' };
  },
  async respondToApproval() {}, async respondToInput() {}, async sendUserInput() {},
};
await registerApiRoutes(app, { store, hub: createTimelineHub(), harnesses: new Map([['codex', adapter]]) });
// Serve the Vite UI through this isolated backend so native media and downloads
// exercise real same-origin HTTP responses instead of browser route fulfillment.
app.setNotFoundHandler(async (request, reply) => {
  if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
  const response = await fetch(`http://127.0.0.1:5187${request.url}`);
  reply.code(response.status).type(response.headers.get('content-type') ?? 'application/octet-stream');
  return reply.send(Buffer.from(await response.arrayBuffer()));
});
console.log(JSON.stringify({ origin: await app.listen({ host: '127.0.0.1', port: 0 }) }));
