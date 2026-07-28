// tools/effectiveness-tier-split.test.mjs — methodology §5.4 J.2 fix + Tier split.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { effectivenessScan } from '../install.mjs';

function mkHome() { return fs.mkdtempSync(path.join(os.tmpdir(), 'eff-')); }
function writeFb(home, pack, capId, ratings) {
  const dir = path.join(home, 'kb', pack, 'feedback');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${capId}.jsonl`), ratings.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

test('per-cap jsonl read; Tier 1 <70% → degraded', () => {
  const home = mkHome();
  const rs = [];
  for (let i = 0; i < 10; i++) rs.push({ cap_id: 'foo.bar', rating: 'up', ts: 't' });
  for (let i = 0; i < 10; i++) rs.push({ cap_id: 'foo.bar', rating: 'down', ts: 't' });
  writeFb(home, 'foo', 'foo.bar', rs);
  const r = effectivenessScan(home, { tierOf: () => 1 });
  assert.equal(r.degraded, true);
  assert.equal(r.count, 20);
});

test('Tier 2/3 excluded from main denominator', () => {
  const home = mkHome();
  const rs = [];
  for (let i = 0; i < 10; i++) rs.push({ cap_id: 'foo.bar', rating: 'up', ts: 't' });
  for (let i = 0; i < 10; i++) rs.push({ cap_id: 'foo.bar', rating: 'down', ts: 't' });
  writeFb(home, 'foo', 'foo.bar', rs);
  const r = effectivenessScan(home, { tierOf: () => 3 });
  assert.equal(r.degraded, false);
  assert.deepEqual(r.tier23, ['foo.bar']);
});

test('no feedback → not degraded', () => {
  const home = mkHome();
  const r = effectivenessScan(home, { tierOf: () => 1 });
  assert.equal(r.degraded, false);
});

test('legacy ratings.jsonl still ingested', () => {
  const home = mkHome();
  const dir = path.join(home, 'feedback');
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  for (let i = 0; i < 15; i++) lines.push(JSON.stringify({ cap_id: 'foo.bar', rating: 'up' }));
  for (let i = 0; i < 5; i++) lines.push(JSON.stringify({ cap_id: 'foo.bar', rating: 'down' }));
  fs.writeFileSync(path.join(dir, 'ratings.jsonl'), lines.join('\n') + '\n');
  const r = effectivenessScan(home, { tierOf: () => 1 });
  assert.equal(r.degraded, false);
  assert.equal(r.count, 20);
});
