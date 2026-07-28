// tools/schema-contracts.test.mjs — Phase 1.1: schema + template contract tests (SC1–SC12).
// 验证所有新 schema additionalProperties:false、接受合法骨架、拒绝未知字段。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.resolve(__dirname, '..', 'schema');
const TEMPLATES_DIR = path.resolve(__dirname, '..', 'templates');

function loadSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, name), 'utf8'));
}

function makeValidator(schema) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

// ---------- SC1 test-case.schema rejects unknown field ----------
test('SC1 test-case.schema rejects unknown field', () => {
  const v = makeValidator(loadSchema('test-case.schema.json'));
  const valid = {
    name: 'case-one', input: { a: 1 }, expect: 'exact', expected: 'result',
    schema_ref: null, judge_rubric: null, judge_threshold: 0.7, weight: 1.0,
  };
  assert.ok(v(valid), JSON.stringify(v.errors));
  const bad = { ...valid, bogus: 1 };
  assert.ok(!v(bad));
  assert.ok(v.errors.some((e) => e.keyword === 'additionalProperties'));
});

// ---------- SC2 test-case.schema accepts minimal (name+input+expect) ----------
test('SC2 test-case.schema accepts minimal 3 required fields', () => {
  const v = makeValidator(loadSchema('test-case.schema.json'));
  assert.ok(v({ name: 'case-one', input: 'x', expect: 'human' }));
});

// ---------- SC3 test-case.schema rejects bad expect enum ----------
test('SC3 test-case.schema rejects bad expect enum', () => {
  const v = makeValidator(loadSchema('test-case.schema.json'));
  assert.ok(!v({ name: 'case-one', input: 'x', expect: 'bogus' }));
});

// ---------- SC4 platform.schema accepts valid 9-point yaml ----------
test('SC4 platform.schema accepts valid 9-point yaml', () => {
  const v = makeValidator(loadSchema('platform.schema.json'));
  const fixture = {
    platform: 'claude-code',
    display_name: 'Claude Code',
    display_name_zh: 'Claude Code',
    capability_points: {
      prompt_exec: { supported: true },
      agent_file: { supported: true },
      skill_file: { supported: true },
      slash_command: { supported: true },
      mcp_config: { supported: true },
      workflow_orchestration: { supported: true },
      config_dir_writable: { supported: true },
      kb_mount: { supported: true },
      feedback_hook: { supported: true },
    },
    locale: 'en-US',
    compliance_tags: [],
    verified_by: 'steering',
  };
  assert.ok(v(fixture), JSON.stringify(v.errors));
});

// ---------- SC5 platform.schema rejects missing capability point ----------
test('SC5 platform.schema rejects missing capability point', () => {
  const v = makeValidator(loadSchema('platform.schema.json'));
  const fixture = {
    platform: 'claude-code',
    display_name: 'Claude Code',
    display_name_zh: 'Claude Code',
    capability_points: {
      prompt_exec: { supported: true },
    },
    locale: 'en-US',
    compliance_tags: [],
  };
  assert.ok(!v(fixture));
});

// ---------- SC6 platform.schema rejects unknown capability point ----------
test('SC6 platform.schema rejects unknown capability point', () => {
  const v = makeValidator(loadSchema('platform.schema.json'));
  const fixture = {
    platform: 'claude-code',
    display_name: 'X', display_name_zh: 'X',
    capability_points: {
      prompt_exec: { supported: true },
      agent_file: { supported: true },
      skill_file: { supported: true },
      slash_command: { supported: true },
      mcp_config: { supported: true },
      workflow_orchestration: { supported: true },
      config_dir_writable: { supported: true },
      kb_mount: { supported: true },
      feedback_hook: { supported: true },
      bogus_point: { supported: true },
    },
    locale: 'en-US', compliance_tags: [],
  };
  assert.ok(!v(fixture));
});

// ---------- SC7 workflow.schema rejects loop/switch/checkpoint in control_flow ----------
test('SC7 workflow.schema rejects non-sequence control_flow node', () => {
  const v = makeValidator(loadSchema('workflow.schema.json'));
  const base = {
    id: 'foo.bar', version: '0.1.0', kind: 'workflow', pack: 'foo', owner: 'foo',
    display_name: 'B', display_name_zh: 'B', display_name_en: 'B',
    description: 'desc', platforms: ['claude-code'],
    params_schema: 'params.schema.json',
    steps: [{ id: 's1', capability: 'foo.baz', inputs: {}, outputs: [] }],
    tests: 'tests/', changelog: 'CHANGELOG.md',
    source: { origin: 'original', upstream_ref: null },
  };
  assert.ok(v(base), JSON.stringify(v.errors));
  // sequence allowed
  assert.ok(v({ ...base, control_flow: [{ type: 'sequence' }] }));
  // loop rejected
  assert.ok(!v({ ...base, control_flow: [{ type: 'loop' }] }));
  // switch rejected
  assert.ok(!v({ ...base, control_flow: [{ type: 'switch' }] }));
  // checkpoint rejected
  assert.ok(!v({ ...base, control_flow: [{ type: 'checkpoint' }] }));
});

// ---------- SC8 workflow.schema rejects unknown field ----------
test('SC8 workflow.schema rejects unknown field', () => {
  const v = makeValidator(loadSchema('workflow.schema.json'));
  const base = {
    id: 'foo.bar', version: '0.1.0', kind: 'workflow', pack: 'foo', owner: 'foo',
    display_name: 'B', display_name_zh: 'B', display_name_en: 'B',
    description: 'desc', platforms: ['claude-code'],
    params_schema: 'params.schema.json',
    steps: [{ id: 's1', capability: 'foo.baz', inputs: {}, outputs: [] }],
    tests: 'tests/', changelog: 'CHANGELOG.md',
    source: { origin: 'original', upstream_ref: null },
  };
  assert.ok(!v({ ...base, bogus: 1 }));
});

// ---------- SC9 bundle.schema accepts valid + rejects unknown ----------
test('SC9 bundle.schema accepts valid and rejects unknown', () => {
  const v = makeValidator(loadSchema('bundle.schema.json'));
  const valid = {
    id: 'foo.bar', version: '0.1.0', kind: 'bundle', pack: 'foo', owner: 'foo',
    display_name: 'B', display_name_zh: 'B', display_name_en: 'B',
    description: 'desc', platforms: ['claude-code'],
    capabilities: ['foo.baz@^1.0.0'],
    tests: 'tests/', changelog: 'CHANGELOG.md',
    source: { origin: 'original', upstream_ref: null },
  };
  assert.ok(v(valid), JSON.stringify(v.errors));
  assert.ok(!v({ ...valid, bogus: 1 }));
});

// ---------- SC10 pack/brand/upstream-ref schemas reject unknown ----------
test('SC10 pack/brand/upstream-ref schemas reject unknown fields', () => {
  const pack = makeValidator(loadSchema('pack.schema.json'));
  assert.ok(pack({ pack: 'foo', display_name: 'F', display_name_zh: 'F', display_name_en: 'F', owner: 'foo', created_at: '2026-01-01' }));
  assert.ok(!pack({ pack: 'foo', display_name: 'F', display_name_zh: 'F', display_name_en: 'F', owner: 'foo', created_at: '2026-01-01', bogus: 1 }));

  const brand = makeValidator(loadSchema('brand.schema.json'));
  assert.ok(brand({ brand_slug: 'acme', display_name: 'A', display_name_zh: 'A', created_at: '2026-01-01', contact: 'c@x.com' }));
  assert.ok(!brand({ brand_slug: 'acme', display_name: 'A', display_name_zh: 'A', created_at: '2026-01-01', contact: 'c@x.com', bogus: 1 }));

  const upstream = makeValidator(loadSchema('upstream-ref.schema.json'));
  assert.ok(upstream({ repo: 'r', commit: 'c', license: 'MIT', intaked_at: '2026-01-01', intaked_by: 'foo', commercial: false, intake_scope: 'full' }));
  assert.ok(!upstream({ repo: 'r', commit: 'c', license: 'MIT', intaked_at: '2026-01-01', intaked_by: 'foo', commercial: false, intake_scope: 'full', bogus: 1 }));
  // commercial:true requires commercial_reason
  assert.ok(!upstream({ repo: 'r', commit: 'c', license: 'MIT', intaked_at: '2026-01-01', intaked_by: 'foo', commercial: true, intake_scope: 'full' }));
  assert.ok(upstream({ repo: 'r', commit: 'c', license: 'MIT', intaked_at: '2026-01-01', intaked_by: 'foo', commercial: true, commercial_reason: 'paid license on file', intake_scope: 'partial' }));
});

// ---------- SC11 capability.schema accepts optional requires ----------
test('SC11 capability.schema accepts optional requires field', () => {
  const v = makeValidator(loadSchema('capability.schema.json'));
  const base = {
    id: 'foo.bar', version: '0.1.0', kind: 'agent', pack: 'foo', owner: 'foo',
    display_name: 'B', display_name_zh: 'B', display_name_en: 'B',
    description: 'desc', platforms: ['claude-code'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [],
    source: { origin: 'original', upstream_ref: null },
  };
  assert.ok(v(base), JSON.stringify(v.errors));
  const withRequires = {
    ...base,
    requires: [{ point: 'agent_file', severity: 'hard' }],
  };
  assert.ok(v(withRequires), JSON.stringify(v.errors));
});

// ---------- SC12 templates tests/case-*.yaml field set ----------
// methodology §7.1: skill/agent/mcp template cases carry 13 fields (5 new: quadrant/
// source/confidence/allow_exact_reason/ref). workflow/bundle/brand-draft still carry
// the legacy 7-field skeleton (their tests are filled by the distiller at staged+).
test('SC12 all template case files have the expected field set', () => {
  const kinds = ['agent', 'skill', 'mcp', 'workflow', 'bundle', 'brand-draft'];
  const NEW = ['allow_exact_reason', 'confidence', 'expect', 'expected', 'input', 'judge_rubric', 'judge_threshold', 'name', 'quadrant', 'ref', 'schema_ref', 'source', 'weight'];
  const OLD = ['expect', 'expected', 'input', 'judge_rubric', 'judge_threshold', 'name', 'schema_ref', 'weight'];
  for (const k of kinds) {
    const isNew = ['agent', 'skill', 'mcp'].includes(k);
    const expectedKeys = isNew ? NEW : OLD;
    for (const n of ['01', '02', '03']) {
      const raw = fs.readFileSync(path.join(TEMPLATES_DIR, k, 'tests', `case-${n}.yaml`), 'utf8');
      const parsed = yaml.load(raw);
      const keys = Object.keys(parsed).sort();
      assert.deepEqual(keys, expectedKeys, `${k}/tests/case-${n}.yaml keys`);
      assert.equal(parsed.judge_threshold, 0.7);
      assert.equal(parsed.weight, 1.0);
      assert.equal(parsed.name, '__FILL_ME__');
      assert.equal(parsed.input, '__FILL_ME__');
      assert.equal(parsed.expected, '__FILL_ME__');
    }
  }
});
