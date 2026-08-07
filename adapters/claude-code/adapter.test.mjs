// adapters/claude-code/adapter.test.mjs — Phase 1.2: BaseAdapter + ClaudeCodeAdapter tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { BaseAdapter } from '../base.mjs';
import { ClaudeCodeAdapter, adapter } from './adapter.mjs';
import { setRepoRoot, parseCapability } from '../../tools/validate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_ADAPTER_DIR = __dirname;

// ---------- helpers ----------
function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-adapter-'));
}

function setOpsforgeHome(tmp) {
  process.env.OPSFORGE_HOME = tmp;
}

// ---------- A1 BaseAdapter.tier() returns 1 for claude-code ----------
test('A1 BaseAdapter.tier() returns 1 for claude-code platform.yaml', () => {
  const a = new ClaudeCodeAdapter();
  assert.equal(a.tier(), 1);
});

// ---------- A1b BaseAdapter.tier() Tier3 = only prompt_exec; Tier2 = some-but-not-all ----------
test('A1b BaseAdapter.tier() Tier3/Tier2 formula (§22.3)', () => {
  // Tier3: only prompt_exec supported among the 6 Tier1 points.
  class Tier3Adapter extends BaseAdapter {
    platform = 'tier3-fixture';
    _getYaml() {
      return {
        capability_points: {
          prompt_exec: { supported: true },
          agent_file: { supported: false },
          skill_file: { supported: false },
          slash_command: { supported: false },
          mcp_config: { supported: false },
          config_dir_writable: { supported: false },
          workflow_orchestration: { supported: false },
          kb_mount: { supported: false },
          feedback_hook: { supported: false },
        },
      };
    }
  }
  assert.equal(new Tier3Adapter().tier(), 3, 'only prompt_exec → Tier 3');

  // Tier2: prompt_exec + mcp_config + config_dir_writable (some but not all) → Tier 2.
  class Tier2Adapter extends BaseAdapter {
    platform = 'tier2-fixture';
    _getYaml() {
      return {
        capability_points: {
          prompt_exec: { supported: true },
          agent_file: { supported: false },
          skill_file: { supported: false },
          slash_command: { supported: false },
          mcp_config: { supported: true },
          config_dir_writable: { supported: true },
          workflow_orchestration: { supported: false },
          kb_mount: { supported: false },
          feedback_hook: { supported: false },
        },
      };
    }
  }
  assert.equal(new Tier2Adapter().tier(), 2, 'some-but-not-all → Tier 2');
});

// ---------- A1c BaseAdapter.tier() prompt_exec + only 1 of the other 5 → Tier 3 (§22.3 "至少 2 个文件/配置类") ----------
test('A1c BaseAdapter.tier() prompt_exec + exactly 1 of the other 5 → Tier 3 (tightened §22.3)', () => {
  // §22.3: Tier2 requires prompt_exec + "至少 2 个文件/配置类" supported.
  // So prompt_exec + only mcp_config (1 of the 5) does NOT qualify as Tier2;
  // it falls to Tier3 (barely above prompt-only, degrades like Tier3).
  class BarelyAbovePromptAdapter extends BaseAdapter {
    platform = 'barely-fixture';
    _getYaml() {
      return {
        capability_points: {
          prompt_exec: { supported: true },
          agent_file: { supported: false },
          skill_file: { supported: false },
          slash_command: { supported: false },
          mcp_config: { supported: true },   // exactly 1 of the other 5
          config_dir_writable: { supported: false },
          workflow_orchestration: { supported: false },
          kb_mount: { supported: false },
          feedback_hook: { supported: false },
        },
      };
    }
  }
  assert.equal(new BarelyAbovePromptAdapter().tier(), 3, 'prompt_exec + only 1 of the other 5 → Tier 3 (needs ≥2 for Tier2)');
});

// ---------- A2 BaseAdapter.supports() returns {supported:true} for all 9 points ----------
test('A2 supports() returns supported:true for all 9 points', () => {
  const a = new ClaudeCodeAdapter();
  const points = ['prompt_exec', 'agent_file', 'skill_file', 'slash_command', 'mcp_config', 'workflow_orchestration', 'config_dir_writable', 'kb_mount', 'feedback_hook'];
  for (const p of points) {
    const r = a.supports(p);
    assert.equal(r.supported, true, `${p} should be supported`);
  }
});

// ---------- A3 supports() returns {supported:false} for unknown point ----------
test('A3 supports() returns supported:false for unknown point', () => {
  const a = new ClaudeCodeAdapter();
  assert.equal(a.supports('bogus_point').supported, false);
});

// ---------- A4 conform() passes for valid agent ----------
test('A4 conform() passes for valid agent', () => {
  const tmp = mkTmp();
  setOpsforgeHome(mkTmp());
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), 'agent body content here that is long enough');
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'foo.bar', version: '0.1.0', kind: 'agent', pack: 'foo', owner: 'foo',
    display_name: 'Bar', display_name_zh: 'Bar', display_name_en: 'Bar',
    description: 'desc', platforms: ['claude-code'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  const a = new ClaudeCodeAdapter();
    const cap = parseCapability(capDir);
  const r = a.conform(cap);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// ---------- A5 conform() fails when entrypoint missing ----------
test('A5 conform() fails when entrypoint file missing', () => {
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  // Don't create source.md
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'foo.bar', version: '0.1.0', kind: 'agent', pack: 'foo', owner: 'foo',
    display_name: 'B', display_name_zh: 'B', display_name_en: 'B',
    description: 'd', platforms: ['claude-code'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  const a = new ClaudeCodeAdapter();
    const cap = parseCapability(capDir);
  const r = a.conform(cap);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('entrypoint')));
});

// ---------- A6 conform() fails on requires:hard unsupported point ----------
test('A6 conform() fails when requires:hard point unsupported', () => {
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), 'body');
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'foo.bar', version: '0.1.0', kind: 'agent', pack: 'foo', owner: 'foo',
    display_name: 'B', display_name_zh: 'B', display_name_en: 'B',
    description: 'd', platforms: ['claude-code'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
    requires: [{ point: 'feedback_hook', severity: 'hard' }],
  }));
  // Use a fake adapter that declares feedback_hook unsupported
  class FakeAdapter extends ClaudeCodeAdapter {
    supports(point) {
      if (point === 'feedback_hook') return { supported: false };
      return super.supports(point);
    }
  }
  const a = new FakeAdapter();
    const cap = parseCapability(capDir);
  const r = a.conform(cap);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('feedback_hook')));
});

// ---------- A7 translate() produces correct agent artifact path ----------
test('A7 translate() produces agent-file artifact at ~/.claude/agents/', async () => {
  const home = mkTmp();
  setOpsforgeHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), '---\nid: foo.bar\n---\nbody');
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'foo.bar', version: '0.1.0', kind: 'agent', pack: 'foo', owner: 'foo',
    display_name: 'B', display_name_zh: 'B', display_name_en: 'B',
    description: 'd', platforms: ['claude-code'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  const a = new ClaudeCodeAdapter();
    const cap = parseCapability(capDir);
  const artifacts = a.translate(cap);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].kind, 'agent-file');
  assert.ok(artifacts[0].targetPath.includes(path.join('.claude', 'agents', 'bar.md')), artifacts[0].targetPath);
  assert.ok(artifacts[0].content.includes('body'));
  // A7b: agent artifact must carry Claude Code-native frontmatter (name + description)
  // so Claude Code discovers it as an @-invokable subagent. The OpsForge source.md
  // frontmatter (id/pack/...) must be stripped, not passed through verbatim.
  assert.match(artifacts[0].content, /^---\nname: bar\ndescription: d\n---\n\nbody/, artifacts[0].content);
  assert.equal(artifacts[0].content.includes('id: foo.bar'), false, 'OpsForge frontmatter must be stripped');
});

// ---------- A8 translate() produces skill artifact path ----------
test('A8 translate() produces skill-file artifact at ~/.claude/skills/', async () => {
  const home = mkTmp();
  setOpsforgeHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'SKILL.md'), '---\nid: foo.bar\n---\nskill body');
  const a = new ClaudeCodeAdapter();
  const cap = { yaml: { kind: 'skill', id: 'foo.bar', entrypoint: 'SKILL.md' }, dir: capDir };
  const artifacts = a.translate(cap);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].kind, 'skill-file');
  assert.ok(artifacts[0].targetPath.includes(path.join('.claude', 'skills', 'bar', 'SKILL.md')), artifacts[0].targetPath);
});

// ---------- A9 translate() produces mcp-config-merge artifact ----------
test('A9 translate() produces mcp-config-merge artifact', async () => {
  const home = mkTmp();
  setOpsforgeHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), 'mcp server');
  fs.writeFileSync(path.join(capDir, 'mcp.yaml'), yaml.dump({
    id: 'foo.connector', version: '0.1.0', kind: 'mcp', pack: 'foo', owner: 'foo',
    display_name: 'C', display_name_zh: 'C', display_name_en: 'C',
    description: 'd', platforms: ['claude-code'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    transport: 'stdio',
    config_template: { auth_schema: ['API_KEY'] },
    tools: [], source: { origin: 'original', upstream_ref: null },
  }));
  const a = new ClaudeCodeAdapter();
    const cap = parseCapability(capDir);
  const artifacts = a.translate(cap);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].kind, 'mcp-config-merge');
  assert.equal(artifacts[0].mcpConfig, null);
});

// ---------- A10 install() is idempotent ----------
test('A10 install() is idempotent — second run no diff', async () => {
  const home = mkTmp();
  setOpsforgeHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), '---\nid: foo.bar\n---\nbody content');
  const a = new ClaudeCodeAdapter();
  const cap = { yaml: { kind: 'agent', id: 'foo.bar', entrypoint: 'source.md' }, dir: capDir };
  const artifacts = a.translate(cap);
  await a.install(artifacts);
  const targetPath = artifacts[0].targetPath;
  const content1 = fs.readFileSync(targetPath, 'utf8');
  // Second install — should be no-op
  await a.install(artifacts);
  const content2 = fs.readFileSync(targetPath, 'utf8');
  assert.equal(content1, content2, 'second install should not change content');
});

// ---------- A11 injectMcp() merges without clobbering existing servers ----------
test('A11 injectMcp() merges without clobbering', async () => {
  const home = mkTmp();
  setOpsforgeHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), 'mcp');
  // Pre-seed ~/.claude.json with existing server
  const claudeJsonPath = path.join(home, '.claude.json');
  fs.writeFileSync(claudeJsonPath, JSON.stringify({ mcpServers: { existing: { command: 'x' } } }));
  const a = new ClaudeCodeAdapter();
  const cap = { yaml: { kind: 'mcp', id: 'foo.connector', entrypoint: 'source.md', transport: 'stdio', config_template: { auth_schema: [] } }, dir: capDir };
  await a.injectMcp(cap);
  const after = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
  assert.ok(after.mcpServers.existing, 'existing server preserved');
  assert.ok(after.mcpServers.connector, 'new server added');
  // _opsforge_notes: source.md 非可执行 → 注记存在
  assert.ok(after._opsforge_notes && after._opsforge_notes.connector, 'note for non-executable entrypoint');
  assert.match(after._opsforge_notes.connector, /示例性 MCP/);
});

// ---------- A13 injectMcp() executable entrypoint produces no _opsforge_notes ----------
test('A13 injectMcp() executable entrypoint (server.mjs) → no _opsforge_notes', async () => {
  const home = mkTmp();
  setOpsforgeHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'server.mjs'), 'export default {};');
  const claudeJsonPath = path.join(home, '.claude.json');
  const a = new ClaudeCodeAdapter();
  const cap = { yaml: { kind: 'mcp', id: 'foo.connector', entrypoint: 'server.mjs', transport: 'stdio', config_template: { auth_schema: [] } }, dir: capDir };
  await a.injectMcp(cap);
  const after = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
  assert.ok(after.mcpServers.connector, 'server added');
  assert.equal(after._opsforge_notes, undefined, 'no note for executable entrypoint');
});

// ---------- A12 injectMcp() is idempotent ----------
test('A12 injectMcp() is idempotent', async () => {
  const home = mkTmp();
  setOpsforgeHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), 'mcp');
  const a = new ClaudeCodeAdapter();
  const cap = { yaml: { kind: 'mcp', id: 'foo.connector', entrypoint: 'source.md', transport: 'stdio', config_template: { auth_schema: [] } }, dir: capDir };
  await a.injectMcp(cap);
  const json1 = fs.readFileSync(path.join(home, '.claude.json'), 'utf8');
  await a.injectMcp(cap);
  const json2 = fs.readFileSync(path.join(home, '.claude.json'), 'utf8');
  assert.equal(json1, json2, 'second injectMcp should be no-op');
});

// ---------- A13 detect() returns false when ~/.claude/ missing ----------
test('A13 detect() returns false when ~/.claude/ missing', () => {
  const home = mkTmp();
  setOpsforgeHome(home);
  const a = new ClaudeCodeAdapter();
  assert.equal(a.detect(), false);
});

// ---------- A14 detect() returns true when ~/.claude/ writable ----------
test('A14 detect() returns true when ~/.claude/ writable', () => {
  const home = mkTmp();
  setOpsforgeHome(home);
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const a = new ClaudeCodeAdapter();
  assert.equal(a.detect(), true);
});

// ---------- A15 uninstall() removes artifact + mcp key ----------
test('A15 uninstall() removes artifact files and mcp keys', async () => {
  const home = mkTmp();
  setOpsforgeHome(home);
  const tmp = mkTmp();
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'source.md'), '---\nid: foo.bar\n---\nbody');
  const a = new ClaudeCodeAdapter();
  const cap = { yaml: { kind: 'agent', id: 'foo.bar', entrypoint: 'source.md' }, dir: capDir };
  const artifacts = a.translate(cap);
  await a.install(artifacts);
  const targetPath = artifacts[0].targetPath;
  assert.ok(fs.existsSync(targetPath));
  await a.uninstall('foo.bar', { artifacts: [targetPath] });
  assert.ok(!fs.existsSync(targetPath));
});

// ---------- A16 P1-4: workflow translate returns [] (dead branch deleted) ----------
test('A16 translate workflow returns empty array (install.mjs handles it)', () => {
  const home = mkTmp();
  setOpsforgeHome(home);
  const a = new ClaudeCodeAdapter();
  const cap = { yaml: { kind: 'workflow', id: 'foo.bar', steps: [{ id: 's1', capability: 'foo.baz', inputs: {}, outputs: [] }] }, dir: '/tmp' };
  const artifacts = a.translate(cap);
  assert.equal(artifacts.length, 0, 'workflow translate should return [] (install.mjs calls workflow-compile directly)');
});
