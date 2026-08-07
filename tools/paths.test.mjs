// tools/paths.test.mjs — B1: listDrafts / submitTokenPath (PA1-PA2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listDrafts, draftsRoots, submitTokenPath } from './paths.mjs';

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-paths-')); }

function mkDraft(repoRoot, slug, name, opts = {}) {
  const dir = path.join(repoRoot, 'packs', '_drafts', slug, name);
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'capability.yaml'),
    `id: ${slug}.${name}\nversion: 0.1.0\nkind: skill\npack: ${slug}\nname: ${name}\nowner: t\nentrypoint: SKILL.md\ntests: []\nchangelog: []\nsource: {}`);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), opts.fillMe ? '# x\n__FILL_ME__' : '# x\nbody');
  fs.writeFileSync(path.join(dir, 'tests', 'case-01.yaml'), 'name: c1\nprompt: p\nexpected: e\nexpect: contains');
  return dir;
}

// PA1 listDrafts 枚举 + mtime 倒序 + hasFillMe + kind 解析。
test('PA1 listDrafts enumerates drafts sorted by mtime desc with hasFillMe', () => {
  const repoRoot = mkTmp();
  const d1 = mkDraft(repoRoot, 'alpha', 'one', { fillMe: false });
  const d2 = mkDraft(repoRoot, 'beta', 'two', { fillMe: true });
  // bump mtime of d2 to be older
  const oldTime = new Date('2020-01-01');
  fs.utimesSync(d2, oldTime, oldTime);
  const drafts = listDrafts(repoRoot);
  assert.equal(drafts.length, 2);
  // alpha/one is newer (mtime desc)
  assert.equal(drafts[0].slug, 'alpha');
  assert.equal(drafts[0].name, 'one');
  assert.equal(drafts[0].hasFillMe, false);
  assert.equal(drafts[0].kind, 'skill');
  assert.equal(drafts[1].slug, 'beta');
  assert.equal(drafts[1].name, 'two');
  assert.equal(drafts[1].hasFillMe, true);
});

// PA1b listDrafts includes brand drafts.
test('PA1b listDrafts includes brand drafts under customers/', () => {
  const repoRoot = mkTmp();
  const dir = path.join(repoRoot, 'customers', 'acme', 'packs', '_drafts', 'acme', 'thing');
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'capability.yaml'),
    'id: acme.thing\nversion: 0.1.0\nkind: agent\npack: acme\nname: thing\nowner: t\nentrypoint: SKILL.md\ntests: []\nchangelog: []\nsource: {}');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '# x\nbody');
  const drafts = listDrafts(repoRoot);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].slug, 'acme');
  assert.equal(drafts[0].name, 'thing');
  assert.equal(drafts[0].kind, 'agent');
});

// PA2 submitTokenPath → ~/.opsforge/submit-token.json.
test('PA2 submitTokenPath resolves under opsforge home', () => {
  const home = mkTmp();
  const orig = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  try {
    const p = submitTokenPath();
    assert.ok(p.startsWith(home), 'should be under OPSFORGE_HOME');
    assert.ok(p.endsWith(path.join('.opsforge', 'submit-token.json')));
  } finally {
    if (orig === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = orig;
  }
});

// PA2b draftsRoots returns general + brand.
test('PA2b draftsRoots enumerates general + brand roots', () => {
  const repoRoot = mkTmp();
  fs.mkdirSync(path.join(repoRoot, 'packs', '_drafts'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'customers', 'acme', 'packs', '_drafts'), { recursive: true });
  const roots = draftsRoots(repoRoot);
  assert.equal(roots.length, 2);
});
