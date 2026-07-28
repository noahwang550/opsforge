// tools/validate-r28-expect-mode.test.mjs — methodology R28.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { checkExpectModeKindSafe } from './validate.mjs';

function mkDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'r28-')); fs.mkdirSync(path.join(d, 'tests'), { recursive: true }); return d; }
function writeCase(dir, obj) { fs.writeFileSync(path.join(dir, 'tests', 'c.yaml'), yaml.dump(obj)); }

test('R28 fail: positive+exact no allow_exact_reason', () => {
  const dir = mkDir();
  writeCase(dir, { name: 'p', input: 'i', expect: 'exact', expected: 'e', quadrant: 'positive' });
  const r = checkExpectModeKindSafe({ dir, yaml: { kind: 'skill' } });
  assert.equal(r.status, 'fail');
});

test('R28 pass: positive+exact with allow_exact_reason', () => {
  const dir = mkDir();
  writeCase(dir, { name: 'p', input: 'i', expect: 'exact', expected: 'e', quadrant: 'positive', allow_exact_reason: 'boundary value fixed' });
  const r = checkExpectModeKindSafe({ dir, yaml: { kind: 'skill' } });
  assert.equal(r.status, 'pass');
});

test('R28 fail: negative+contains', () => {
  const dir = mkDir();
  writeCase(dir, { name: 'n', input: 'i', expect: 'contains', expected: 'e', quadrant: 'negative' });
  const r = checkExpectModeKindSafe({ dir, yaml: { kind: 'skill' } });
  assert.equal(r.status, 'fail');
});

test('R28 pass: negative+llm_judge', () => {
  const dir = mkDir();
  writeCase(dir, { name: 'n', input: 'i', expect: 'llm_judge', expected: 'e', judge_rubric: 'a'.repeat(25), quadrant: 'negative' });
  const r = checkExpectModeKindSafe({ dir, yaml: { kind: 'skill' } });
  assert.equal(r.status, 'pass');
});
