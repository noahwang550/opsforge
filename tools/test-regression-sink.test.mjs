// tools/test-regression-sink.test.mjs — Phase 4 Slice 1b (P0-B regression sink) tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';

import {
  slugify,
  resolveNameConflict,
  generateCase,
  collectSources,
} from './regression-sink.mjs';
import { resolveEvalHistoryDir, resolveEvalHistoryIterationDir, resolveFailuresJsonl } from './paths.mjs';
import { validateDir } from './validate.mjs';

const NAME_RE = /^[a-z][a-z0-9-]{2,30}$/;

test('RS1: slugify pure ASCII text produces valid slug', () => {
  assert.equal(slugify('hello world'), 'hello-world');
  assert.ok(NAME_RE.test(slugify('hello world')));
});

test('RS2: slugify CJK text produces c<hash> form matching NAME_RE', () => {
  const s = slugify('你好世界');
  assert.ok(NAME_RE.test(s), `slug "${s}" must match NAME_RE`);
  assert.match(s, /^c[a-z0-9]+$/);
});

test('RS2b: slugify empty text still yields valid slug', () => {
  const s = slugify('');
  assert.ok(NAME_RE.test(s));
});

test('RS3: resolveNameConflict appends -2/-3 suffix on collision', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rs3-'));
  const testsDir = path.join(tmp, 'tests');
  fs.mkdirSync(testsDir, { recursive: true });
  // pre-seed a case file with name "alpha-beta"
  fs.writeFileSync(path.join(testsDir, 'case-01.yaml'),
    yaml.dump({ name: 'alpha-beta', input: 'x', expect: 'exact' }));
  const first = resolveNameConflict('alpha-beta', tmp);
  assert.equal(first, 'alpha-beta-2');
  // write it, then resolve again → -3
  fs.writeFileSync(path.join(testsDir, 'case-02.yaml'),
    yaml.dump({ name: 'alpha-beta-2', input: 'x', expect: 'exact' }));
  const second = resolveNameConflict('alpha-beta', tmp);
  assert.equal(second, 'alpha-beta-3');
});

test('RS4: generateCase from feedback produces valid draft (name matches NAME_RE, input has text, expected=__FILL_ME__)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rs4-'));
  const { destPath, name, yaml: yamlOut } = generateCase(
    { cap_id: 'mkt.copywriter', rating: 2, text: 'Agent missed the deadline badly' },
    null,
    { draftsDir: tmp },
  );
  assert.ok(fs.existsSync(destPath), 'draft file must be written');
  assert.ok(NAME_RE.test(name), `name "${name}" must match NAME_RE`);
  const parsed = yaml.load(yamlOut);
  assert.equal(parsed.expected, '__FILL_ME__');
  assert.equal(parsed.judge_rubric, '__FILL_ME__');
  assert.ok(parsed.input.includes('Agent missed'));
  // Phase 4 fix (#6): untrusted feedback text wrapped in delimiter.
  assert.ok(parsed.input.startsWith('<UNTRUSTED_FEEDBACK>'));
  assert.ok(parsed.input.endsWith('</UNTRUSTED_FEEDBACK>'));
  assert.equal(parsed.expect, 'llm_judge');
});

test('RS5: generateCase from failure with contains-reason → expect=contains', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rs5-'));
  const { yaml: yamlOut } = generateCase(
    null,
    { cap_id: 'mkt.copywriter', case: 'c1', mode: 'contains', reason: 'missing substring "deadline"', actual: 'no deadline mentioned' },
    { draftsDir: tmp },
  );
  const parsed = yaml.load(yamlOut);
  assert.equal(parsed.expect, 'contains');
  assert.equal(parsed.expected, '__FILL_ME__');
});

test('RS5b: generateCase throws when neither feedback nor failure has usable text', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rs5b-'));
  assert.throws(() => generateCase(null, { cap_id: 'mkt.copywriter' }, { draftsDir: tmp }));
});

test('RS6: generated draft fails validateDir (R7 placeholder_clean on __FILL_ME__)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rs6-'));
  generateCase(
    { cap_id: 'mkt.copywriter', rating: 2, text: 'Agent missed the deadline badly here' },
    null,
    { draftsDir: tmp },
  );
  // draftsDir has tests/ + (no manifest) → draft state. validateDir should fail
  // because the draft has no manifest (draft gate) OR the placeholder tokens.
  const result = validateDir(tmp, { allCaps: [] });
  assert.equal(result.verdict, 'fail');
});

test('RS7: draft filled with real expected + judge_rubric passes R7 (no __FILL_ME__ in tests)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rs7-'));
  const testsDir = path.join(tmp, 'tests');
  fs.mkdirSync(testsDir, { recursive: true });
  fs.writeFileSync(path.join(testsDir, 'case-01.yaml'), yaml.dump({
    name: 'filled-case', input: 'hello there', expect: 'exact', expected: 'hello there response',
  }));
  // No manifest → draft state → checkDraftRelaxed. R7 in draft checks placeholder_clean
  // only over staged; draft gate is relaxed. Still, the file has no __FILL_ME__ → passes that rule.
  const result = validateDir(tmp, { allCaps: [] });
  // Draft state may pass or fail on other rules (e.g. entry_guard R15) — we only assert
  // that no __FILL_ME__-related failure appears.
  const placeholderFails = (result.checks || []).filter((c) => /placeholder/.test(c.name) && c.status === 'fail');
  assert.equal(placeholderFails.length, 0, 'no placeholder fail when filled');
});

test('RS8: collectSources reads feedback jsonl (rating<=3 filter) + failures.jsonl', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rs8-home-'));
  const capId = 'mkt.copywriter';
  const pack = 'mkt';
  // feedback jsonl at <home>/.opsforge/kb/<pack>/feedback/<cap-id>.jsonl
  const opsforgeHome = path.join(home, '.opsforge');
  const fbDir = path.join(opsforgeHome, 'kb', pack, 'feedback');
  fs.mkdirSync(fbDir, { recursive: true });
  const fbPath = path.join(fbDir, `${capId}.jsonl`);
  fs.writeFileSync(fbPath, [
    JSON.stringify({ cap_id: capId, rating: 5, text: 'great' }),
    JSON.stringify({ cap_id: capId, rating: 2, text: 'bad' }),
    JSON.stringify({ cap_id: capId, rating: 3, text: 'meh' }),
  ].join('\n') + '\n');
  // failures.jsonl: resolveFailuresJsonl uses resolveOpsforgeHome internally; set env.
  const realHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = opsforgeHome;
  const { resolveFailuresJsonl } = await import('./paths.mjs');
  const failPath = resolveFailuresJsonl(capId);
  fs.mkdirSync(path.dirname(failPath), { recursive: true });
  fs.writeFileSync(failPath, [
    JSON.stringify({ cap_id: capId, case: 'c1', mode: 'contains', reason: 'missing substring x', actual: 'no x' }),
  ].join('\n') + '\n');
  try {
    const { feedbacks, failures } = await collectSources(capId, { opsforgeHome });
    assert.equal(feedbacks.length, 2, 'rating<=3 → 2+3 kept, 5 filtered');
    assert.equal(failures.length, 1);
  } finally {
    if (realHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = realHome;
  }
});

test('RS9: paths.resolveEvalHistoryDir + iteration + failures paths are consistent', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rs9-home-'));
  const realHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  try {
    const dir = resolveEvalHistoryDir('mkt.copy');
    assert.ok(dir.includes('eval-history'));
    assert.ok(dir.endsWith(path.join('eval-history', 'mkt.copy')));
    const it3 = resolveEvalHistoryIterationDir('mkt.copy', 3);
    assert.ok(it3.endsWith(path.join('eval-history', 'mkt.copy', 'iteration-3')));
    const it0 = resolveEvalHistoryIterationDir('mkt.copy', 0);
    assert.equal(it0, dir, 'iteration 0 = base dir');
    const fail = resolveFailuresJsonl('mkt.copy');
    assert.equal(fail, path.join(dir, 'failures.jsonl'));
    assert.throws(() => resolveEvalHistoryIterationDir('mkt.copy', -1));
    assert.throws(() => resolveEvalHistoryIterationDir('bad', 1));
  } finally {
    if (realHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = realHome;
  }
});

test('RS10: eval.mjs verdict=fail writes failures.jsonl (drive real evaluateCap via fake runSuite, #2)', async () => {
  // Phase 4 fix (#2): drive the REAL evaluateCap archive logic by injecting a
  // fake runSuite that returns fixed failing cases. No logic re-implementation.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rs10-home-'));
  const capDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs10-cap-'));
  const realHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  // Minimal capability dir: SKILL.md manifest so parseCapability succeeds.
  fs.writeFileSync(path.join(capDir, 'SKILL.md'),
    `---\nid: mkt.copy\ntitle: t\nkind: skill\nentrypoint: SKILL.md\n---\nbody`);
  try {
    const fakeCases = [
      { case: 'c1', mode: 'contains', pass: false, reason: 'missing x', actual: 'no x here' },
      { case: 'c2', mode: 'exact', pass: true, actual: 'ok' },
    ];
    const fakeRunSuite = async () => ({
      summary: { runner: 'claude', runner_limited: false },
      cases: fakeCases,
    });
    const { evaluateCap } = await import('./eval.mjs');
    const report = await evaluateCap(capDir, { write: true, runSuite: fakeRunSuite });
    assert.equal(report.verdict, 'fail');
    const { resolveFailuresJsonl } = await import('./paths.mjs');
    const failPath = resolveFailuresJsonl('mkt.copy');
    assert.ok(fs.existsSync(failPath), 'failures.jsonl must be written by evaluateCap');
    const written = fs.readFileSync(failPath, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(written.length, 1);
    assert.equal(written[0].case, 'c1');
    assert.equal(written[0].cap_id, 'mkt.copy');
    assert.equal(written[0].reason, 'missing x');
  } finally {
    if (realHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = realHome;
  }
});
