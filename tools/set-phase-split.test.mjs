// tools/set-phase-split.test.mjs — near-miss 1: cmdSetPhase --built-with-model
// must split on the LAST colon so port-bearing endpoint URLs survive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OPSFORGE = fileURLToPath(new URL('./opsforge.mjs', import.meta.url));

function mkCapDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sps-'));
  fs.writeFileSync(path.join(d, '.opsforge-state.json'), JSON.stringify({ state: 'staged', history: [] }));
  return d;
}

function runSetPhase(capDir, modelArg) {
  return spawnSync(process.execPath, [OPSFORGE, 'set-phase', capDir, 'distill_done', '--built-with-model', modelArg], { encoding: 'utf8' });
}

function readState(capDir) {
  return JSON.parse(fs.readFileSync(path.join(capDir, '.opsforge-state.json'), 'utf8'));
}

test('near-miss 1: port-bearing endpoint keeps host:port in endpoint', () => {
  const d = mkCapDir();
  const r = runSetPhase(d, 'https://api.example.com:8080:v1.2');
  assert.equal(r.status, 0, r.stderr);
  const st = readState(d);
  assert.equal(st.built_with_model.endpoint, 'https://api.example.com:8080');
  assert.equal(st.built_with_model.version, 'v1.2');
});

test('near-miss 1: plain endpoint:version still works', () => {
  const d = mkCapDir();
  const r = runSetPhase(d, 'claude-code:1.0.0');
  assert.equal(r.status, 0, r.stderr);
  const st = readState(d);
  assert.equal(st.built_with_model.endpoint, 'claude-code');
  assert.equal(st.built_with_model.version, '1.0.0');
});
