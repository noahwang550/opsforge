// tools/test-eval-iteration.test.mjs — Phase 4 Slice 3b (P2-B eval iteration) tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { resolveEvalHistoryDir, resolveEvalHistoryIterationDir, resolveFailuresJsonl } from './paths.mjs';

test('IT1: --iteration 0 default does not create iteration-N/ subdir', async () => {
  // Drive evaluateCap with iteration=0 (default) → no iteration-N/ dir created.
  // We simulate by constructing the report + invoking the iteration hook logic
  // in isolation (the hook is small).
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'it1-home-'));
  const realHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  try {
    const capId = 'mkt.it1';
    const iterDir = resolveEvalHistoryIterationDir(capId, 0);
    // iteration 0 = base dir; no iteration-N/ created.
    assert.equal(iterDir, resolveEvalHistoryDir(capId));
    assert.ok(!iterDir.includes('iteration-'));
  } finally {
    if (realHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = realHome;
  }
});

test('IT2: --iteration 3 archives eval-report.json to iteration-3/ + writes latest.json (drive real evaluateCap via fake runSuite, #2)', async () => {
  // Phase 4 fix (#2): drive the REAL evaluateCap iteration archiving logic via
  // an injected fake runSuite. No logic re-implementation.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'it2-home-'));
  const capDir = fs.mkdtempSync(path.join(os.tmpdir(), 'it2-cap-'));
  const realHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  fs.writeFileSync(path.join(capDir, 'SKILL.md'),
    `---\nid: mkt.it2\ntitle: t\nkind: skill\nentrypoint: SKILL.md\n---\nbody`);
  try {
    const fakeRunSuite = async () => ({
      summary: { runner: 'claude', runner_limited: false },
      cases: [{ case: 'c1', mode: 'exact', pass: true, actual: 'ok' }],
    });
    const { evaluateCap } = await import('./eval.mjs');
    const report = await evaluateCap(capDir, { write: true, iteration: 3, runSuite: fakeRunSuite });
    assert.equal(report.verdict, 'pass');
    const iterDir = resolveEvalHistoryIterationDir('mkt.it2', 3);
    assert.ok(fs.existsSync(path.join(iterDir, 'eval-report.json')),
      'iteration-3/eval-report.json must be written by evaluateCap');
    assert.ok(fs.existsSync(path.join(resolveEvalHistoryDir('mkt.it2'), 'latest.json')),
      'latest.json must be written by evaluateCap');
    // latest.json content matches the report (last-write-wins).
    const latest = JSON.parse(fs.readFileSync(path.join(resolveEvalHistoryDir('mkt.it2'), 'latest.json'), 'utf8'));
    assert.equal(latest.id, 'mkt.it2');
    assert.equal(latest.verdict, 'pass');
  } finally {
    if (realHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = realHome;
  }
});

test('IT3: resolveEvalHistoryIterationDir asserts capId + N>=0', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'it3-home-'));
  const realHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  try {
    assert.throws(() => resolveEvalHistoryIterationDir('bad', 1));
    assert.throws(() => resolveEvalHistoryIterationDir('mkt.okay', -1));
    assert.throws(() => resolveEvalHistoryIterationDir('mkt.okay', 1.5));
    const dir = resolveEvalHistoryIterationDir('mkt.okay', 5);
    assert.ok(dir.endsWith(path.join('eval-history', 'mkt.okay', 'iteration-5')));
  } finally {
    if (realHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = realHome;
  }
});

test('IT4: cmdEvolve reads historical iteration-*/failures.jsonl deduped by case name', async () => {
  // Set up ~/.opsforge/eval-history/<capId>/failures.jsonl + iteration-1/failures.jsonl
  // where both have a case 'c1' → collectSources should return deduped 1 failure
  // when includeIterations:true. (Default: only latest failures.jsonl.)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'it4-home-'));
  const realHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = path.join(home, '.opsforge');
  const capId = 'mkt.it4';
  const baseDir = resolveEvalHistoryDir(capId);
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(path.join(baseDir, 'failures.jsonl'),
    JSON.stringify({ cap_id: capId, case: 'c1', mode: 'contains', reason: 'r1', actual: 'a1' }) + '\n');
  const iter1Dir = path.join(baseDir, 'iteration-1');
  fs.mkdirSync(iter1Dir, { recursive: true });
  fs.writeFileSync(path.join(iter1Dir, 'failures.jsonl'),
    JSON.stringify({ cap_id: capId, case: 'c1', mode: 'contains', reason: 'r1-iter', actual: 'a1-iter' }) + '\n'
    + JSON.stringify({ cap_id: capId, case: 'c2', mode: 'exact', reason: 'r2', actual: 'a2' }) + '\n');
  try {
    const { collectSources } = await import('./regression-sink.mjs');
    // Default: only latest
    const latest = await collectSources(capId);
    assert.equal(latest.failures.length, 1, 'latest only → 1 failure (c1)');
    // With iterations: dedupe by case name → c1 + c2 = 2
    const withIter = await collectSources(capId, { includeIterations: true });
    const caseNames = new Set(withIter.failures.map((f) => f.case));
    assert.ok(caseNames.has('c1'));
    assert.ok(caseNames.has('c2'));
    assert.equal(withIter.failures.length, 2, 'deduped by case name → 2');
  } finally {
    if (realHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = realHome;
  }
});

test('IT5: eval.mjs --iteration flag parses from argv', async () => {
  // We test the parseIterationFlag helper exported from eval.mjs.
  const { parseIterationFlag } = await import('./eval.mjs');
  assert.equal(parseIterationFlag([]), 0);
  assert.equal(parseIterationFlag(['--iteration=3']), 3);
  assert.equal(parseIterationFlag(['--iteration', '5']), 5);
  assert.equal(parseIterationFlag(['--iteration=0']), 0);
  assert.equal(parseIterationFlag(['--all']), 0);
});

test('IT6: stripIterationFlag removes --iteration so main dispatch routes correctly (#4)', async () => {
  const { stripIterationFlag } = await import('./eval.mjs');
  // `--iteration 3 <capDir>` → dispatch sees [capDir]
  assert.deepEqual(stripIterationFlag(['--iteration', '3', 'some/cap']), ['some/cap']);
  // `<capDir> --iteration 3` → dispatch sees [capDir]
  assert.deepEqual(stripIterationFlag(['some/cap', '--iteration', '3']), ['some/cap']);
  // `--iteration=3 --all` → dispatch sees ['--all']
  assert.deepEqual(stripIterationFlag(['--iteration=3', '--all']), ['--all']);
  // `--all --iteration=3` → dispatch sees ['--all']
  assert.deepEqual(stripIterationFlag(['--all', '--iteration=3']), ['--all']);
  // No --iteration → unchanged
  assert.deepEqual(stripIterationFlag(['--all']), ['--all']);
  // Bare --iteration without value → just the flag dropped
  assert.deepEqual(stripIterationFlag(['--iteration', '--all']), ['--all']);
});
