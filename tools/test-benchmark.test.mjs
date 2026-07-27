// tools/test-benchmark.test.mjs — Phase 4 Slice 2d (P1-D benchmark) tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';

import { runBenchmark } from './benchmark.mjs';
import { SKELETON_GUARD_EXCLUSIONS_GET } from './validate.mjs';

test('BM1: runBenchmark calls runSuite twice (with + without skill) and computes delta', async () => {
  let calls = 0;
  const fakeRunSuite = async (capDir, opts) => {
    calls++;
    // with-skill (no baseline) → 0.9; without-skill (baseline) → 0.5
    const isBaseline = !!opts.baselineSystemPrompt;
    return {
      summary: {
        total: 2, passed: isBaseline ? 1 : 2, failed: 0, pending: 0,
        score_mean: isBaseline ? 0.5 : 0.9,
      },
    };
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bm1-'));
  fs.writeFileSync(path.join(tmp, 'SKILL.md'),
    `---\nid: mkt.bench\ntitle: t\nkind: skill\nentrypoint: SKILL.md\n---\nbody`);
  const report = await runBenchmark(tmp, { runSuite: fakeRunSuite });
  assert.equal(calls, 2);
  assert.equal(report.cap_id, 'mkt.bench');
  assert.equal(report.with_skill.overall, 0.9);
  assert.equal(report.without_skill.overall, 0.5);
  assert.equal(report.delta, 0.4);
});

test('BM2: verdict effective when delta >= min_delta', async () => {
  const fakeRunSuite = async (_capDir, opts) => ({
    summary: { score_mean: !!opts.baselineSystemPrompt ? 0.5 : 0.9 },
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bm2-'));
  fs.writeFileSync(path.join(tmp, 'SKILL.md'),
    `---\nid: mkt.bench2\ntitle: t\nkind: skill\nentrypoint: SKILL.md\n---\nbody`);
  const report = await runBenchmark(tmp, { runSuite: fakeRunSuite });
  // default min_delta 0.1, delta 0.4 → effective
  assert.equal(report.verdict, 'effective');
});

test('BM3: verdict neutral when delta < min_delta', async () => {
  const fakeRunSuite = async (_capDir, opts) => ({
    summary: { score_mean: !!opts.baselineSystemPrompt ? 0.6 : 0.62 },
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bm3-'));
  fs.writeFileSync(path.join(tmp, 'SKILL.md'),
    `---\nid: mkt.bench3\ntitle: t\nkind: skill\nentrypoint: SKILL.md\n---\nbody`);
  const report = await runBenchmark(tmp, { runSuite: fakeRunSuite });
  // delta 0.02 < min_delta 0.1 → neutral
  assert.equal(report.verdict, 'neutral');
});

test('BM4: benchmark-report.json is written + SKELETON_GUARD_EXCLUSIONS includes it', async () => {
  const fakeRunSuite = async (_capDir, opts) => ({
    summary: { score_mean: !!opts.baselineSystemPrompt ? 0.4 : 0.8, total: 1, passed: 1 },
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bm4-'));
  fs.writeFileSync(path.join(tmp, 'SKILL.md'),
    `---\nid: mkt.bench4\ntitle: t\nkind: skill\nentrypoint: SKILL.md\n---\nbody`);
  await runBenchmark(tmp, { runSuite: fakeRunSuite });
  const reportPath = path.join(tmp, 'benchmark-report.json');
  assert.ok(fs.existsSync(reportPath), 'benchmark-report.json must be written');
  const parsed = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(parsed.verdict, 'effective');
  // SKELETON_GUARD_EXCLUSIONS includes benchmark-report.json
  const exclusions = SKELETON_GUARD_EXCLUSIONS_GET();
  assert.ok(exclusions.includes('benchmark-report.json'));
});

test('BM5: baselineSystemPrompt opts passed to runSuite for without-skill call (and NOT for with-skill)', async () => {
  const seen = [];
  const fakeRunSuite = async (_capDir, opts) => {
    seen.push(!!opts.baselineSystemPrompt);
    return { summary: { score_mean: 0.7 } };
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bm5-'));
  fs.writeFileSync(path.join(tmp, 'SKILL.md'),
    `---\nid: mkt.bench5\ntitle: t\nkind: skill\nentrypoint: SKILL.md\n---\nbody`);
  await runBenchmark(tmp, { runSuite: fakeRunSuite });
  assert.equal(seen.length, 2);
  assert.equal(seen[0], false, 'with-skill call must NOT pass baselineSystemPrompt');
  assert.equal(seen[1], true, 'without-skill call MUST pass baselineSystemPrompt');
});

test('BM5b: benchmark loads baseline_prompt from eval.config.yaml benchmark section', async () => {
  // We override configPath to a tmp config to test loading.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bm5b-'));
  fs.writeFileSync(path.join(tmp, 'SKILL.md'),
    `---\nid: mkt.bench5b\ntitle: t\nkind: skill\nentrypoint: SKILL.md\n---\nbody`);
  const cfgPath = path.join(tmp, 'eval.config.yaml');
  fs.writeFileSync(cfgPath, yaml.dump({
    benchmark: {
      enabled: true,
      baseline_prompt: 'CUSTOM BASELINE PROMPT HERE',
      min_delta: 0.05,
    },
  }));
  let capturedBaseline;
  const fakeRunSuite = async (_capDir, opts) => {
    if (opts.baselineSystemPrompt) capturedBaseline = opts.baselineSystemPrompt;
    return { summary: { score_mean: 0.6 } };
  };
  await runBenchmark(tmp, { runSuite: fakeRunSuite, configPath: cfgPath });
  assert.equal(capturedBaseline, 'CUSTOM BASELINE PROMPT HERE');
});
