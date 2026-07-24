// tools/report-renderer.test.mjs — Phase 1.7: report-renderer tests (RR1–RR6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render } from './report-renderer.mjs';

// RR1 render pass verdict → green light
test('RR1 render pass verdict returns green light', () => {
  const report = {
    verdict: 'pass',
    checks: { schema: 'pass', yaml_parse: 'pass', naming: 'pass' },
  };
  const r = render(report, 'validation-report', { lang: 'zh' });
  assert.equal(r.light, 'green');
  assert.ok(r.text.includes('绿'));
  assert.ok(r.oneLiner.includes('通过'));
});

// RR2 render fail verdict → red light
test('RR2 render fail verdict returns red light', () => {
  const report = {
    verdict: 'fail',
    checks: { schema: 'pass', naming: 'fail', body_min_substance: 'fail' },
  };
  const r = render(report, 'validation-report', { lang: 'zh' });
  assert.equal(r.light, 'red');
  assert.ok(r.text.includes('红'));
  assert.ok(r.oneLiner.includes('失败'));
  assert.ok(r.text.includes('修复指引'));
});

// RR3 render pending checks → yellow light
test('RR3 render pending checks returns yellow light', () => {
  const report = {
    verdict: 'pass',
    checks: { schema: 'pass', test_expect_declared: 'pending' },
  };
  const r = render(report, 'validation-report', { lang: 'zh' });
  assert.equal(r.light, 'yellow');
  assert.ok(r.text.includes('黄'));
});

// RR4 render throws on unsupported type
test('RR4 render throws on unsupported type', () => {
  assert.throws(() => render({}, 'manifest'), /not supported/);
});

// RR5 render throws on unsupported lang
test('RR5 render throws on unsupported lang', () => {
  assert.throws(() => render({}, 'validation-report', { lang: 'en' }), /not supported/);
});

// RR6 render includes fix guidance for failed checks
test('RR6 render includes fix guidance for failed checks', () => {
  const report = {
    verdict: 'fail',
    checks: { schema: 'fail', naming: 'pass' },
  };
  const r = render(report, 'validation-report', { lang: 'zh' });
  assert.ok(r.text.includes('schema'));
  assert.ok(r.text.includes('修复'));
});

// ---------- Phase 2.2: eval-report rendering ----------
// RR7 render eval-report pass → green
test('RR7 render eval-report pass verdict returns green light', () => {
  const report = {
    id: 'foo.bar',
    verdict: 'pass',
    overall: 0.85,
    axes: {
      accuracy: { score: 0.9 }, completeness: { score: 0.8 }, actionability: { score: 0.85 },
      safety: { score: 1 }, robustness: { score: 0.7 },
    },
  };
  const r = render(report, 'eval-report', { lang: 'zh' });
  assert.equal(r.light, 'green');
  assert.ok(r.text.includes('绿'));
  assert.ok(r.text.includes('0.85'), 'should include overall score');
  for (const axis of ['accuracy', 'completeness', 'actionability', 'safety', 'robustness']) {
    assert.ok(r.text.includes(axis), `should mention axis ${axis}`);
  }
});

// RR8 render eval-report fail → red
test('RR8 render eval-report fail verdict returns red light', () => {
  const report = {
    id: 'foo.bar', verdict: 'fail', overall: 0.3,
    axes: { accuracy: { score: 0.2 }, completeness: { score: 0.3 }, actionability: { score: 0.2 }, safety: { score: 0 }, robustness: { score: 0.4 } },
  };
  const r = render(report, 'eval-report', { lang: 'zh' });
  assert.equal(r.light, 'red');
  assert.ok(r.text.includes('红'));
});

// RR9 render eval-report pending → yellow
test('RR9 render eval-report pending verdict returns yellow light', () => {
  const report = {
    id: 'foo.bar', verdict: 'pending', overall: 0,
    axes: { accuracy: { score: 0 }, completeness: { score: 0 }, actionability: { score: 0 }, safety: { score: 1 }, robustness: { score: 0 } },
  };
  const r = render(report, 'eval-report', { lang: 'zh' });
  assert.equal(r.light, 'yellow');
  assert.ok(r.text.includes('黄'));
});

// ---------- F3: security-report rendering ----------

// RR_sec security-report pass → green, 0 findings
test('RR_sec security-report pass → green', () => {
  const r = render({ id: 'foo.bar', verdict: 'pass', findings: [] }, 'security-report', { lang: 'zh' });
  assert.equal(r.light, 'green');
  assert.ok(r.text.includes('绿'));
  assert.ok(r.oneLiner.includes('0'));
});

// RR_sec2 security-report block → red, lists findings + 修复指引
test('RR_sec2 security-report block → red with findings + 修复指引', () => {
  const r = render({
    id: 'foo.bar', verdict: 'block',
    findings: [
      { rule: 'hardcoded_secret', status: 'block', evidence: 'source.md:1: sk-xxx' },
      { rule: 'prompt_injection', status: 'block', evidence: 'source.md:2: ignore' },
    ],
  }, 'security-report', { lang: 'zh' });
  assert.equal(r.light, 'red');
  assert.ok(r.text.includes('红'));
  assert.ok(r.text.includes('hardcoded_secret'));
  assert.ok(r.text.includes('prompt_injection'));
  assert.ok(r.text.includes('修复'));
});

// RR_sec3 cmdReport renders security-report.json (via opsforge)
test('RR_sec3 cmdReport renders security-report.json', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-rr-'));
  fs.writeFileSync(path.join(tmp, 'security-report.json'), JSON.stringify({
    id: 'foo.bar', verdict: 'pass', findings: [],
  }));
  const { main } = await import('./opsforge.mjs');
  const origCwd = process.cwd();
  process.chdir(tmp);
  try {
    const code = await main(['report', tmp]);
    assert.equal(code, 0);
  } finally {
    process.chdir(origCwd);
  }
});
