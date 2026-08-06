import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogSnapshot, catalogSummary } from './catalog-model.mjs';

const REPO = process.cwd();

test('catalog exposes only released capabilities and public fields', async () => {
  const snapshot = await buildCatalogSnapshot({ repoRoot: REPO, now: new Date('2026-08-03T00:00:00Z') });
  assert.equal(snapshot.count, 11);
  assert.ok(snapshot.capabilities.every((item) => item.id && item.name && item.kindLabel));
  assert.ok(snapshot.capabilities.every((item) => !('owner' in item) && !('dir' in item) && !('customer' in item)));
  assert.ok(snapshot.capabilities.some((item) => item.source.key === 'example'));
  assert.ok(snapshot.capabilities.some((item) => item.source.key === 'third-party'));
  assert.ok(snapshot.capabilities.every((item) => item.scope === 'general' || item.scope === 'project'));
  assert.ok(snapshot.filters.scopes.some((item) => item.id === 'general'));
});

test('catalog summary omits detail-only data', async () => {
  const snapshot = await buildCatalogSnapshot({ repoRoot: REPO, now: new Date('2026-08-03T00:00:00Z') });
  const item = catalogSummary(snapshot).capabilities[0];
  assert.equal('qualityChecks' in item, false);
  assert.equal('dependencies' in item, false);
  assert.equal('usage' in item, false);
  assert.equal('detail' in item, false);
  assert.equal('availability' in item, true);
  assert.equal('scope' in item, true);
});

test('catalog provides platform-specific usage and compatibility', async () => {
  const snapshot = await buildCatalogSnapshot({ repoRoot: REPO });
  const item = snapshot.capabilities.find((capability) => capability.id === 'opsforge-meta.opsforge');
  assert.equal(item.usage['claude-code'].status, 'native');
  assert.equal(item.usage.codex.status, 'unsupported');
  assert.ok(item.scenarios.length > 0);
});

test('example capabilities are reference-only and have no usage steps', async () => {
  const snapshot = await buildCatalogSnapshot({ repoRoot: REPO });
  const example = snapshot.capabilities.find((capability) => capability.source.key === 'example');
  assert.equal(example.availability, 'reference-only');
  assert.equal(example.usage['claude-code'].status, 'reference-only');
  assert.deepEqual(example.usage['claude-code'].steps, []);
});