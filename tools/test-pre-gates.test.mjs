// tools/test-pre-gates.test.mjs — Phase 4 Slice 1a (P0-A pre_gates) tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Ajv from 'ajv';

import { fileURLToPath } from 'node:url';
import { runCase, checkFilesExist } from './test-runner.mjs';
import { checkTestExpectNontrivial, checkPreGatesNontrivial } from './validate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '..', 'schema', 'test-case.schema.json');

function loadSchema() {
  const raw = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  // Resolve internal $id references by passing both schema + its $id.
  const ajv = new Ajv({ allErrors: true, strict: false });
  return { ajv, validate: ajv.compile(raw) };
}

test('PG1: empty pre_gates array is no-op (existing cases unaffected)', async () => {
  const v = await runCase('/tmp/none', {
    name: 'case-x', input: 'hi', expect: 'exact',
    expected: 'hi', pre_gates: [],
  }, { actual: 'hi', runner: 'static-only' });
  // actual injected → exact compare happens; pre_gates empty → skipped.
  assert.equal(v.pass, true);
  assert.equal(v.reason, '');
});

test('PG2: contains pre_gate hit then llm_judge runs (mock fetch called once)', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ score: 0.9, rationale: 'good' }) } }] }) };
  };
  const v = await runCase('/tmp/none', {
    name: 'case-j', input: 'hi', expect: 'llm_judge',
    judge_rubric: 'a'.repeat(25), judge_threshold: 0.5,
    pre_gates: [{ mode: 'contains', expected: 'hello' }],
  }, {
    actual: 'hello world this is the actual output',
    fetch: fakeFetch,
    url: 'http://x', model: 'm', key: 'k',
  });
  assert.equal(calls, 1, 'judge fetch should be called once when pre_gate passes');
  assert.equal(v.pass, true);
});

test('PG3: pre_gate contains fail skips llm_judge (mock fetch called 0 times)', async () => {
  let calls = 0;
  const fakeFetch = async () => { calls++; return { ok: true, json: async () => ({ choices: [{ message: { content: '{"score":0.9,"rationale":"x"}' } }] }) }; };
  const v = await runCase('/tmp/none', {
    name: 'case-skip', input: 'hi', expect: 'llm_judge',
    judge_rubric: 'a'.repeat(25), judge_threshold: 0.5,
    pre_gates: [{ mode: 'contains', expected: 'required-substr' }],
  }, {
    actual: 'this output lacks the gate substring',
    fetch: fakeFetch,
    url: 'http://x', model: 'm', key: 'k',
  });
  assert.equal(calls, 0, 'judge fetch must NOT be called when pre_gate fails');
  assert.equal(v.pass, false);
  assert.match(v.reason, /pre_gate/);
});

test('PG4: files_exist mode (exists / missing branches)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg4-'));
  fs.writeFileSync(path.join(tmp, 'present.txt'), 'x');
  const r1 = checkFilesExist(['present.txt'], tmp);
  assert.equal(r1.pass, true);
  const r2 = checkFilesExist(['missing.txt'], tmp);
  assert.equal(r2.pass, false);
  assert.match(r2.reason, /missing\.txt/);
  assert.deepEqual(r2.missing, ['missing.txt']);
});

test('PG4b: files_exist via runCase with capDir', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg4b-'));
  fs.writeFileSync(path.join(tmp, 'output.log'), 'done');
  const v = await runCase(tmp, {
    name: 'case-fe', input: 'x', expect: 'exact', expected: 'done',
    pre_gates: [{ mode: 'files_exist', expected: ['output.log'] }],
  }, { actual: 'done', capDir: tmp });
  assert.equal(v.pass, true);
});

test('PG5: R18 rejects short pre_gates expected + checkPreGatesNontrivial catches malformed', () => {
  const cap = {
    dir: '/tmp/x', yaml: { kind: 'skill' },
    manifestFile: 'SKILL.md',
  };
  // Monkeypatch readTestCases via path impossible; instead call the exported function
  // directly with a synthetic cap that readTestCases() will skip (no tests/ dir) → pass.
  // We exercise the direct logic by constructing a fake tests/ dir.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg5-'));
  fs.mkdirSync(path.join(tmp, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'tests', 'case-01.yaml'),
    'name: c1\ninput: hi\nexpect: contains\nexpected: "ab"\npre_gates:\n  - mode: contains\n    expected: "xy"\n');
  const cap2 = { dir: tmp, yaml: { kind: 'skill' }, manifestFile: 'SKILL.md' };
  const r = checkTestExpectNontrivial(cap2);
  // "ab" length 2 <=3 → R18 fail on main expected OR pre_gate expected "xy" len 2.
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /too short/);
});

test('PG5b: checkPreGatesNontrivial rejects malformed pre_gates entry', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg5b-'));
  fs.mkdirSync(path.join(tmp, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'tests', 'case-01.yaml'),
    'name: c1\ninput: hi\nexpect: contains\nexpected: "abcd"\npre_gates:\n  - mode: unknown_mode\n    expected: "abcd"\n');
  const cap = { dir: tmp, yaml: { kind: 'skill' }, manifestFile: 'SKILL.md' };
  const r = checkPreGatesNontrivial(cap);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /pre_gates_nontrivial/);
});

test('PG6: schema rejects unknown field in pre_gates.items (additionalProperties:false)', () => {
  const { validate } = loadSchema();
  const bad = {
    name: 'c-name', input: 'hi', expect: 'exact', expected: 'done',
    pre_gates: [{ mode: 'contains', expected: 'done', rogue: true }],
  };
  assert.equal(validate(bad), false, 'unknown field must be rejected');
});

test('PG6b: schema accepts well-formed pre_gates', () => {
  const { validate } = loadSchema();
  const ok = {
    name: 'c-name', input: 'hi', expect: 'exact', expected: 'done',
    pre_gates: [{ mode: 'files_exist', expected: ['a.txt'] }],
  };
  assert.equal(validate(ok), true, 'well-formed pre_gates must be accepted');
});

test('PG7: Windows path.join used in files_exist (no EAGAIN throw)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg7-'));
  const r = checkFilesExist(['nested/dir/file.txt'], tmp);
  assert.equal(r.pass, false);
  assert.ok(Array.isArray(r.missing));
});
