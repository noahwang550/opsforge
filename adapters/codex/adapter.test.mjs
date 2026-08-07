// adapters/codex/adapter.test.mjs — Phase 2.1: CodexAdapter (Tier 2) TDD tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { CodexAdapter, adapter } from './adapter.mjs';
import { parseCapability } from '../../tools/validate.mjs';

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-codex-')); }
function setHome(tmp) { process.env.OPSFORGE_HOME = tmp; }

function mkAgentCap(tmp) {
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), '---\nid: foo.bar\n---\nagent body content here that is long enough');
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'foo.bar', version: '0.1.0', kind: 'agent', pack: 'foo', owner: 'foo',
    display_name: 'B', display_name_zh: 'B', display_name_en: 'B',
    description: 'd', platforms: ['codex'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  return capDir;
}

// CX1 tier() returns 2 (only prompt_exec+config_dir_writable+mcp_config of Tier1 set)
test('CX1 CodexAdapter tier() returns 2', () => {
  assert.equal(new CodexAdapter().tier(), 2);
});

// CX2 supports() declares agent_file/skill_file/slash_command unsupported with fallbacks
test('CX2 supports() declares unsupported points with fallbacks', () => {
  const a = new CodexAdapter();
  assert.equal(a.supports('prompt_exec').supported, true);
  assert.equal(a.supports('config_dir_writable').supported, true);
  assert.equal(a.supports('mcp_config').supported, true);
  assert.equal(a.supports('agent_file').supported, false);
  assert.equal(a.supports('agent_file').fallback, 'manual-paste');
  assert.equal(a.supports('skill_file').supported, false);
  assert.equal(a.supports('slash_command').supported, false);
  assert.equal(a.supports('workflow_orchestration').supported, false);
  assert.equal(a.supports('feedback_hook').supported, false);
});

// CX3 conform() passes for valid agent (entrypoint exists)
test('CX3 conform() passes for valid agent', () => {
  const tmp = mkTmp(); setHome(mkTmp());
  const capDir = mkAgentCap(tmp);
  const a = new CodexAdapter();
  const r = a.conform(parseCapability(capDir));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// CX4 conform() fails on requires:hard agent_file (unsupported on codex)
test('CX4 conform() fails when requires:hard agent_file', () => {
  const tmp = mkTmp(); setHome(mkTmp());
  const capDir = mkAgentCap(tmp);
  let y = fs.readFileSync(path.join(capDir, 'capability.yaml'), 'utf8');
  y = y.replace('depends_on: []', 'depends_on: []\nrequires:\n  - point: agent_file\n    severity: hard');
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), y);
  const a = new CodexAdapter();
  const r = a.conform(parseCapability(capDir));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('agent_file')));
});

// CX5 translate() agent → manual-paste degradation (agent_file unsupported)
test('CX5 translate() agent → manual-paste artifact', () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  const a = new CodexAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].degradation, 'manual-paste');
  assert.ok(artifacts[0].pasteInstructions, 'should include paste instructions');
  assert.ok(artifacts[0].content.includes('agent body'));
});

// CX6 translate() mcp → mcp-config-merge (mcp_config supported) for ~/.codex/config.toml merge
test('CX6 translate() mcp → mcp-config-merge', () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), 'mcp server');
  fs.writeFileSync(path.join(capDir, 'mcp.yaml'), yaml.dump({
    id: 'foo.connector', version: '0.1.0', kind: 'mcp', pack: 'foo', owner: 'foo',
    display_name: 'C', display_name_zh: 'C', display_name_en: 'C',
    description: 'd', platforms: ['codex'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    transport: 'stdio', config_template: { auth_schema: ['API_KEY'] },
    tools: [], source: { origin: 'original', upstream_ref: null },
  }));
  const a = new CodexAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  assert.equal(artifacts[0].kind, 'mcp-config-merge');
  assert.equal(artifacts[0].mcpConfig, null);
});

// CX7 install() writes manual-paste artifact (no targetPath → instructions only, nothing written)
test('CX7 install() writes nothing for manual-paste (instructions-only)', async () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  const a = new CodexAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  const r = await a.install(artifacts);
  assert.deepEqual(r.artifacts, []); // nothing written; manual-paste is instructions-only
});

// CX8 injectMcp() merges into ~/.codex/config (codex mcp)
test('CX8 injectMcp() merges into codex mcp config', async () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), 'mcp');
  const cfgPath = path.join(home, '.codex', 'config.json');
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify({ mcpServers: { existing: { command: 'x' } } }));
  const a = new CodexAdapter();
  const cap = { yaml: { kind: 'mcp', id: 'foo.connector', entrypoint: 'source.md', transport: 'stdio', config_template: { auth_schema: [] } }, dir: capDir };
  const r = await a.injectMcp(cap);
  assert.ok(r.mcp_keys.includes('connector'));
  const after = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.ok(after.mcpServers.existing, 'existing preserved');
  assert.ok(after.mcpServers.connector, 'new added');
  assert.ok(after._opsforge_notes && after._opsforge_notes.connector, 'note for non-executable entrypoint');
  assert.match(after._opsforge_notes.connector, /示例性 MCP/);
});

// CX9 detect() checks ~/.codex/ writable
test('CX9 detect() returns true when ~/.codex/ writable', () => {
  const home = mkTmp(); setHome(home);
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  assert.equal(new CodexAdapter().detect(), true);
});

test('CX9b detect() returns false when ~/.codex/ missing', () => {
  const home = mkTmp(); setHome(home);
  assert.equal(new CodexAdapter().detect(), false);
});

// CX10 uninstall() removes mcp keys from codex config
test('CX10 uninstall() removes mcp keys', async () => {
  const home = mkTmp(); setHome(home);
  const cfgPath = path.join(home, '.codex', 'config.json');
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify({ mcpServers: { connector: { command: 'node' }, keep: { command: 'y' } }, _opsforge_notes: { connector: '示例性 MCP', keep: 'keep-me' } }));
  const a = new CodexAdapter();
  await a.uninstall('foo.connector', { mcp_keys: ['connector'] });
  const after = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.ok(!after.mcpServers.connector, 'connector removed');
  assert.ok(after.mcpServers.keep, 'keep preserved');
  assert.ok(!after._opsforge_notes || !after._opsforge_notes.connector, 'note for removed mcp key cleaned up');
  assert.ok(after._opsforge_notes && after._opsforge_notes.keep === 'keep-me', 'note for preserved mcp key retained');
});

// CX11 default adapter instance exported
test('CX11 default adapter instance exported', () => {
  assert.ok(adapter instanceof CodexAdapter);
  assert.equal(adapter.platform, 'codex');
});
