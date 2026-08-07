// adapters/workbuddy/adapter.test.mjs — S4: WorkBuddyAdapter (Tier 2) TDD tests (WB1-WB13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { WorkBuddyAdapter, adapter } from './adapter.mjs';
import { parseCapability } from '../../tools/validate.mjs';

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-wb-')); }
function setHome(tmp) { process.env.OPSFORGE_HOME = tmp; }

function mkAgentCap(tmp) {
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), '---\nid: foo.bar\n---\nagent body content here that is long enough');
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'foo.bar', version: '0.1.0', kind: 'agent', pack: 'foo', owner: 'foo',
    display_name: 'B', display_name_zh: 'B', display_name_en: 'B',
    description: 'd', platforms: ['workbuddy'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  return capDir;
}

// WB1 tier() returns 2 (prompt_exec+skill_file+slash_command+mcp_config+config_dir_writable; missing agent_file/workflow_orchestration)
test('WB1 WorkBuddyAdapter tier() returns 2', () => {
  assert.equal(new WorkBuddyAdapter().tier(), 2);
});

// WB2 supports() declares capability points
test('WB2 supports() declares points', () => {
  const a = new WorkBuddyAdapter();
  assert.equal(a.supports('prompt_exec').supported, true);
  assert.equal(a.supports('agent_file').supported, false);
  assert.equal(a.supports('agent_file').fallback, 'cli-engine');
  assert.equal(a.supports('skill_file').supported, true);
  assert.equal(a.supports('slash_command').supported, true);
  assert.equal(a.supports('mcp_config').supported, true);
  assert.equal(a.supports('workflow_orchestration').supported, false);
  assert.equal(a.supports('workflow_orchestration').fallback, 'cli-engine');
  assert.equal(a.supports('config_dir_writable').supported, true);
  assert.equal(a.supports('kb_mount').supported, false);
  assert.equal(a.supports('feedback_hook').supported, false);
});

// WB3 conform() passes for valid agent without requires:hard
test('WB3 conform() passes for valid agent', () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  const a = new WorkBuddyAdapter();
  const r = a.conform(parseCapability(capDir));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// WB4 conform() fails when requires:hard point unsupported (agent_file)
test('WB4 conform() fails for requires:hard agent_file', () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  const cap = { ...parseCapability(capDir), dir: capDir };
  cap.yaml.requires = [{ point: 'agent_file', severity: 'hard' }];
  const a = new WorkBuddyAdapter();
  const r = a.conform(cap);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /agent_file.*not supported/.test(e)), JSON.stringify(r.errors));
});

// WB5 translate() agent → skill-file (cli-engine 降级)
test('WB5 translate() agent → skill-file', () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  const a = new WorkBuddyAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].kind, 'skill-file');
  assert.ok(artifacts[0].targetPath.includes(path.join('.workbuddy', 'skills', 'opsforge-bar', 'SKILL.md')), artifacts[0].targetPath);
  assert.equal(artifacts[0].degradation, 'cli-engine');
  assert.ok(artifacts[0].content.includes('agent body'));
});

// WB6 translate() skill → skill-file (no degradation)
test('WB6 translate() skill → skill-file', () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'SKILL.md'), '---\nid: foo.baz\n---\nskill body content');
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'foo.baz', version: '0.1.0', kind: 'skill', pack: 'foo', owner: 'foo',
    display_name: 'Baz', display_name_zh: 'Baz', display_name_en: 'Baz',
    description: 'd', platforms: ['workbuddy'],
    entrypoint: 'SKILL.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  const a = new WorkBuddyAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].kind, 'skill-file');
  assert.equal(artifacts[0].degradation, null);
  assert.ok(artifacts[0].content.includes('skill body'));
});

// WB7 translate() mcp → mcp-config-merge (mcpConfig=null 死字段已删，injectMcp 才是真实写入路径)
test('WB7 translate() mcp → mcp-config-merge', () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), 'mcp server');
  fs.writeFileSync(path.join(capDir, 'mcp.yaml'), yaml.dump({
    id: 'foo.connector', version: '0.1.0', kind: 'mcp', pack: 'foo', owner: 'foo',
    display_name: 'C', display_name_zh: 'C', display_name_en: 'C',
    description: 'd', platforms: ['workbuddy'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    transport: 'stdio', config_template: { auth_schema: ['API_KEY'] },
    tools: [], source: { origin: 'original', upstream_ref: null },
  }));
  const a = new WorkBuddyAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  assert.equal(artifacts[0].kind, 'mcp-config-merge');
  // mcpConfig 死字段已删（install.mjs 从不消费 translate 的 mcpConfig；injectMcp 写 ~/.workbuddy/mcp.json）
  assert.equal(artifacts[0].mcpConfig, null);
  assert.equal(artifacts[0].targetPath, null);
  assert.equal(artifacts[0].pasteInstructions, null);
});

// WB8 translate() workflow → skill-file (引导式 skill, cli-engine 降级)
test('WB8 translate() workflow → skill-file guided', () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'workflow.yaml'), yaml.dump({
    id: 'foo.retrospect', version: '0.1.0', kind: 'workflow', pack: 'foo', owner: 'foo',
    display_name: 'Retro', display_name_zh: 'Retro', display_name_en: 'Retro',
    description: 'd', platforms: ['workbuddy'],
    steps: [{ id: 's1', capability: 'foo.copywriter', inputs: {}, outputs: ['out'] }],
    outputs: {}, tests: 'tests/', changelog: 'CHANGELOG.md',
    source: { origin: 'original', upstream_ref: null },
  }));
  const a = new WorkBuddyAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].kind, 'skill-file');
  assert.equal(artifacts[0].degradation, 'cli-engine');
  assert.ok(artifacts[0].content.includes('引导式 skill'));
  assert.ok(artifacts[0].content.includes('步骤 1'));
});

// WB9 install() writes skill file, skips mcp-config-merge
test('WB9 install() writes skill artifact idempotently', async () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  const a = new WorkBuddyAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  await a.install(artifacts);
  const c1 = fs.readFileSync(artifacts[0].targetPath, 'utf8');
  await a.install(artifacts);
  const c2 = fs.readFileSync(artifacts[0].targetPath, 'utf8');
  assert.equal(c1, c2);
  // mcp-config-merge artifact produces no written file
  const mcpArt = { kind: 'mcp-config-merge', targetPath: null, content: null, mcpConfig: { servers: {} }, degradation: null, pasteInstructions: null };
  const r = await a.install([mcpArt]);
  assert.equal(r.artifacts.length, 0);
});

// WB10 injectMcp() merges into ~/.workbuddy/mcp.json mcpServers
test('WB10 injectMcp() merges into workbuddy mcp.json', async () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), 'mcp');
  const cfgPath = path.join(home, '.workbuddy', 'mcp.json');
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify({ mcpServers: { existing: { command: 'x' } } }));
  const a = new WorkBuddyAdapter();
  const cap = { yaml: { kind: 'mcp', id: 'foo.connector', entrypoint: 'source.md', transport: 'stdio', config_template: { auth_schema: ['API_KEY'] } }, dir: capDir };
  const r = await a.injectMcp(cap);
  const after = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.ok(after.mcpServers.existing, 'existing preserved');
  assert.ok(after.mcpServers['opsforge-connector'], 'new added with opsforge- prefix');
  assert.equal(after.mcpServers['opsforge-connector'].env.API_KEY, '${API_KEY}');
  assert.ok(r.mcp_keys.includes('opsforge-connector'));
});

// WB11 uninstall() removes artifact + mcp keys
test('WB11 uninstall() removes artifact and mcp keys', async () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  const a = new WorkBuddyAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  await a.install(artifacts);
  const tp = artifacts[0].targetPath;
  // seed mcp config
  const cfgPath = path.join(home, '.workbuddy', 'mcp.json');
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify({ mcpServers: { 'opsforge-bar': { command: 'node' } } }));
  const r = await a.uninstall('foo.bar', { artifacts: [tp], mcp_keys: ['opsforge-bar'] });
  assert.ok(!fs.existsSync(tp));
  assert.ok(r.uninstalled.includes(`mcp:opsforge-bar`));
  const after = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.ok(!after.mcpServers['opsforge-bar'], 'mcp key removed');
});

// WB12 detect() returns true when ~/.workbuddy writable, false when missing
test('WB12 detect() checks ~/.workbuddy writable', () => {
  const home = mkTmp(); setHome(home);
  fs.mkdirSync(path.join(home, '.workbuddy'), { recursive: true });
  assert.equal(new WorkBuddyAdapter().detect(), true);
  const home2 = mkTmp(); setHome(home2);
  assert.equal(new WorkBuddyAdapter().detect(), false);
});

// WB13 agent SKILL.md has WorkBuddy frontmatter (summary/description/read_when)
test('WB13 agent SKILL.md has WorkBuddy frontmatter', () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  const a = new WorkBuddyAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  const c = artifacts[0].content;
  // WorkBuddy 规范: summary/description/read_when (不是 name/source)
  assert.match(c, /^---\nsummary: "/);
  assert.match(c, /\ndescription: "/);
  assert.match(c, /\nread_when:\n/);
  // 不含 claude-code 专属 frontmatter
  assert.doesNotMatch(c, /\nname: opsforge-/);
  assert.doesNotMatch(c, /\nsource: opsforge/);
});

// WB14 default adapter instance exported
test('WB14 default adapter instance exported', () => {
  assert.ok(adapter instanceof WorkBuddyAdapter);
  assert.equal(adapter.platform, 'workbuddy');
});
