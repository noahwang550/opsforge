// tools/test-check-mode.test.mjs — Phase 4 Slice 2b (P1-B expect=check) tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

import { compareCheck, runCase, SUPPORTED_MODES } from './test-runner.mjs';
import { checkTestExpectNontrivial } from './validate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '..', 'schema', 'test-case.schema.json');

function loadSchema() {
  const raw = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  return { ajv, validate: ajv.compile(raw) };
}

test('CK0: SUPPORTED_MODES includes check', () => {
  assert.ok(SUPPORTED_MODES.has('check'));
});

test('CK1: compareCheck tool_called hit (transcript contains "name":"grep")', () => {
  const transcript = `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"grep","input":{"pattern":"foo"}}]}}`;
  const r = compareCheck(transcript, { tool_called: { name: 'grep' } });
  assert.equal(r.pass, true);
});

test('CK1b: compareCheck tool_called miss (no "name":"grep" in transcript)', () => {
  const transcript = 'plain text response without any tool call';
  const r = compareCheck(transcript, { tool_called: { name: 'grep' } });
  assert.equal(r.pass, false);
  assert.match(r.reason, /tool_called.*not found/);
});

test('CK2: compareCheck tool_called args text-contains miss', () => {
  const transcript = `{"name":"grep","input":{"pattern":"bar"}}`;
  const r = compareCheck(transcript, { tool_called: { name: 'grep', args: { pattern: 'foo' } } });
  assert.equal(r.pass, false);
  assert.match(r.reason, /args mismatch/);
});

test('CK3: compareCheck files_exist / files_not_exist (temp dir)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ck3-'));
  fs.writeFileSync(path.join(tmp, 'present.txt'), 'x');
  const r1 = compareCheck('', { files_exist: ['present.txt'] }, { capDir: tmp });
  assert.equal(r1.pass, true);
  const r2 = compareCheck('', { files_exist: ['missing.txt'] }, { capDir: tmp });
  assert.equal(r2.pass, false);
  const r3 = compareCheck('', { files_not_exist: ['no-such.txt'] }, { capDir: tmp });
  assert.equal(r3.pass, true);
  const r4 = compareCheck('', { files_not_exist: ['present.txt'] }, { capDir: tmp });
  assert.equal(r4.pass, false);
});

test('CK4: compareCheck must_contain / must_not_contain', () => {
  const transcript = 'the quick brown fox jumps over the lazy dog';
  const r1 = compareCheck(transcript, { must_contain: ['quick', 'fox'] });
  assert.equal(r1.pass, true);
  const r2 = compareCheck(transcript, { must_contain: ['cat'] });
  assert.equal(r2.pass, false);
  const r3 = compareCheck(transcript, { must_not_contain: ['cat'] });
  assert.equal(r3.pass, true);
  const r4 = compareCheck(transcript, { must_not_contain: ['fox'] });
  assert.equal(r4.pass, false);
});

test('CK4b: compareCheck rejects non-object expected', () => {
  const r = compareCheck('', 'not-an-object');
  assert.equal(r.pass, false);
  assert.match(r.reason, /expected must be object/);
});

test('CK4c: compareCheck rejects tool_called without name', () => {
  const r = compareCheck('', { tool_called: {} });
  assert.equal(r.pass, false);
  assert.match(r.reason, /tool_called\.name required/);
});

test('CK5: R18 expect=check requires expected to be a non-empty object', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ck5-'));
  fs.mkdirSync(path.join(tmp, 'tests'), { recursive: true });
  // Bad: expected is null
  fs.writeFileSync(path.join(tmp, 'tests', 'case-01.yaml'),
    `name: c1\ninput: hi\nexpect: check\nexpected: null\n`);
  const cap = { dir: tmp, yaml: { kind: 'skill' }, manifestFile: 'SKILL.md' };
  const r = checkTestExpectNontrivial(cap);
  assert.equal(r.status, 'fail');
});

test('CK5b: R18 expect=check with well-formed expected object passes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ck5b-'));
  fs.mkdirSync(path.join(tmp, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'tests', 'case-01.yaml'),
    `name: c1\ninput: hi\nexpect: check\nexpected:\n  must_contain: ['hello']\n`);
  const cap = { dir: tmp, yaml: { kind: 'skill' }, manifestFile: 'SKILL.md' };
  const r = checkTestExpectNontrivial(cap);
  assert.equal(r.status, 'pass', r.detail);
});

test('CK6: schema accepts expect=check', () => {
  const { validate } = loadSchema();
  const ok = {
    name: 'check-case', input: 'x', expect: 'check',
    expected: { must_contain: ['hello world response'] },
  };
  assert.equal(validate(ok), true);
});

test('CK7: runCase expect=check with injected actual (tool_called hit)', async () => {
  const transcript = `{"name":"search","input":{"q":"x"}}`;
  const v = await runCase('/tmp/x', {
    name: 'check-case', input: 'x', expect: 'check',
    expected: { tool_called: { name: 'search' } },
  }, { actual: transcript });
  assert.equal(v.pass, true);
});
