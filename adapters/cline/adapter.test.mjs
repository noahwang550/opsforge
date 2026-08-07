// adapters/cline/adapter.test.mjs — Phase 2.1: ClineAdapter (Tier 2) TDD tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { ClineAdapter, adapter } from './adapter.mjs';
import { parseCapability } from '../../tools/validate.mjs';

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-cline-')); }
function setHome(tmp) { process.env.OPSFORGE_HOME = tmp; }

function mkAgentCap(tmp) {
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), '---\nid: foo.bar\n---\nagent body content here that is long enough');
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'foo.bar', version: '0.1.0', kind: 'agent', pack: 'foo', owner: 'foo',
    display_name: 'B', display_name_zh: 'B', display_name_en: 'B',
    description: 'd', platforms: ['cline'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  return capDir;
}

// CL1 tier() returns 2 (agent_file+mcp_config+config_dir_writable+prompt_exec; missing skill_file/slash_command)
test('CL1 ClineAdapter tier() returns 2', () => {
  assert.equal(new ClineAdapter().tier(), 2);
});

// CL2 supports() declares skill_file/slash_command unsupported with fallbacks
test('CL2 supports() declares unsupported points', () => {
  const a = new ClineAdapter();
  assert.equal(a.supports('prompt_exec').supported, true);
  assert.equal(a.supports('agent_file').supported, true);
  assert.equal(a.supports('mcp_config').supported, true);
  assert.equal(a.supports('config_dir_writable').supported, true);
  assert.equal(a.supports('skill_file').supported, false);
  assert.equal(a.supports('skill_file').fallback, 'manual-paste');
  assert.equal(a.supports('slash_command').supported, false);
  assert.equal(a.supports('workflow_orchestration').supported, false);
});

// CL3 conform() passes for valid agent
test('CL3 conform() passes for valid agent', () => {
  const tmp = mkTmp(); setHome(mkTmp());
  const capDir = mkAgentCap(tmp);
  const a = new ClineAdapter();
  const r = a.conform(parseCapability(capDir));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// CL4 translate() agent → .clinerules/<name>.md (agent_file supported)
test('CL4 translate() agent → .clinerules/<name>.md', () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  const a = new ClineAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].kind, 'agent-file');
  assert.ok(artifacts[0].targetPath.includes(path.join('.clinerules', 'bar.md')), artifacts[0].targetPath);
  assert.ok(artifacts[0].content.includes('agent body'));
});

// CL5 translate() skill → manual-paste (skill_file unsupported)
test('CL5 translate() skill → manual-paste degradation', () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'SKILL.md'), '---\nid: foo.baz\n---\nskill body');
  const a = new ClineAdapter();
  const cap = { yaml: { kind: 'skill', id: 'foo.baz', entrypoint: 'SKILL.md' }, dir: capDir };
  const artifacts = a.translate(cap);
  assert.equal(artifacts[0].degradation, 'manual-paste');
  assert.ok(artifacts[0].pasteInstructions);
});

// CL6 translate() mcp → mcp-config-merge for cline mcp settings
test('CL6 translate() mcp → mcp-config-merge', () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), 'mcp server');
  fs.writeFileSync(path.join(capDir, 'mcp.yaml'), yaml.dump({
    id: 'foo.connector', version: '0.1.0', kind: 'mcp', pack: 'foo', owner: 'foo',
    display_name: 'C', display_name_zh: 'C', display_name_en: 'C',
    description: 'd', platforms: ['cline'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    transport: 'stdio', config_template: { auth_schema: ['API_KEY'] },
    tools: [], source: { origin: 'original', upstream_ref: null },
  }));
  const a = new ClineAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  assert.equal(artifacts[0].kind, 'mcp-config-merge');
  assert.equal(artifacts[0].mcpConfig, null);
});

// CL7 install() writes agent artifact idempotently
test('CL7 install() writes agent artifact idempotently', async () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  const a = new ClineAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  await a.install(artifacts);
  const c1 = fs.readFileSync(artifacts[0].targetPath, 'utf8');
  await a.install(artifacts);
  const c2 = fs.readFileSync(artifacts[0].targetPath, 'utf8');
  assert.equal(c1, c2);
});

// CL8 injectMcp() merges into cline mcp_settings.json
test('CL8 injectMcp() merges into cline mcp settings', async () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), 'mcp');
  const cfgPath = path.join(home, '.cline', 'mcp_settings.json');
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify({ mcpServers: { existing: { command: 'x' } } }));
  const a = new ClineAdapter();
  const cap = { yaml: { kind: 'mcp', id: 'foo.connector', entrypoint: 'source.md', transport: 'stdio', config_template: { auth_schema: [] } }, dir: capDir };
  await a.injectMcp(cap);
  const after = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.ok(after.mcpServers.existing, 'existing preserved');
  assert.ok(after.mcpServers.connector, 'new added');
  assert.ok(after._opsforge_notes && after._opsforge_notes.connector, 'note for non-executable entrypoint');
  assert.match(after._opsforge_notes.connector, /示例性 MCP/);
});

// CL9 detect() checks .clinerules/ or .cline/ writable
test('CL9 detect() returns true when .cline/ writable', () => {
  const home = mkTmp(); setHome(home);
  fs.mkdirSync(path.join(home, '.cline'), { recursive: true });
  assert.equal(new ClineAdapter().detect(), true);
});

test('CL9b detect() returns false when dirs missing', () => {
  const home = mkTmp(); setHome(home);
  assert.equal(new ClineAdapter().detect(), false);
});

// CL10 uninstall() removes artifact + mcp keys
test('CL10 uninstall() removes artifact and mcp keys', async () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  const a = new ClineAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  await a.install(artifacts);
  const tp = artifacts[0].targetPath;
  await a.uninstall('foo.bar', { artifacts: [tp] });
  assert.ok(!fs.existsSync(tp));
});

// CL11 default adapter instance exported
test('CL11 default adapter instance exported', () => {
  assert.ok(adapter instanceof ClineAdapter);
  assert.equal(adapter.platform, 'cline');
});
