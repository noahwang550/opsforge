// adapters/dify/adapter.test.mjs — Phase 2.5: DifyAdapter (Tier 3 domestic example) tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { DifyAdapter, adapter } from './adapter.mjs';
import { parseCapability } from '../../tools/validate.mjs';

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-dify-')); }
function setHome(tmp) { process.env.OPSFORGE_HOME = tmp; }

function mkAgentCap(tmp) {
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), '---\nid: foo.bar\n---\nagent body content here that is long enough');
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'foo.bar', version: '0.1.0', kind: 'agent', pack: 'foo', owner: 'foo',
    display_name: 'B', display_name_zh: 'B', display_name_en: 'B',
    description: 'd', platforms: ['dify'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  return capDir;
}

// DF1 tier() returns 3 (only prompt_exec supported)
test('DF1 DifyAdapter tier() returns 3', () => {
  assert.equal(new DifyAdapter().tier(), 3);
});

// DF2 supports() declares only prompt_exec supported; everything else degrades
test('DF2 supports() only prompt_exec supported', () => {
  const a = new DifyAdapter();
  assert.equal(a.supports('prompt_exec').supported, true);
  for (const p of ['agent_file', 'skill_file', 'slash_command', 'mcp_config', 'config_dir_writable', 'workflow_orchestration', 'kb_mount', 'feedback_hook']) {
    assert.equal(a.supports(p).supported, false, `${p} should be unsupported`);
    assert.ok(a.supports(p).fallback, `${p} should declare a fallback strategy`);
  }
});

// DF3 conform() passes for valid agent (entrypoint exists)
test('DF3 conform() passes for valid agent', () => {
  const tmp = mkTmp(); setHome(mkTmp());
  const capDir = mkAgentCap(tmp);
  const a = new DifyAdapter();
  const cap = parseCapability(capDir);
  const r = a.conform(cap);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// DF4 translate() agent → http-direct degradation (paste instructions for Dify HTTP API)
test('DF4 translate() agent → http-direct degradation', () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  const a = new DifyAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].degradation, 'http-direct', `degradation; got ${artifacts[0].degradation}`);
  assert.ok(artifacts[0].pasteInstructions, 'should include paste instructions');
});

// DF5 conform() fails on requires:hard agent_file (unsupported)
test('DF5 conform() fails when requires:hard agent_file', () => {
  const tmp = mkTmp(); setHome(mkTmp());
  const capDir = mkAgentCap(tmp);
  let y = fs.readFileSync(path.join(capDir, 'capability.yaml'), 'utf8');
  y = y.replace('depends_on: []', 'depends_on: []\nrequires:\n  - point: agent_file\n    severity: hard');
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), y);
  const a = new DifyAdapter();
  const r = a.conform(parseCapability(capDir));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('agent_file')));
});

// DF6 detect() returns false when no config dir
test('DF6 detect() returns false when no config dir', () => {
  const home = mkTmp(); setHome(home);
  assert.equal(new DifyAdapter().detect(), false);
});

// DF7 default adapter instance exported
test('DF7 default adapter instance exported', () => {
  assert.ok(adapter instanceof DifyAdapter);
  assert.equal(adapter.platform, 'dify');
});
