#!/usr/bin/env node
// Older Codex threads keep their tool definitions; use the same Run-scoped backend tools over loopback.
import { readFile } from 'node:fs/promises';
const [contextPath, tool, json = '{}'] = process.argv.slice(2);
if (!contextPath || !['publish', 'search', 'show', 'read', 'search_records', 'show_record'].includes(tool)) {
  console.error('Usage: node file-assets.mjs CONTEXT_PATH publish|search|show|read|search_records|show_record JSON_ARGUMENTS');
  process.exit(1);
}
try {
  const context = JSON.parse(await readFile(contextPath, 'utf8'));
  const url = new URL(context.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Expected a local file-tool endpoint');
  const response = await fetch(`${context.url}/${tool}`, { method: 'POST', headers: { authorization: `Bearer ${context.token}`, 'content-type': 'application/json' }, body: JSON.stringify(JSON.parse(json)), signal: AbortSignal.timeout(60_000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `File tool failed: ${response.status}`);
  console.log(JSON.stringify(result));
} catch (error) { console.error(error.message); process.exitCode = 1; }
