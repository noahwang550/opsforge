// adapters/cursor/adapter.test.mjs — Phase 2.1: CursorAdapter TDD tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { CursorAdapter, adapter } from './adapter.mjs';
import { parseCapability } from '../../tools/validate.mjs';

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-cursor-')); }
function setHome(tmp) { process.env.OPSFORGE_HOME = tmp; }

function mkAgentCap(tmp) {
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), '---\nid: foo.bar\n---\nagent body content here that is long enough');
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'foo.bar', version: '0.1.0', kind: 'agent', pack: 'foo', owner: 'foo',
    display_name: 'B', display_name_zh: 'B', display_name_en: 'B',
    description: 'd', platforms: ['cursor'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  return capDir;
}

// CU1 tier() returns 1 for cursor (all 6 Tier1 points supported)
test('CU1 CursorAdapter tier() returns 1', () => {
  assert.equal(new CursorAdapter().tier(), 1);
});

// CU2 supports() declares feedback_hook unsupported with manual-paste fallback
test('CU2 supports() feedback_hook unsupported with fallback', () => {
  const a = new CursorAdapter();
  assert.equal(a.supports('feedback_hook').supported, false);
  assert.equal(a.supports('feedback_hook').fallback, 'manual-paste');
  assert.equal(a.supports('prompt_exec').supported, true);
});

// CU3 conform() passes for valid agent
test('CU3 conform() passes for valid agent', () => {
  const tmp = mkTmp(); setHome(mkTmp());
  const capDir = mkAgentCap(tmp);
  const a = new CursorAdapter();
  const r = a.conform(parseCapability(capDir));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// CU4 translate() agent → .cursor/rules/<name>.mdc
test('CU4 translate() agent → .cursor/rules/<name>.mdc', () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  const a = new CursorAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].kind, 'agent-file');
  assert.ok(artifacts[0].targetPath.includes(path.join('.cursor', 'rules', 'bar.mdc')), artifacts[0].targetPath);
  assert.ok(artifacts[0].content.includes('agent body'));
});

// CU5 translate() skill → .cursor/skills/<name>.md
test('CU5 translate() skill → .cursor/skills/<name>.md', () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'SKILL.md'), '---\nid: foo.baz\n---\nskill body');
  const a = new CursorAdapter();
  const cap = { yaml: { kind: 'skill', id: 'foo.baz', entrypoint: 'SKILL.md' }, dir: capDir };
  const artifacts = a.translate(cap);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].kind, 'skill-file');
  assert.ok(artifacts[0].targetPath.includes(path.join('.cursor', 'skills', 'baz', 'SKILL.md')), artifacts[0].targetPath);
});

// CU6 translate() mcp → mcp-config-merge for .cursor/mcp.json
test('CU6 translate() mcp → mcp-config-merge', () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), 'mcp server');
  fs.writeFileSync(path.join(capDir, 'mcp.yaml'), yaml.dump({
    id: 'foo.connector', version: '0.1.0', kind: 'mcp', pack: 'foo', owner: 'foo',
    display_name: 'C', display_name_zh: 'C', display_name_en: 'C',
    description: 'd', platforms: ['cursor'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    transport: 'stdio', config_template: { auth_schema: ['API_KEY'] },
    tools: [], source: { origin: 'original', upstream_ref: null },
  }));
  const a = new CursorAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  assert.equal(artifacts[0].kind, 'mcp-config-merge');
  assert.equal(artifacts[0].mcpConfig, null);
});

// CU7 install() writes agent artifact idempotently
test('CU7 install() writes agent artifact idempotently', async () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  const a = new CursorAdapter();
  const cap = parseCapability(capDir);
  const artifacts = a.translate(cap);
  await a.install(artifacts);
  const c1 = fs.readFileSync(artifacts[0].targetPath, 'utf8');
  await a.install(artifacts);
  const c2 = fs.readFileSync(artifacts[0].targetPath, 'utf8');
  assert.equal(c1, c2);
});

// CU8 injectMcp() merges into .cursor/mcp.json without clobbering
test('CU8 injectMcp() merges into .cursor/mcp.json', async () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), 'mcp');
  const mcpJson = path.join(home, '.cursor', 'mcp.json');
  fs.mkdirSync(path.dirname(mcpJson), { recursive: true });
  fs.writeFileSync(mcpJson, JSON.stringify({ mcpServers: { existing: { command: 'x' } } }));
  const a = new CursorAdapter();
  const cap = { yaml: { kind: 'mcp', id: 'foo.connector', entrypoint: 'source.md', transport: 'stdio', config_template: { auth_schema: [] } }, dir: capDir };
  await a.injectMcp(cap);
  const after = JSON.parse(fs.readFileSync(mcpJson, 'utf8'));
  assert.ok(after.mcpServers.existing, 'existing preserved');
  assert.ok(after.mcpServers.connector, 'new added');
  assert.ok(after._opsforge_notes && after._opsforge_notes.connector, 'note for non-executable entrypoint');
  assert.match(after._opsforge_notes.connector, /示例性 MCP/);
});

// CU9 detect() checks .cursor/ writable
test('CU9 detect() returns true when .cursor/ writable', () => {
  const home = mkTmp(); setHome(home);
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  assert.equal(new CursorAdapter().detect(), true);
});

test('CU9b detect() returns false when .cursor/ missing', () => {
  const home = mkTmp(); setHome(home);
  assert.equal(new CursorAdapter().detect(), false);
});

// CU10 uninstall() removes artifact
test('CU10 uninstall() removes artifact', async () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  const a = new CursorAdapter();
  const cap = parseCapability(capDir);
  const artifacts = a.translate(cap);
  await a.install(artifacts);
  const tp = artifacts[0].targetPath;
  assert.ok(fs.existsSync(tp));
  await a.uninstall('foo.bar', { artifacts: [tp] });
  assert.ok(!fs.existsSync(tp));
});

// CU11 default adapter instance exported
test('CU11 default adapter instance exported', () => {
  assert.ok(adapter instanceof CursorAdapter);
  assert.equal(adapter.platform, 'cursor');
});
