// tools/regression-sink-quadrant.test.mjs — methodology P1-8 generateCase quadrant field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { generateCase } from './regression-sink.mjs';

function mkDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'rs-q-')); }

test('generateCase produces quadrant: __FILL_ME__', () => {
  const dir = mkDir();
  const { destPath, yaml: y } = generateCase(
    { cap_id: 'mkt.copywriter', rating: 2, text: 'Agent missed the deadline badly here' },
    null,
    { draftsDir: dir },
  );
  const parsed = yaml.load(y);
  assert.equal(parsed.quadrant, '__FILL_ME__');
  assert.equal(parsed.expect, 'llm_judge');
  const onDisk = yaml.load(fs.readFileSync(destPath, 'utf8'));
  assert.equal(onDisk.quadrant, '__FILL_ME__');
});
