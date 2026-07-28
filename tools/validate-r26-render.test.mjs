// tools/validate-r26-render.test.mjs — BUG-2: single-cap console tag must render
// WARN for soft-warn rules and N/A for non-applicable rules, not FAIL. The verdict
// (pass|fail) is correct in validation-report.json; only the console display was a lie.
// End-to-end: spawn validate.mjs on the capability-interviewer dogfood cap, which
// produces a real WARN (R26 soft-miss) and N/A (workflow_ref for non-workflow kind).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VALIDATE = fileURLToPath(new URL('./validate.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAP = fileURLToPath(new URL('../packs/opsforge-meta/agents/capability-interviewer', import.meta.url));

function runValidate() {
  return spawnSync(process.execPath, [VALIDATE, CAP], { encoding: 'utf8', cwd: ROOT });
}

test('BUG-2: single-cap validate renders WARN for soft-warn (not FAIL)', () => {
  const r = runValidate();
  assert.equal(r.status, 0, 'interviewer cap should pass verdict');
  assert.ok(r.stdout.includes('WARN  test_four_quadrants'), 'warn rule must render WARN');
  assert.ok(!r.stdout.includes('FAIL  test_four_quadrants'), 'warn rule must NOT render FAIL');
});

test('BUG-2: single-cap validate renders N/A for non-applicable rule (not FAIL)', () => {
  const r = runValidate();
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('N/A  workflow_ref'), 'n/a rule must render N/A');
  assert.ok(!r.stdout.includes('FAIL  workflow_ref'), 'n/a rule must NOT render FAIL');
});
