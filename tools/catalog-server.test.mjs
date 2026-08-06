import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCatalogServer } from './catalog-server.mjs';
import { buildCatalogSnapshot } from './catalog-model.mjs';

function webFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-catalog-web-'));
  for (const name of ['index.html', 'styles.css', 'app.js']) fs.writeFileSync(path.join(root, name), name);
  return root;
}

async function withServer(fn) {
  const snapshot = await buildCatalogSnapshot({ repoRoot: process.cwd(), now: new Date('2026-08-03T00:00:00Z') });
  const { server } = await startCatalogServer({ snapshot, webRoot: webFixture(), port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('catalog server serves health, summary and detail APIs', async () => withServer(async (base) => {
  const health = await fetch(`${base}/healthz`).then((response) => response.json());
  assert.deepEqual(health, { status: 'ok', count: 14, generatedAt: '2026-08-03T00:00:00.000Z' });
  const summary = await fetch(`${base}/api/catalog`).then((response) => response.json());
  assert.equal(summary.capabilities.length, 14);
  assert.equal('qualityChecks' in summary.capabilities[0], false);
  assert.ok(summary.filters.scopes.some((scope) => scope.id === 'general'));
  const detail = await fetch(`${base}/api/capabilities/opsforge-meta.opsforge`).then((response) => response.json());
  assert.equal(detail.id, 'opsforge-meta.opsforge');
  assert.ok(detail.usage['claude-code']);
  const example = summary.capabilities.find((item) => item.availability === 'reference-only');
  assert.ok(example);
  assert.equal('owner' in example, false);
}));

test('catalog server handles deep links and rejects unknown paths', async () => withServer(async (base) => {
  assert.equal((await fetch(`${base}/capabilities/opsforge-meta.opsforge`)).status, 200);
  assert.equal((await fetch(`${base}/missing`)).status, 404);
  assert.equal((await fetch(`${base}/api/capabilities/not-valid`)).status, 400);
  assert.equal((await fetch(`${base}/api/capabilities/foo.missing`)).status, 404);
  assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
}));

test('catalog server refuses an empty startup snapshot', async () => {
  await assert.rejects(
    startCatalogServer({ snapshot: { count: 0 }, webRoot: webFixture(), port: 0 }),
    /no released capabilities/,
  );
});
