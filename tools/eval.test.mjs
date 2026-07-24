// tools/eval.test.mjs — Phase 2.2: eval harness (5-axis rubric, §21.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { evaluateCap, computeAxes } from './eval.mjs';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-eval-'));
}

function mkCapDir(tmp, kind = 'agent') {
  const dir = path.join(tmp, 'cap');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  const manifest = {
    id: 'foo.bar', version: '0.1.0', kind, pack: 'foo', owner: 'foo',
    display_name: 'B', display_name_zh: 'B', display_name_en: 'B',
    description: 'desc', platforms: ['claude-code'],
    entrypoint: kind === 'skill' ? 'SKILL.md' : 'source.md',
    tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  };
  fs.writeFileSync(path.join(dir, 'source.md'), `---\n${yaml.dump(manifest)}---\nbody content`);
  fs.writeFileSync(path.join(dir, 'capability.yaml'), yaml.dump(manifest));
  return dir;
}

// EV1 evaluateCap returns an eval-report with all 5 axes
test('EV1 evaluateCap returns 5-axis eval-report (static-only)', async () => {
  const tmp = mkTmp();
  process.env.OPSFORGE_HOME = tmp;
  const dir = mkCapDir(tmp);
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(dir, 'tests', `case-0${i + 1}.yaml`), yaml.dump({
      name: `case-0${i + 1}`, input: `input-${i}`, expect: 'exact', expected: `result-${i}`,
    }));
  }
  const report = await evaluateCap(dir, { runner: 'static-only', opsforgeHome: tmp });
  assert.ok(report.id, 'report should have id');
  assert.equal(report.id, 'foo.bar');
  assert.ok(report.axes, 'report should have axes');
  for (const axis of ['accuracy', 'completeness', 'actionability', 'safety', 'robustness']) {
    assert.ok(axis in report.axes, `axis ${axis} present`);
    assert.ok(typeof report.axes[axis].score === 'number', `${axis}.score is number`);
  }
  assert.ok(typeof report.overall === 'number');
  assert.ok(['pass', 'fail', 'pending'].includes(report.verdict));
  assert.equal(report.runner, 'static-only');
});

// EV2 static-only verdict is 'pending' (can't fully evaluate without a model)
test('EV2 evaluateCap static-only verdict pending + runner_limited', async () => {
  const tmp = mkTmp();
  process.env.OPSFORGE_HOME = tmp;
  const dir = mkCapDir(tmp);
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(dir, 'tests', `case-0${i + 1}.yaml`), yaml.dump({
      name: `case-0${i + 1}`, input: `input-${i}`, expect: 'exact', expected: `result-${i}`,
    }));
  }
  const report = await evaluateCap(dir, { runner: 'static-only', opsforgeHome: tmp });
  assert.equal(report.verdict, 'pending');
  assert.equal(report.runner_limited, true);
});

// EV3 evaluateCap writes eval-report.json into the cap dir
test('EV3 evaluateCap writes eval-report.json', async () => {
  const tmp = mkTmp();
  process.env.OPSFORGE_HOME = tmp;
  const dir = mkCapDir(tmp);
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(dir, 'tests', `case-0${i + 1}.yaml`), yaml.dump({
      name: `case-0${i + 1}`, input: `input-${i}`, expect: 'exact', expected: `result-${i}`,
    }));
  }
  await evaluateCap(dir, { runner: 'static-only', opsforgeHome: tmp, write: true });
  const p = path.join(dir, 'eval-report.json');
  assert.ok(fs.existsSync(p), 'eval-report.json should be written');
  const onDisk = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.equal(onDisk.id, 'foo.bar');
  assert.ok(onDisk.axes);
});

// EV4 safety axis reads security-report.json (block → safety 0, verdict fail)
test('EV4 safety axis reflects security-report verdict', async () => {
  const tmp = mkTmp();
  process.env.OPSFORGE_HOME = tmp;
  const dir = mkCapDir(tmp);
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(dir, 'tests', `case-0${i + 1}.yaml`), yaml.dump({
      name: `case-0${i + 1}`, input: `input-${i}`, expect: 'exact', expected: `result-${i}`,
    }));
  }
  // security block
  fs.writeFileSync(path.join(dir, 'security-report.json'), JSON.stringify({ verdict: 'block', findings: [{ rule: 'prompt_injection' }] }));
  const report = await evaluateCap(dir, { runner: 'static-only', opsforgeHome: tmp });
  assert.equal(report.axes.safety.score, 0, 'safety must be 0 when security blocks');
  // security pass
  fs.writeFileSync(path.join(dir, 'security-report.json'), JSON.stringify({ verdict: 'pass', findings: [] }));
  const report2 = await evaluateCap(dir, { runner: 'static-only', opsforgeHome: tmp });
  assert.equal(report2.axes.safety.score, 1, 'safety must be 1 when security passes');
});

// EV5 computeAxes from injected verdicts (pure function, no model)
test('EV5 computeAxes computes accuracy/completeness/robustness from verdicts', () => {
  const verdicts = [
    { pass: true, actual: 'ok', mode: 'exact' },
    { pass: false, actual: 'bad', mode: 'exact' },
    { pass: 'pending', actual: '', mode: 'exact' },
  ];
  const axes = computeAxes(verdicts, { securityVerdict: 'pass' });
  // accuracy = passed/(passed+failed) = 1/2 = 0.5
  assert.equal(axes.accuracy.score, 0.5);
  // completeness = non-empty actual / total = 2/3
  assert.ok(Math.abs(axes.completeness.score - 2 / 3) < 1e-6);
  // robustness = 1 - failed/total = 1 - 1/3
  assert.ok(Math.abs(axes.robustness.score - (1 - 1 / 3)) < 1e-6);
  // safety = 1 (security pass)
  assert.equal(axes.safety.score, 1);
});
