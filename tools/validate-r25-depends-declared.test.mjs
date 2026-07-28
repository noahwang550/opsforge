// tools/validate-r25-depends-declared.test.mjs — methodology R25 bidirectional.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDependsDeclared } from './validate.mjs';

function mkDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'r25-')); }
function w(p, c) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); }

test('R25 pass: depends_on empty + 依赖 "- 无"', () => {
  const dir = mkDir();
  w(path.join(dir, 'source.md'), `---\nid: a.b\nkind: agent\ndepends_on: []\n---\n## 依赖\n- 无`);
  const r = checkDependsDeclared({ dir, yaml: { kind: 'agent', depends_on: [], entrypoint: 'source.md' } });
  assert.equal(r.status, 'pass');
});

test('R25 fail: body mentions capId not in depends_on', () => {
  const dir = mkDir();
  w(path.join(dir, 'source.md'), `---\nid: a.b\nkind: agent\ndepends_on: []\n---\n## 依赖\n- opsforge.foo@1.0.0`);
  const r = checkDependsDeclared({ dir, yaml: { kind: 'agent', depends_on: [], entrypoint: 'source.md' } });
  assert.equal(r.status, 'fail');
});

test('R25 fail: depends_on not mentioned in body', () => {
  const dir = mkDir();
  w(path.join(dir, 'source.md'), `---\nid: a.b\nkind: agent\ndepends_on: [opsforge.foo@1.0.0]\n---\n## 依赖\n- 无`);
  const r = checkDependsDeclared({ dir, yaml: { kind: 'agent', depends_on: ['opsforge.foo@1.0.0'], entrypoint: 'source.md' } });
  assert.equal(r.status, 'fail');
});

test('R25 pass: bidirectional match', () => {
  const dir = mkDir();
  w(path.join(dir, 'source.md'), `---\nid: a.b\nkind: skill\ndepends_on: [opsforge.foo@1.0.0]\n---\n## 依赖\n- opsforge.foo@1.0.0`);
  const r = checkDependsDeclared({ dir, yaml: { kind: 'skill', depends_on: ['opsforge.foo@1.0.0'], entrypoint: 'source.md' } });
  assert.equal(r.status, 'pass');
});
