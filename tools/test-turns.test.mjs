// tools/test-turns.test.mjs — Phase 4 Slice 2a (P1-A multi-turn) tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

import { checkTurnsWellFormed, checkTestCasesDistinct } from './validate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '..', 'schema', 'test-case.schema.json');

function loadSchema() {
  const raw = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  return { ajv, validate: ajv.compile(raw) };
}

test('TU1: schema accepts turns with role/content/post_condition', () => {
  const { validate } = loadSchema();
  const ok = {
    name: 'multi-turn-case', input: 'start', expect: 'llm_judge',
    judge_rubric: 'a'.repeat(25), expected: 'filled expected value here',
    turns: [
      { role: 'user', content: 'what is 2+2?' },
      { role: 'assistant', content: '4', post_condition: { must_contain_any: ['4'], on_fail: 'skip' } },
    ],
  };
  assert.equal(validate(ok), true);
});

test('TU2: schema rejects unknown field in turns.items (additionalProperties:false)', () => {
  const { validate } = loadSchema();
  const bad = {
    name: 'multi-turn-bad', input: 'x', expect: 'llm_judge', judge_rubric: 'a'.repeat(25),
    turns: [{ role: 'user', content: 'hi', rogue: true }],
  };
  assert.equal(validate(bad), false);
});

test('TU2b: schema rejects unknown field in post_condition', () => {
  const { validate } = loadSchema();
  const bad = {
    name: 'pc-bad', input: 'x', expect: 'llm_judge', judge_rubric: 'a'.repeat(25),
    turns: [{ role: 'user', content: 'hi', post_condition: { must_contain_any: ['x'], on_fail: 'skip', rogue: true } }],
  };
  assert.equal(validate(bad), false);
});

test('TU3: R23 checkTurnsWellFormed catches bad role / empty content / short must_contain_any', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tu3-'));
  fs.mkdirSync(path.join(tmp, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'tests', 'case-01.yaml'),
    `name: c1\ninput: hi\nexpect: llm_judge\njudge_rubric: '${'a'.repeat(25)}'\nturns:\n  - role: narrator\n    content: hi\n`);
  const cap = { dir: tmp, yaml: { kind: 'skill' }, manifestFile: 'SKILL.md' };
  const r = checkTurnsWellFormed(cap);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /turn\[0\]\.role/);
});

test('TU3b: R23 passes on well-formed turns', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tu3b-'));
  fs.mkdirSync(path.join(tmp, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'tests', 'case-01.yaml'),
    `name: c1\ninput: hi\nexpect: llm_judge\njudge_rubric: '${'a'.repeat(25)}'\nturns:\n  - role: user\n    content: hi there\n    post_condition:\n      must_contain_any: ['hello']\n      on_fail: skip\n`);
  const cap = { dir: tmp, yaml: { kind: 'skill' }, manifestFile: 'SKILL.md' };
  const r = checkTurnsWellFormed(cap);
  assert.equal(r.status, 'pass', r.detail);
});

test('TU3c: R23 catches short must_contain_any item (<3 chars)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tu3c-'));
  fs.mkdirSync(path.join(tmp, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'tests', 'case-01.yaml'),
    `name: c1\ninput: hi\nexpect: llm_judge\njudge_rubric: '${'a'.repeat(25)}'\nturns:\n  - role: user\n    content: hi\n    post_condition:\n      must_contain_any: ['ab']\n      on_fail: skip\n`);
  const cap = { dir: tmp, yaml: { kind: 'skill' }, manifestFile: 'SKILL.md' };
  const r = checkTurnsWellFormed(cap);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /must_contain_any item <3/);
});

test('TU4: R19 distinct key includes turns — same input/expect/expected but different turns → distinct', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tu4-'));
  fs.mkdirSync(path.join(tmp, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'tests', 'case-01.yaml'),
    `name: c1\ninput: hi\nexpect: exact\nexpected: 'abcd'\nturns:\n  - role: user\n    content: q1\n`);
  fs.writeFileSync(path.join(tmp, 'tests', 'case-02.yaml'),
    `name: c2\ninput: hi\nexpect: exact\nexpected: 'abcd'\nturns:\n  - role: user\n    content: q2\n`);
  const cap = { dir: tmp, yaml: { kind: 'skill' }, manifestFile: 'SKILL.md' };
  const r = checkTestCasesDistinct(cap);
  assert.equal(r.status, 'pass', 'different turns → distinct');
});

test('TU4b: R19 distinct key — identical turns too → fail', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tu4b-'));
  fs.mkdirSync(path.join(tmp, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'tests', 'case-01.yaml'),
    `name: c1\ninput: hi\nexpect: exact\nexpected: 'abcd'\nturns:\n  - role: user\n    content: q1\n`);
  fs.writeFileSync(path.join(tmp, 'tests', 'case-02.yaml'),
    `name: c2\ninput: hi\nexpect: exact\nexpected: 'abcd'\nturns:\n  - role: user\n    content: q1\n`);
  const cap = { dir: tmp, yaml: { kind: 'skill' }, manifestFile: 'SKILL.md' };
  const r = checkTestCasesDistinct(cap);
  assert.equal(r.status, 'fail');
});

test('TU5: executeMultiTurnDryRun exists and is callable (mock spawn injected)', async () => {
  // We import the runner with a stub spawn that simulates a stream-json assistant
  // reply, asserting the multi-turn dispatch path is reachable.
  const { executeMultiTurnDryRun } = await import('./test-runner.mjs');
  assert.equal(typeof executeMultiTurnDryRun, 'function');
  // Build a fake cap dir with a SKILL.md entrypoint.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tu5-'));
  fs.writeFileSync(path.join(tmp, 'SKILL.md'),
    `---\nid: mkt.multi\ntitle: t\nkind: skill\nentrypoint: SKILL.md\n---\nbody`);
  const caseYaml = {
    turns: [
      { role: 'user', content: 'hi there what is 2+2?' },
    ],
    timeout_ms: 1000,
  };
  // Inject mock spawn via _setSpawn.
  const mod = await import('./test-runner.mjs');
  const listeners = { stdout: [], stderr: [], error: [], close: [] };
  const stdinBuf = { write() { return true; }, end() {} };
  const fakeSpawn = () => ({
    stdin: stdinBuf,
    stdout: { on: (ev, fn) => ev === 'data' && listeners.stdout.push(fn) },
    stderr: { on: (ev, fn) => ev === 'data' && listeners.stderr.push(fn) },
    on: (ev, fn) => { listeners[ev] && listeners[ev].push(fn); },
    kill() {},
  });
  // Phase 4 fix (#3): restore spawn in finally so a rejection cannot leak the stub.
  mod._setSpawn(fakeSpawn);
  try {
    const p = executeMultiTurnDryRun(tmp, caseYaml, {});
    // Emit a result message after a microtask.
    queueMicrotask(() => {
      const resultMsg = JSON.stringify({ type: 'result', subtype: 'success' }) + '\n';
      const asstMsg = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '4' }] } }) + '\n';
      listeners.stdout.forEach((fn) => fn(Buffer.from(asstMsg)));
      listeners.stdout.forEach((fn) => fn(Buffer.from(resultMsg)));
    });
    // Emit close.
    queueMicrotask(() => listeners.close.forEach((fn) => fn(0)));
    const actual = await p;
    assert.equal(actual, '4');
  } finally {
    if (typeof mod._setSpawn === 'function') mod._setSpawn(null);
  }
});

// Phase 4 fix (#1) regression tests: assistant-turn post_condition must be
// evaluated against the response to the PRECEDING user turn (no false pass).

/** Build a fake spawn that emits one assistant text + result per user turn. */
function buildFakeSpawn(responses) {
  const listeners = { stdout: [], stderr: [], error: [], close: [] };
  let callCount = 0;
  const stdinBuf = {
    write() {
      const text = responses[callCount] ?? 'default';
      callCount++;
      // Emit assistant message + result message asynchronously.
      queueMicrotask(() => {
        const asstMsg = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }) + '\n';
        const resultMsg = JSON.stringify({ type: 'result', subtype: 'success' }) + '\n';
        listeners.stdout.forEach((fn) => fn(Buffer.from(asstMsg)));
        listeners.stdout.forEach((fn) => fn(Buffer.from(resultMsg)));
      });
      return true;
    },
    end() {
      queueMicrotask(() => listeners.close.forEach((fn) => fn(0)));
    },
  };
  const fakeSpawn = () => ({
    stdin: stdinBuf,
    stdout: { on: (ev, fn) => ev === 'data' && listeners.stdout.push(fn) },
    stderr: { on: (ev, fn) => ev === 'data' && listeners.stderr.push(fn) },
    on: (ev, fn) => { listeners[ev] && listeners[ev].push(fn); },
    kill() {},
  });
  return { fakeSpawn, listeners };
}

function makeCapDir(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(tmp, 'SKILL.md'),
    `---\nid: mkt.multi\ntitle: t\nkind: skill\nentrypoint: SKILL.md\n---\nbody`);
  return tmp;
}

test('TU7: assistant-turn post_condition hit → pass (pc is now evaluated, #1)', async () => {
  const mod = await import('./test-runner.mjs');
  const { executeMultiTurnDryRun } = mod;
  const capDir = makeCapDir('tu7-');
  // turns: [user0, assistant0(pc must_contain '4')] — assistant0 pc targets
  // the response to user0.
  const caseYaml = {
    turns: [
      { role: 'user', content: 'what is 2+2?' },
      { role: 'assistant', content: '', post_condition: { must_contain_any: ['4'], on_fail: 'fail' } },
    ],
    timeout_ms: 1000,
  };
  const { fakeSpawn } = buildFakeSpawn(['the answer is 4']);
  mod._setSpawn(fakeSpawn);
  try {
    const actual = await executeMultiTurnDryRun(capDir, caseYaml, {});
    assert.equal(actual, 'the answer is 4');
  } finally {
    if (typeof mod._setSpawn === 'function') mod._setSpawn(null);
  }
});

test('TU8: assistant-turn post_condition miss + on_fail:fail → case fails (no false pass, #1)', async () => {
  const mod = await import('./test-runner.mjs');
  const { executeMultiTurnDryRun } = mod;
  const capDir = makeCapDir('tu8-');
  const caseYaml = {
    turns: [
      { role: 'user', content: 'what is 2+2?' },
      { role: 'assistant', content: '', post_condition: { must_contain_any: ['42'], on_fail: 'fail' } },
    ],
    timeout_ms: 1000,
  };
  const { fakeSpawn } = buildFakeSpawn(['the answer is 4']);
  mod._setSpawn(fakeSpawn);
  try {
    await assert.rejects(
      executeMultiTurnDryRun(capDir, caseYaml, {}),
      (err) => /post_condition fail at turn 1/.test(err.message),
    );
  } finally {
    if (typeof mod._setSpawn === 'function') mod._setSpawn(null);
  }
});

test('TU9: multi-turn indexing — assistant1 pc targets user1 response, not user0 (#1)', async () => {
  const mod = await import('./test-runner.mjs');
  const { executeMultiTurnDryRun } = mod;
  const capDir = makeCapDir('tu9-');
  // turns: [user0, assistant0(pc 'apple' hit), user1, assistant1(pc 'banana' miss → fail)]
  // assistant0 pc must be evaluated against user0's response ('apple'),
  // assistant1 pc must be evaluated against user1's response ('cherry') → miss → fail.
  const caseYaml = {
    turns: [
      { role: 'user', content: 'say apple' },
      { role: 'assistant', content: '', post_condition: { must_contain_any: ['apple'], on_fail: 'fail' } },
      { role: 'user', content: 'say banana' },
      { role: 'assistant', content: '', post_condition: { must_contain_any: ['banana'], on_fail: 'fail' } },
    ],
    timeout_ms: 1000,
  };
  // user0 response = 'apple' (assistant0 pc hits), user1 response = 'cherry' (assistant1 pc misses).
  const { fakeSpawn } = buildFakeSpawn(['apple', 'cherry']);
  mod._setSpawn(fakeSpawn);
  try {
    await assert.rejects(
      executeMultiTurnDryRun(capDir, caseYaml, {}),
      (err) => /post_condition fail at turn 3/.test(err.message),
    );
  } finally {
    if (typeof mod._setSpawn === 'function') mod._setSpawn(null);
  }
});

test('TU6: dogfood caps without turns still pass validateDir (no R23 breakage)', () => {
  // The 7 dogfood caps have no turns → R23 should pass trivially. We just
  // verify checkTurnsWellFormed on a no-turns case passes.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tu6-'));
  fs.mkdirSync(path.join(tmp, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'tests', 'case-01.yaml'),
    `name: c1\ninput: hi\nexpect: exact\nexpected: 'abcd'\n`);
  const cap = { dir: tmp, yaml: { kind: 'skill' }, manifestFile: 'SKILL.md' };
  const r = checkTurnsWellFormed(cap);
  assert.equal(r.status, 'pass');
});
