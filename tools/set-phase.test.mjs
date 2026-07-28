// tools/set-phase.test.mjs — methodology §7.2 set-phase / writeOpsforgeState opts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeOpsforgeState } from './new-capability.mjs';
import { checkOpsforgeState } from './validate.mjs';

function mkDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sp-')); }

test('writeOpsforgeState writes phase + history phase field', () => {
  const dir = mkDir();
  writeOpsforgeState(dir, 'staged', 'draft', { phase: 'interview_done' });
  const st = JSON.parse(fs.readFileSync(path.join(dir, '.opsforge-state.json'), 'utf8'));
  assert.equal(st.phase, 'interview_done');
  assert.equal(st.history[0].to, 'staged');
  assert.equal(st.history[0].phase.to, 'interview_done');
});

test('checkOpsforgeState pass for valid phase', () => {
  const dir = mkDir();
  writeOpsforgeState(dir, 'staged', null, { phase: 'distill_done' });
  const r = checkOpsforgeState({ dir });
  assert.equal(r.status, 'pass');
});

test('checkOpsforgeState fail for invalid phase', () => {
  const dir = mkDir();
  writeOpsforgeState(dir, 'staged', null, { phase: 'bogus_phase' });
  const r = checkOpsforgeState({ dir });
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /invalid phase/);
});

test('checkOpsforgeState validates built_with_model shape', () => {
  const dir = mkDir();
  writeOpsforgeState(dir, 'staged', null, { builtWithModel: { endpoint: 'claude-code', version: '1.0.0' }, builtAt: '2026-07-28T00:00:00.000Z' });
  const r = checkOpsforgeState({ dir });
  assert.equal(r.status, 'pass');
});

test('checkOpsforgeState fail for bad built_with_model', () => {
  const dir = mkDir();
  writeOpsforgeState(dir, 'staged', null, { builtWithModel: { endpoint: 'x' } });
  const r = checkOpsforgeState({ dir });
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /built_with_model/);
});
