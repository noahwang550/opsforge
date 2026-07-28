// tools/validate-r27-run-instruction.test.mjs — methodology R27.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkRunInstructionPresent } from './validate.mjs';

function mkDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'r27-')); }
function w(p, c) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); }

test('R27 fail: 运行指令 < 80 tokens', () => {
  const dir = mkDir();
  w(path.join(dir, 'source.md'), `---\nid: a.b\nkind: skill\n---\n## 运行指令\nshort text here`);
  const r = checkRunInstructionPresent({ dir, yaml: { kind: 'skill', entrypoint: 'source.md' } });
  assert.equal(r.status, 'fail');
});

test('R27 pass: 运行指令 ≥ 80 tokens', () => {
  const dir = mkDir();
  const long = 'You are a test capability. When invoked, receive the input data from the configured source path without pasting raw values, validate it against the schema, aggregate the performance indicators, decide the output format based on the configured rules, generate the structured report with key findings trends and recommendations, identify outliers and notable patterns, and present the results in a clear format suitable for stakeholders. Support multiple report formats including executive summaries and detailed breakdowns. Handle edge cases and boundary conditions gracefully with degradation. Never fabricate data; when a data source is unavailable, degrade to an empty report with an alert rather than crashing. All generated content passes a quality checkpoint before delivery. Maintain consistency across invocations and reuse style memory where applicable.';
  w(path.join(dir, 'source.md'), `---\nid: a.b\nkind: skill\n---\n## 运行指令\n${long}`);
  const r = checkRunInstructionPresent({ dir, yaml: { kind: 'skill', entrypoint: 'source.md' } });
  assert.equal(r.status, 'pass');
});

test('R27 n/a for workflow', () => {
  const r = checkRunInstructionPresent({ dir: '/x', yaml: { kind: 'workflow' } });
  assert.equal(r.status, 'n/a');
});
