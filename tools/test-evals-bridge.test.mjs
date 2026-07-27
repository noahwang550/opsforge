// tools/test-evals-bridge.test.mjs — Phase 4 Slice 2c (P1-C evals.json bridge) tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';

import {
  exportCase,
  importCase,
  exportToEvalsJson,
  importFromEvalsJson,
} from './evals-bridge.mjs';

test('EB1: exportCase maps 7 OpsForge fields to evals.json shape (comparator table)', () => {
  const c = {
    name: 'c1', input: 'hello there', expect: 'contains', expected: 'hello',
    judge_rubric: 'must say hello', judge_threshold: 0.8, weight: 1.5,
    schema_ref: null, pre_gates: [], turns: [],
  };
  const e = exportCase(c);
  assert.equal(e.case_id, 'c1');
  assert.equal(e.user_message, 'hello there');
  assert.equal(e.expected_comparator, 'contains_all');
  assert.equal(e.expected_value, 'hello');
  assert.equal(e.rubric, 'must say hello');
  assert.equal(e.pass_threshold, 0.8);
  assert.equal(e.metadata.opsforge.weight, 1.5);
});

test('EB1b: exportCase maps llm_judge → judge comparator', () => {
  const e = exportCase({ name: 'c', input: 'i', expect: 'llm_judge', expected: 'x' });
  assert.equal(e.expected_comparator, 'judge');
});

test('EB1c: exportCase includes preconditions when pre_gates non-empty', () => {
  const e = exportCase({
    name: 'c', input: 'i', expect: 'exact', expected: 'x',
    pre_gates: [{ mode: 'contains', expected: 'hello' }],
  });
  assert.ok(Array.isArray(e.preconditions));
  assert.equal(e.preconditions[0].type, 'contains');
});

test('EB1d: exportCase includes turns when non-empty', () => {
  const e = exportCase({
    name: 'c', input: 'i', expect: 'exact', expected: 'x',
    turns: [{ role: 'user', content: 'q1' }],
  });
  assert.ok(Array.isArray(e.turns));
  assert.equal(e.turns[0].role, 'user');
  assert.equal(e.turns[0].content, 'q1');
});

test('EB2: importCase missing expected_value → __FILL_ME__ + untrusted delimiter on input (#6)', () => {
  const c = importCase({ case_id: 'ic1', user_message: 'hi', expected_comparator: 'equals' });
  assert.equal(c.name, 'ic1');
  // Phase 4 fix (#6): untrusted external text wrapped in explicit delimiters.
  assert.equal(c.input, '<UNTRUSTED_IMPORT>hi</UNTRUSTED_IMPORT>');
  assert.equal(c.expected, '__FILL_ME__');
  assert.equal(c.judge_rubric, '__FILL_ME__');
  assert.equal(c.judge_threshold, 0.7);
});

test('EB2b: importCase unknown comparator → llm_judge fallback', () => {
  const c = importCase({ case_id: 'ic2', user_message: 'hi', expected_comparator: 'weird', expected_value: 'filled' });
  assert.equal(c.expect, 'llm_judge');
  assert.equal(c.expected, 'filled');
});

test('EB3: round-trip export → import preserves weight/timeout_ms/platforms via metadata.opsforge', () => {
  const original = {
    name: 'rt', input: 'hello', expect: 'exact', expected: 'hello there',
    weight: 2.0, timeout_ms: 5000, platforms: ['claude-code', 'cursor'],
  };
  const exported = exportCase(original);
  const reimported = importCase(exported);
  assert.equal(reimported.weight, 2.0);
  assert.equal(reimported.timeout_ms, 5000);
  assert.deepEqual(reimported.platforms, ['claude-code', 'cursor']);
  assert.equal(reimported.expect, 'exact');
  assert.equal(reimported.expected, 'hello there');
});

test('EB4: exportToEvalsJson reads <capDir>/tests/*.yaml → evals.json', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eb4-'));
  const testsDir = path.join(tmp, 'tests');
  fs.mkdirSync(testsDir, { recursive: true });
  fs.writeFileSync(path.join(testsDir, 'case-01.yaml'), yaml.dump({
    name: 'c1', input: 'q1', expect: 'exact', expected: 'a1',
  }));
  fs.writeFileSync(path.join(testsDir, 'case-02.yaml'), yaml.dump({
    name: 'c2', input: 'q2', expect: 'contains', expected: 'a2',
  }));
  const ev = exportToEvalsJson(tmp);
  assert.equal(ev.schema_version, 'v1alpha1');
  assert.equal(ev.cases.length, 2);
  assert.equal(ev.cases[0].case_id, 'c1');
  assert.equal(ev.cases[1].case_id, 'c2');
});

test('EB5: importFromEvalsJson writes drafts to <draftsDir>/tests/case-NN.yaml + __FILL_ME__ for missing fields', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eb5-'));
  const evalsJson = {
    schema_version: 'v1alpha1',
    cases: [
      { case_id: 'ic1', user_message: 'hello', expected_comparator: 'equals', expected_value: 'hi' },
      { case_id: 'ic2', user_message: 'world', expected_comparator: 'judge' },
    ],
  };
  const { written, skipped } = importFromEvalsJson(evalsJson, { draftsDir: tmp });
  assert.equal(written.length, 2);
  assert.equal(skipped, 0);
  // first case has expected_value 'hi' → imported expected 'hi'
  const c1 = yaml.load(fs.readFileSync(written[0], 'utf8'));
  assert.equal(c1.expected, 'hi');
  // second has no expected_value → __FILL_ME__
  const c2 = yaml.load(fs.readFileSync(written[1], 'utf8'));
  assert.equal(c2.expected, '__FILL_ME__');
});

test('EB5b: importFromEvalsJson throws without opts.draftsDir', () => {
  assert.throws(() => importFromEvalsJson({ cases: [] }));
});

test('EB5c: importFromEvalsJson handles bare array input shape', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eb5c-'));
  const arr = [{ case_id: 'a1', user_message: 'q', expected_comparator: 'equals', expected_value: 'r' }];
  const { written } = importFromEvalsJson(arr, { draftsDir: tmp });
  assert.equal(written.length, 1);
});
