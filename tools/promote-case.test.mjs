// tools/promote-case.test.mjs — methodology §5.4 P1-3 single-case promote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { promoteCase } from './new-capability.mjs';

function mkRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'));
  return root;
}
function w(p, c) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); }

test('promoteCase: 良构 fail on empty expected', async () => {
  const root = mkRepo();
  const src = path.join(root, 'packs', '_drafts', 'foo', 'bar');
  const caseYaml = { name: 'c1', input: 'i', expect: 'contains', expected: '__FILL_ME__', quadrant: 'positive', source: 'recalled', confidence: 'med' };
  w(path.join(src, 'tests', 'case-01.yaml'), yaml.dump(caseYaml));
  await assert.rejects(promoteCase(src, 'case-01.yaml', { skipRunPass: true }), /expected empty/);
});

test('promoteCase: R28 fail positive+exact no allow_exact_reason', async () => {
  const root = mkRepo();
  const src = path.join(root, 'packs', '_drafts', 'foo', 'bar');
  const caseYaml = { name: 'c1', input: 'i', expect: 'exact', expected: 'filled expected', quadrant: 'positive', source: 'recalled', confidence: 'med' };
  w(path.join(src, 'tests', 'case-01.yaml'), yaml.dump(caseYaml));
  await assert.rejects(promoteCase(src, 'case-01.yaml', { skipRunPass: true }), /allow_exact_reason/);
});

test('promoteCase: moves case to staged dir on pass', async () => {
  const root = mkRepo();
  const src = path.join(root, 'packs', '_drafts', 'foo', 'bar');
  const caseYaml = { name: 'c1', input: 'i', expect: 'contains', expected: 'filled expected value', quadrant: 'positive', source: 'recalled', confidence: 'med', allow_exact_reason: null, ref: null };
  w(path.join(src, 'tests', 'case-01.yaml'), yaml.dump(caseYaml));
  const r = await promoteCase(src, 'case-01.yaml', { skipRunPass: true });
  assert.ok(fs.existsSync(r.destPath), 'case moved to staged');
  assert.ok(!fs.existsSync(path.join(src, 'tests', 'case-01.yaml')), 'case removed from drafts');
});
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const NEW_CAP = fileURLToPath(new URL('./new-capability.mjs', import.meta.url));
const DRAFTS_RE = new RegExp('not under .*\/_drafts\/');

// BUG-1 regression: the positional CLI form `--promote-case <srcDir> <caseFile>`
// must reach promoteCase() (not die on the usage-error path). A non-draft srcDir
// is the cheapest way to assert the argv was parsed into two positionals.
test('promote-case CLI: positional form reaches promoteCase (BUG-1)', () => {
  const r = spawnSync(process.execPath, [NEW_CAP, '--promote-case', 'notADir', 'case-01.yaml'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, DRAFTS_RE);
});

test('promote-case CLI: named-option fallback still works (BUG-1 compat)', () => {
  const r = spawnSync(process.execPath, [NEW_CAP, '--promote-case', '--src', 'notADir', '--file', 'case-01.yaml'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, DRAFTS_RE);
});
