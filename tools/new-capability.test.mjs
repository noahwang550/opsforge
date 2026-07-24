// tools/new-capability.test.mjs — TDD RED phase（T19–T25）。DESIGN.md §7 测试计划。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffold, promote, matchSkeletonSignature } from './new-capability.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_TEMPLATES = path.resolve(__dirname, '..', 'templates');

function mkRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-nc-'));
}

function readYaml(dir, file) {
  const raw = fs.readFileSync(path.join(dir, file), 'utf8');
  // 简易 frontmatter 抽取
  if (file.endsWith('.md')) {
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return m ? m[1] : raw;
  }
  return raw;
}

// ---------- T19 scaffold creates correct file set ----------
test('T19 scaffold creates correct file set for skill', () => {
  const tmp = mkRepo();
  const { destPath } = scaffold({ kind: 'skill', slug: 'foo', name: 'bar', root: tmp, templatesDir: REAL_TEMPLATES });
  assert.ok(destPath.includes(path.join('packs', '_drafts', 'foo', 'bar')), destPath);
  for (const f of ['SKILL.md', 'tests/case-01.yaml', 'tests/case-02.yaml', 'tests/case-03.yaml', 'CHANGELOG.md', 'README.md']) {
    assert.ok(fs.existsSync(path.join(destPath, f)), `missing ${f}`);
  }
});

// ---------- T20 scaffold replaces placeholders ----------
test('T20 scaffold replaces __SLUG__/__NAME__', () => {
  const tmp = mkRepo();
  const { destPath } = scaffold({ kind: 'skill', slug: 'foo', name: 'bar', root: tmp, templatesDir: REAL_TEMPLATES });
  const fm = readYaml(destPath, 'SKILL.md');
  assert.match(fm, /id: foo\.bar/);
  assert.match(fm, /pack: foo/);
  assert.match(fm, /owner: foo/);
  assert.ok(!fm.includes('__SLUG__'), 'no __SLUG__ should remain');
  assert.ok(!fm.includes('__NAME__'), 'no __NAME__ should remain');
});

// ---------- T21 scaffold keeps __FILL_ME__ ----------
test('T21 scaffold keeps __FILL_ME__', () => {
  const tmp = mkRepo();
  const { destPath } = scaffold({ kind: 'skill', slug: 'foo', name: 'bar', root: tmp, templatesDir: REAL_TEMPLATES });
  const fm = readYaml(destPath, 'SKILL.md');
  assert.match(fm, /description: __FILL_ME__/);
});

// ---------- T22 brand scaffold writes under customers/<brand>/packs/_drafts/ ----------
test('T22 brand scaffold writes under customers/<brand>/packs/_drafts/', () => {
  const tmp = mkRepo();
  const { destPath } = scaffold({ kind: 'agent', brand: 'acme', name: 'bot', root: tmp, templatesDir: REAL_TEMPLATES });
  assert.ok(destPath.includes(path.join('customers', 'acme', 'packs', '_drafts', 'acme', 'bot')), destPath);
  const fm = readYaml(destPath, 'capability.yaml');
  assert.match(fm, /customer: acme/);
  assert.match(fm, /pack: acme/);
  assert.match(fm, /id: acme\.bot/);
});

// ---------- T23 promote moves drafts->staged ----------
test('T23 promote moves drafts->staged, frontmatter unchanged', () => {
  const tmp = mkRepo();
  const { destPath: draftPath } = scaffold({ kind: 'agent', slug: 'foo', name: 'bar', root: tmp, templatesDir: REAL_TEMPLATES });
  const before = fs.readFileSync(path.join(draftPath, 'capability.yaml'), 'utf8');
  const { destPath: stagedPath } = promote(draftPath, { templatesDir: REAL_TEMPLATES });
  assert.ok(stagedPath.includes(path.join('_staged', 'foo', 'bar')), stagedPath);
  assert.ok(!fs.existsSync(draftPath), 'draft source should be gone');
  assert.ok(fs.existsSync(stagedPath), 'staged target should exist');
  const after = fs.readFileSync(path.join(stagedPath, 'capability.yaml'), 'utf8');
  assert.equal(after, before, 'frontmatter/content must not change on promote');
});

// ---------- T24 promote rejects hand-moved dir (skeleton mismatch) ----------
test('T24 promote rejects skeleton mismatch', async () => {
  const tmp = mkRepo();
  const { destPath: draftPath } = scaffold({ kind: 'agent', slug: 'foo', name: 'bar', root: tmp, templatesDir: REAL_TEMPLATES });
  // 手改：加一个骨架外文件
  fs.writeFileSync(path.join(draftPath, 'handmade.txt'), 'nope');
  let threw = null;
  try {
    await promote(draftPath, { templatesDir: REAL_TEMPLATES });
  } catch (e) {
    threw = e;
  }
  assert.ok(threw, 'promote should throw on skeleton mismatch');
  assert.match(threw.message, /skeleton|signature|template/i);
});

// ---------- T25 third-party sets origin=forked ----------
// D7: third-party intake relocated to packs/_drafts/third-party/<name>/ so --promote
// can migrate it (the old packs/_third-party/ path lacked /_drafts/ and was un-promotable).
test('T25 third-party sets origin=forked', () => {
  const tmp = mkRepo();
  const { destPath } = scaffold({ kind: 'agent', thirdParty: 'awesome', slug: 'third-party', name: 'somepkg', root: tmp, templatesDir: REAL_TEMPLATES });
  assert.ok(destPath.includes(path.join('packs', '_drafts', 'third-party', 'somepkg')), destPath);
  const fm = readYaml(destPath, 'capability.yaml');
  assert.match(fm, /origin: forked/);
  assert.match(fm, /upstream_ref: awesome/);
});

// T25b D7: third-party intake lives under _drafts/ so --promote can migrate it.
test('T25b third-party intake can be promoted via --promote', () => {
  const tmp = mkRepo();
  const { destPath: draftPath } = scaffold({ kind: 'agent', thirdParty: 'awesome', slug: 'third-party', name: 'somepkg', root: tmp, templatesDir: REAL_TEMPLATES });
  // Skeleton signature must still match (intake is just a relocated draft).
  const { destPath: stagedPath } = promote(draftPath, { templatesDir: REAL_TEMPLATES });
  assert.ok(stagedPath.includes(path.join('_staged', 'third-party', 'somepkg')), stagedPath);
  assert.ok(!fs.existsSync(draftPath), 'draft source should be gone');
  assert.ok(fs.existsSync(stagedPath), 'staged target should exist');
  const fm = readYaml(stagedPath, 'capability.yaml');
  assert.match(fm, /origin: forked/);
});

// ---------- T26 scaffold rejects path-traversal slug ----------
test('T26 scaffold rejects path-traversal slug', () => {
  const tmp = mkRepo();
  assert.throws(() => scaffold({ kind: 'agent', slug: '..', name: 'evil', root: tmp, templatesDir: REAL_TEMPLATES }), /slug/);
  assert.throws(() => scaffold({ kind: 'agent', slug: 'foo', name: '../etc', root: tmp, templatesDir: REAL_TEMPLATES }), /name/);
  assert.throws(() => scaffold({ kind: 'agent', brand: 'a/b', name: 'bot', root: tmp, templatesDir: REAL_TEMPLATES }), /brand/);
});

// ---------- T26b Phase 2.3: --kind profile scaffolds a profile.yaml ----------
test('T26b --kind profile scaffolds profile.yaml', () => {
  const tmp = mkRepo();
  const { destPath } = scaffold({ kind: 'profile', slug: 'marketing-team', name: 'default', root: tmp, templatesDir: REAL_TEMPLATES });
  assert.ok(fs.existsSync(path.join(destPath, 'profile.yaml')), 'profile.yaml should exist');
  const fm = readYaml(destPath, 'profile.yaml');
  assert.match(fm, /profile: marketing-team/);
  // No __SLUG__ should remain
  assert.ok(!fm.includes('__SLUG__'), 'placeholders should be replaced');
});

// ---------- T27 brand skill scaffold injects customer and validates ----------
// D5 回归：非 agent 品牌变体由 scaffold 运行时注入 customer 字段，须通过 schema+skeleton。
test('T27 brand skill scaffold injects customer and validates staged', async () => {
  const tmp = mkRepo();
  const { destPath } = scaffold({ kind: 'skill', brand: 'acme', name: 'bot', root: tmp, templatesDir: REAL_TEMPLATES });
  const fm = readYaml(destPath, 'SKILL.md');
  assert.match(fm, /customer: acme/);
  assert.match(fm, /pack: acme/);
  // promote 到 staged 再 validate（须全绿）
  const { validateDir } = await import('./validate.mjs');
  const fs2 = await import('node:fs');
  // fill placeholders
  for (const f of ['SKILL.md', 'tests/case-01.yaml', 'tests/case-02.yaml', 'tests/case-03.yaml', 'CHANGELOG.md', 'README.md']) {
    let t = fs2.readFileSync(destPath + '/' + f, 'utf8');
    t = t.split('__FILL_ME__').join('done');
    fs2.writeFileSync(destPath + '/' + f, t);
  }
  // Phase 1.3: write a substantial body (R16 skill≥100) + make test cases distinct (R19)
  {
    const skillPath = destPath + '/SKILL.md';
    let raw = fs2.readFileSync(skillPath, 'utf8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (m) {
      const body = `This is a done capability body for testing. It performs content operations including creation, review, and reporting. The skill processes input data and generates output based on configured rules and templates. Quality checks are done on all content before delivery. Additional context ensures the body meets minimum substance thresholds for the OpsForge validation gate. This section covers primary workflow steps, input handling, output format, error handling, and edge case management. The capability supports multiple input formats and produces structured output suitable for downstream processing. Configuration parameters allow customization per project requirements. Logging hooks are integrated for observability. The implementation follows best practices for maintainability and extensibility. Documentation references are included for each function.`;
      raw = `---\n${m[1]}\n---\n${body}`;
      fs2.writeFileSync(skillPath, raw);
    }
    const testsDir = destPath + '/tests';
    const caseFiles = ['case-01.yaml', 'case-02.yaml', 'case-03.yaml'];
    caseFiles.forEach((f, i) => {
      const p = testsDir + '/' + f;
      let s = fs2.readFileSync(p, 'utf8');
      s = s.replace(/input: done/, `input: case-input-${i}`);
      s = s.replace(/expected: done/, `expected: case-expected-${i}`);
      fs2.writeFileSync(p, s);
    });
  }
  const { destPath: staged } = promote(destPath, { templatesDir: REAL_TEMPLATES });
  const r = validateDir(staged, { repoRoot: tmp });
  assert.equal(r.verdict, 'pass', `brand skill staged should pass; checks=${JSON.stringify(r.checks)}`);
});

// ---------- T28 promote rejects path with '..' segments ----------
test('T28 promote rejects path with .. segments', () => {
  assert.throws(() => promote('packs/_drafts/foo/../bar/baz'), /'\.\.'|_drafts/);
});

// ---------- bonus: matchSkeletonSignature exact match ----------
test('matchSkeletonSignature returns match for a scaffolded dir', () => {
  const tmp = mkRepo();
  const { destPath } = scaffold({ kind: 'agent', slug: 'foo', name: 'bar', root: tmp, templatesDir: REAL_TEMPLATES });
  const res = matchSkeletonSignature(destPath, 'agent', { templatesDir: REAL_TEMPLATES });
  assert.equal(res.match, true);
  assert.deepEqual(res.missing, []);
  assert.deepEqual(res.extra, []);
});

// ---------- T_state: scaffold writes .opsforge-state.json (P0-4) ----------
test('T_state scaffold writes .opsforge-state.json with state=draft', () => {
  const tmp = mkRepo();
  const { destPath } = scaffold({ kind: 'skill', slug: 'foo', name: 'bar', root: tmp, templatesDir: REAL_TEMPLATES });
  const statePath = path.join(destPath, '.opsforge-state.json');
  assert.ok(fs.existsSync(statePath), '.opsforge-state.json should exist after scaffold');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(state.state, 'draft');
  assert.ok(Array.isArray(state.history));
  assert.equal(state.history[0].to, 'draft');
  assert.equal(state.history[0].from, null);
});
