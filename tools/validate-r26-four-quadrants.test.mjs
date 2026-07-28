// tools/validate-r26-four-quadrants.test.mjs — methodology R26 (hard + soft warn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { checkTestFourQuadrants } from './validate.mjs';

function mkDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'r26-')); fs.mkdirSync(path.join(d, 'tests'), { recursive: true }); return d; }
function writeCase(dir, file, obj) { fs.writeFileSync(path.join(dir, 'tests', file), yaml.dump(obj)); }

function threeQuads(over) {
  return [
    { name: 'positive-正常', input: 'i0', expect: 'contains', expected: 'e0', quadrant: 'positive', source: 'recalled', confidence: 'med', ...over },
    { name: 'boundary-边界', input: 'i1', expect: 'contains', expected: 'e1', quadrant: 'boundary', source: 'recalled', confidence: 'med' },
    { name: 'negative-拒绝', input: 'i2', expect: 'llm_judge', expected: 'e2', judge_rubric: 'a'.repeat(25), quadrant: 'negative', source: 'recalled', confidence: 'med' },
  ];
}

test('R26 fail: missing negative', () => {
  const dir = mkDir();
  writeCase(dir, 'c1.yaml', { name: 'positive-正常', input: 'i', expect: 'contains', expected: 'e', quadrant: 'positive', source: 'recalled', confidence: 'med' });
  writeCase(dir, 'c2.yaml', { name: 'boundary-边界', input: 'j', expect: 'contains', expected: 'f', quadrant: 'boundary', source: 'recalled', confidence: 'med' });
  const r = checkTestFourQuadrants({ dir, yaml: { kind: 'skill' } });
  assert.equal(r.status, 'fail');
});

test('R26 fail: positive source synthetic', () => {
  const dir = mkDir();
  const cases = threeQuads({ source: 'synthetic' });
  cases.forEach((c, i) => writeCase(dir, `c${i}.yaml`, c));
  const r = checkTestFourQuadrants({ dir, yaml: { kind: 'skill' } });
  assert.equal(r.status, 'fail');
});

test('R26 fail: recalled+low', () => {
  const dir = mkDir();
  const cases = threeQuads({ confidence: 'low' });
  cases.forEach((c, i) => writeCase(dir, `c${i}.yaml`, c));
  const r = checkTestFourQuadrants({ dir, yaml: { kind: 'skill' } });
  assert.equal(r.status, 'fail');
});

test('R26 pass: recalled+med (soft warn does not fail)', () => {
  const dir = mkDir();
  const cases = threeQuads({});
  cases.forEach((c, i) => writeCase(dir, `c${i}.yaml`, c));
  const r = checkTestFourQuadrants({ dir, yaml: { kind: 'skill' } });
  assert.ok(r.status === 'pass' || r.status === 'warn', `got ${r.status}`);
});
