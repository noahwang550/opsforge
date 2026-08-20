// adapters/codex/adapter.test.mjs — CodexAdapter (Tier 1, 全原生落盘) TDD tests.
// 覆盖 docs/codex-compat-gap-analysis.md 的四类原生落点 + TOML 块级 merge。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  CodexAdapter,
  adapter,
  toCodexAgentToml,
  renderCodexWorkflowPrompt,
  renderMcpServerBlockToml,
  upsertMcpServerBlock,
  deleteMcpServerBlock,
} from './adapter.mjs';
import { parseCapability } from '../../tools/validate.mjs';
import { install as runInstall } from '../../install.mjs';

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-codex-')); }
function setHome(tmp) { process.env.OPSFORGE_HOME = tmp; }

function mkAgentCap(tmp, home = mkTmp()) {
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

function mkSkillCap(tmp, home = mkTmp(), { withScripts = true, id = 'itl-eng.coder' } = {}) {
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'SKILL.md'), [
    '---',
    'name: ' + id.replace('.', '-'),
    'description: coder skill',
    '---',
    '',
    '# coder',
    '',
    '## 能力说明',
    '',
    '说明文字足够长，用于通过 validateCap 的最小长度检查。',
    '',
    '## 适用场景',
    '',
    '- 场景一：编写代码',
    '',
  ].join('\n'));
  if (withScripts) {
    const sDir = path.join(capDir, 'scripts');
    fs.mkdirSync(sDir, { recursive: true });
    fs.writeFileSync(path.join(sDir, 'run.mjs'), '// helper script');
  }
  // tests/ 与 CHANGELOG.md 不应被复制进 skill 目录
  fs.mkdirSync(path.join(capDir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(capDir, 'tests', 't.md'), 'test');
  fs.writeFileSync(path.join(capDir, 'CHANGELOG.md'), '# changelog');
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id, version: '0.1.0', kind: 'skill', pack: 'itl-eng', owner: 'x',
    display_name: 'Coder', display_name_zh: 'C', display_name_en: 'C',
    description: 'd', platforms: ['codex'],
    entrypoint: 'SKILL.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  return capDir;
}

function mkMcpCap(tmp, home = mkTmp(), { entrypoint = 'server.mjs', transport = 'stdio', auth = [], id = 'itl-eng.coder' } = {}) {
  const capDir = path.join(tmp, 'cap');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, entrypoint), entrypoint.endsWith('.mjs') ? '// mcp server' : 'mcp doc');
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id, version: '0.1.0', kind: 'mcp', pack: 'itl-eng', owner: 'x',
    display_name: 'Coder', display_name_zh: 'C', display_name_en: 'C',
    description: 'd', platforms: ['codex'],
    entrypoint, tests: 'tests/', changelog: 'CHANGELOG.md',
    transport, config_template: { auth_schema: auth }, tools: [],
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  return capDir;
}

// ---------------------------------------------------------------------------
// CX1 / CX2：矩阵与 tier
// ---------------------------------------------------------------------------

// CX1 tier() === 1（Tier1 六个能力点全部 supported）
test('CX1 CodexAdapter tier() returns 1', () => {
  assert.equal(new CodexAdapter().tier(), 1);
});

// CX2 新矩阵：agent_file/skill_file/slash_command 升 supported；三个诚实兜底保持 false
test('CX2 supports() declares Tier-1 matrix with honest fallbacks', () => {
  const a = new CodexAdapter();
  assert.equal(a.supports('prompt_exec').supported, true);
  assert.equal(a.supports('agent_file').supported, true);
  assert.equal(a.supports('skill_file').supported, true);
  assert.equal(a.supports('slash_command').supported, true);
  assert.equal(a.supports('mcp_config').supported, true);
  assert.equal(a.supports('config_dir_writable').supported, true);
  assert.equal(a.supports('workflow_orchestration').supported, false);
  assert.equal(a.supports('workflow_orchestration').fallback, 'manual-paste');
  assert.equal(a.supports('kb_mount').supported, false);
  assert.equal(a.supports('kb_mount').fallback, 'manual-paste');
  assert.equal(a.supports('feedback_hook').supported, false);
  assert.equal(a.supports('feedback_hook').fallback, 'manual-paste');
});

// CX3 conform() passes for valid agent (entrypoint exists)
test('CX3 conform() passes for valid agent', () => {
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  setHome(tmp);
  const a = new CodexAdapter();
  const r = a.conform(parseCapability(capDir));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// CX4 conform() fails on requires:hard workflow_orchestration（codex 不支持）
test('CX4 conform() fails when requires:hard workflow_orchestration', () => {
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  setHome(tmp);
  let y = fs.readFileSync(path.join(capDir, 'capability.yaml'), 'utf8');
  y = y.replace('depends_on: []', 'depends_on: []\nrequires:\n  - point: workflow_orchestration\n    severity: hard');
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), y);
  const a = new CodexAdapter();
  const r = a.conform(parseCapability(capDir));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('workflow_orchestration')));
});

// ---------------------------------------------------------------------------
// CX5 / CX6：translate
// ---------------------------------------------------------------------------

// CX5 agent → ~/.codex/agents/<slug>.toml（frontmatter 剥离 + TOML 转义）
test('CX5 translate() agent → agents/<slug>.toml with escaping', () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  // 反斜杠 + 双引号 + 三引号 run，验证转义顺序（\ 先行，再 """）
  fs.writeFileSync(path.join(capDir, 'source.md'), '---\nid: foo.bar\n---\nbody with C:\\temp path and "quotes" and a """ triple');
  const a = new CodexAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].kind, 'agent-file');
  assert.equal(artifacts[0].degradation, null);
  assert.equal(artifacts[0].targetPath, path.join(home, '.codex', 'agents', 'bar.toml'));
  const t = artifacts[0].content;
  assert.ok(t.startsWith('name = "bar"\n'), 'name line first');
  assert.ok(t.includes('developer_instructions = """\n'), 'multi-line body field');
  assert.ok(t.includes('C:\\\\temp'), 'backslash doubled');
  assert.ok(!t.includes('id: foo.bar'), 'frontmatter stripped');
  assert.ok(t.includes('body with'), 'body kept');
  // 未转义的 """ run 不得出现在 body 中（否则 TOML 字符串提前终止）
  const body = t.slice(t.indexOf('developer_instructions'));
  const inner = body.slice(body.indexOf('\n') + 1, body.lastIndexOf('\n"""'));
  const unescaped = inner.split('\\"""').join('');
  assert.ok(!unescaped.includes('"""'), 'no unescaped triple-quote run inside body');
  assert.ok(inner.includes('\\"""'), 'triple-quote run escaped as backslash+quotes');
});

// CX5b toCodexAgentToml 纯函数：description 单行化 + 控制字符剔除
test('CX5b toCodexAgentToml unit escaping', () => {
  const t = toCodexAgentToml('line1\nline2', 'slug', { description: 'multi\nline "desc"' });
  assert.ok(t.includes('description = "multi line \\"desc\\""'), 'description collapsed + quoted');
  const raw = toCodexAgentToml('no frontmatter', 'slug', { description: 'd' });
  assert.ok(raw.includes('no frontmatter'));
});

// CX6 translate() mcp → mcp-config-merge（由 injectMcp 处理 config.toml）
test('CX6 translate() mcp → mcp-config-merge', () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkMcpCap(tmp);
  const a = new CodexAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  assert.equal(artifacts[0].kind, 'mcp-config-merge');
  assert.equal(artifacts[0].mcpConfig, null);
});

// ---------------------------------------------------------------------------
// CX7 / CX13 / CX14：install 真实落盘
// ---------------------------------------------------------------------------

// CX7 install() 真实写入 agent toml（非 manual-paste）
test('CX7 install() writes agent toml to ~/.codex/agents/', async () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkAgentCap(tmp);
  const a = new CodexAdapter();
  const artifacts = a.translate(parseCapability(capDir));
  const r = await a.install(artifacts);
  const target = path.join(home, '.codex', 'agents', 'bar.toml');
  assert.deepEqual(r.artifacts, [target]);
  const written = fs.readFileSync(target, 'utf8');
  assert.ok(written.includes('name = "bar"'));
  assert.ok(written.includes('agent body content'));
});

// CX13 skill → 目录落盘（SKILL.md + scripts/，不含 tests/CHANGELOG），~/.agents 镜像只探测不创建
test('CX13 skill install copies SKILL.md + scripts/, mirrors only when ~/.agents/skills exists', async () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkSkillCap(tmp);
  const a = new CodexAdapter();

  // 无 ~/.agents/skills → 单 artifact，不创建镜像根
  const artifacts = a.translate(parseCapability(capDir));
  assert.equal(artifacts.length, 1, 'no mirror when ~/.agents/skills absent');
  const r = await a.install(artifacts);
  const skillDir = path.join(home, '.codex', 'skills', 'coder');
  assert.deepEqual(r.artifacts, [skillDir]);
  assert.ok(fs.existsSync(path.join(skillDir, 'SKILL.md')), 'SKILL.md copied');
  assert.ok(fs.existsSync(path.join(skillDir, 'scripts', 'run.mjs')), 'scripts/ copied');
  assert.ok(!fs.existsSync(path.join(skillDir, 'tests')), 'tests/ excluded');
  assert.ok(!fs.existsSync(path.join(skillDir, 'CHANGELOG.md')), 'CHANGELOG excluded');
  assert.ok(!fs.existsSync(path.join(home, '.agents')), 'mirror root not created');

  // 预建 ~/.agents/skills → 追加镜像 artifact
  fs.mkdirSync(path.join(home, '.agents', 'skills'), { recursive: true });
  const artifacts2 = a.translate(parseCapability(capDir));
  assert.equal(artifacts2.length, 2, 'mirror artifact added when root exists');
  assert.equal(artifacts2[1].targetPath, path.join(home, '.agents', 'skills', 'coder'));
  const r2 = await a.install(artifacts2);
  assert.equal(r2.artifacts.length, 2);
  assert.ok(fs.existsSync(path.join(home, '.agents', 'skills', 'coder', 'SKILL.md')), 'mirror SKILL.md');
  assert.ok(fs.existsSync(path.join(home, '.agents', 'skills', 'coder', 'scripts', 'run.mjs')), 'mirror scripts/');
});

// CX14 workflow → ~/.codex/prompts/workflow-<name>.md（确定性内容，无 source 也能落）
test('CX14 translate() workflow → prompts/workflow-<name>.md', async () => {
  const home = mkTmp(); setHome(home);
  const wfYaml = {
    id: 'itl-eng.pipe', version: '0.1.0', kind: 'workflow', pack: 'itl-eng', owner: 'x',
    display_name: 'Pipe', description: 'pipe desc',
    steps: [{ id: 's1', capability: 'itl-eng.coder', inputs: { repo: 'opsforge' }, outputs: ['report'] }],
  };
  const a = new CodexAdapter();
  const artifacts = a.translate({ yaml: wfYaml, dir: mkTmp() });
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].kind, 'workflow-prompt');
  assert.equal(artifacts[0].degradation, null);
  assert.equal(artifacts[0].targetPath, path.join(home, '.codex', 'prompts', 'workflow-pipe.md'));
  const c = artifacts[0].content;
  assert.ok(c.includes('# Workflow: Pipe'));
  assert.ok(c.includes('`itl-eng.coder`'));
  assert.ok(c.includes('1. **s1**'));
  const r = await a.install(artifacts);
  assert.deepEqual(r.artifacts, [artifacts[0].targetPath]);
  assert.equal(fs.readFileSync(artifacts[0].targetPath, 'utf8'), c);
});

// CX14b renderCodexWorkflowPrompt 无 steps/无 display_name 兜底（不 throw）
test('CX14b workflow prompt renders without steps', () => {
  const c = renderCodexWorkflowPrompt({ id: 'itl-eng.pipe', steps: [] }, 'pipe');
  assert.ok(c.includes('# Workflow: pipe'), 'falls back to slug name');
  assert.ok(c.includes('Persist per-run state'));
});

// ---------------------------------------------------------------------------
// CX8 / CX15 / CX16：injectMcp + TOML merge
// ---------------------------------------------------------------------------

// CX8 injectMcp() → ~/.codex/config.toml 块级 upsert（既有表保留 / env_vars / win32 包装 / note）
test('CX8 injectMcp() upserts [mcp_servers.*] block in config.toml', async () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const cfgPath = path.join(home, '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, 'shell = "bash"\n\n[mcp_servers.other]\ncommand = "x"\n');

  // 可执行 entrypoint + auth_schema → 无 note、有 env_vars
  const capDir = mkMcpCap(tmp, home, { entrypoint: 'server.mjs', auth: ['API_KEY'] });
  const a = new CodexAdapter();
  const r = await a.injectMcp(parseCapability(capDir));
  assert.ok(r.mcp_keys.includes('coder'));
  const after = fs.readFileSync(cfgPath, 'utf8');
  assert.ok(after.includes('shell = "bash"'), 'existing top-level key preserved');
  assert.ok(after.includes('[mcp_servers.other]'), 'existing server table preserved');
  assert.ok(after.includes('[mcp_servers.coder]'), 'new server table added');
  assert.ok(after.includes('env_vars = ["API_KEY"]'), 'auth_schema → env_vars');
  assert.ok(!after.includes('opsforge-note'), 'executable entrypoint → no note');
  if (process.platform === 'win32') {
    assert.ok(after.includes('command = "cmd"'), 'win32 wraps via cmd');
    assert.ok(after.includes('"/c",'), 'win32 /c arg');
  } else {
    assert.ok(after.includes('command = "node"'), 'non-win32 direct node');
  }
  // 路径用 TOML literal string（单引号，反斜杠不转义）
  assert.ok(/args = \[\n[\s\S]*?'[^']*server\.mjs',/.test(after), 'literal-quoted abs path in args');

  // 非可执行 entrypoint（source.md）→ 块上方 opsforge-note 注释行
  const capDir2 = mkMcpCap(mkTmp(), home, { entrypoint: 'source.md' });
  await a.injectMcp(parseCapability(capDir2));
  const after2 = fs.readFileSync(cfgPath, 'utf8');
  const noteIdx = after2.indexOf('# opsforge-note:');
  const hdrIdx = after2.indexOf('[mcp_servers.coder]');
  assert.ok(noteIdx !== -1 && noteIdx < hdrIdx, 'note comment above block');
  assert.ok(after2.includes('示例性 MCP'), 'EXAMPLE_MCP_NOTE text');
});

// CX15 TOML 块级 merge 边界集
test('CX15 TOML block upsert/delete boundary set', () => {
  const block = renderMcpServerBlockToml('node_repl', { id: 'x.node_repl', entrypoint: 'server.mjs', transport: 'stdio' }, '/cap');

  // 15a 空文件起步
  const fromEmpty = upsertMcpServerBlock('', 'node_repl', block);
  assert.ok(fromEmpty.startsWith('[mcp_servers.node_repl]\n'), 'empty file → block only');

  // 15b 二次 upsert 幂等
  const once = upsertMcpServerBlock(fromEmpty, 'node_repl', block);
  const twice = upsertMcpServerBlock(once, 'node_repl', block);
  assert.equal(twice, once, 'idempotent');

  // 15c 既有内容字节级保留（多行数组 + 单双引号混合 + 其他表 + 既有 note 吞并）
  const existing = [
    '# my config',
    'shell = "bash"',
    '',
    '[shell_environment_policy]',
    'inherit = "core"',
    'exclude = [',
    "    '*KEY*',",
    ']',
    '',
    '# opsforge-note: codex-keep',
    '[mcp_servers.node_repl]',
    'command = "cmd"',
    '',
    '[shell]',
    "path = 'C:\\bin\\bash.exe'",
    '',
  ].join('\n');
  const after = upsertMcpServerBlock(existing, 'node_repl', block);
  assert.ok(after.includes("[shell_environment_policy]\ninherit = \"core\"\nexclude = [\n    '*KEY*',\n]"), 'other table byte-preserved');
  assert.ok(after.includes("path = 'C:\\bin\\bash.exe'"), 'literal string preserved');
  assert.ok(!after.includes('# opsforge-note: codex-keep'), 'stale note swallowed with old block');
  assert.ok(after.indexOf('[shell_environment_policy]') < after.indexOf('[mcp_servers.node_repl]'), 'order kept');
  assert.ok(after.endsWith("path = 'C:\\bin\\bash.exe'\n"), 'tail intact');

  // 15d .env 子表随主表一起替换/删除
  const withSub = '[mcp_servers.node_repl]\ncommand = "node"\n\n[mcp_servers.node_repl.env]\nA = "1"\n\n[mcp_servers.keep]\ncommand = "y"\n';
  const afterSub = upsertMcpServerBlock(withSub, 'node_repl', block);
  assert.ok(!afterSub.includes('[mcp_servers.node_repl.env]'), 'sub-table swallowed on replace');
  assert.ok(afterSub.includes('[mcp_servers.keep]'), 'other server kept');
  const afterDel = deleteMcpServerBlock(withSub, 'node_repl');
  assert.ok(!afterDel.includes('node_repl'), 'delete removes block + sub-table');
  assert.ok(afterDel.includes('[mcp_servers.keep]\ncommand = "y"'), 'delete keeps others');

  // 15e 脱敏真实 config.toml 形态 fixture（win32 包装 + env_vars + 多服务器）
  const real = [
    'model = "gpt-5"',
    '',
    '[mcp_servers.bi-connector]',
    'command = "cmd"',
    'args = [',
    '    "/c",',
    '    "node",',
    "    'C:\\Users\\demo\\connector\\server.mjs',",
    ']',
    'env_vars = ["BI_API_KEY"]',
    '',
    '[mcp_servers.node_repl]',
    'command = "cmd"',
    '',
    '[mcp_servers.node_repl.env]',
    'NODE_REPL = "1"',
    '',
  ].join('\n');
  const merged = upsertMcpServerBlock(real, 'bi-connector', renderMcpServerBlockToml('bi-connector', { id: 'x.bi-connector', entrypoint: 'server.mjs', transport: 'stdio', config_template: { auth_schema: ['BI_API_KEY'] } }, '/cap'));
  assert.ok(merged.includes('model = "gpt-5"'), 'top-level key kept');
  assert.ok(merged.includes('[mcp_servers.node_repl.env]'), 'unrelated sub-table kept');
  assert.ok(merged.includes('env_vars = ["BI_API_KEY"]'), 'auth re-injected');
  assert.equal(upsertMcpServerBlock(merged, 'bi-connector', renderMcpServerBlockToml('bi-connector', { id: 'x.bi-connector', entrypoint: 'server.mjs', transport: 'stdio', config_template: { auth_schema: ['BI_API_KEY'] } }, '/cap')), merged, 'idempotent on real-shape fixture');

  // 15f delete 幂等 + 尾部空行修剪
  const del = deleteMcpServerBlock('[mcp_servers.a]\ncommand = "x"\n', 'a');
  assert.equal(del, '', 'single block file → empty');
  assert.equal(deleteMcpServerBlock(del, 'a'), del, 'delete idempotent');
});

// CX16 非 stdio transport → fail-loud
test('CX16 injectMcp() throws on non-stdio transport', async () => {
  const home = mkTmp(); setHome(home);
  const tmp = mkTmp();
  const capDir = mkMcpCap(tmp, home, { transport: 'sse' });
  const a = new CodexAdapter();
  await assert.rejects(() => a.injectMcp(parseCapability(capDir)), /stdio/);
});

// CX16b renderMcpServerBlockToml 直接 throw
test('CX16b renderMcpServerBlockToml throws on non-stdio', () => {
  assert.throws(() => renderMcpServerBlockToml('x', { entrypoint: 's.mjs', transport: 'http' }, '/d'), /not supported/);
});

// ---------------------------------------------------------------------------
// CX9 / CX10 / CX11 / CX17：detect / uninstall / 导出 / 全链路
// ---------------------------------------------------------------------------

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

// CX10 uninstall() 删 mcp 块（含 note + 子表），其他内容保留
test('CX10 uninstall() removes mcp block (note + sub-table), keeps others', async () => {
  const home = mkTmp(); setHome(home);
  const cfgPath = path.join(home, '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, [
    'shell = "bash"',
    '',
    '# opsforge-note: 示例性 MCP',
    '[mcp_servers.connector]',
    'command = "node"',
    '',
    '[mcp_servers.connector.env]',
    'A = "1"',
    '',
    '[mcp_servers.keep]',
    'command = "y"',
    '',
  ].join('\n'));
  const a = new CodexAdapter();
  await a.uninstall('foo.connector', { mcp_keys: ['connector'] });
  const after = fs.readFileSync(cfgPath, 'utf8');
  assert.ok(!after.includes('[mcp_servers.connector]'), 'block removed');
  assert.ok(!after.includes('[mcp_servers.connector.env]'), 'sub-table removed');
  assert.ok(!after.includes('opsforge-note'), 'note removed');
  assert.ok(after.includes('[mcp_servers.keep]'), 'other server preserved');
  assert.ok(after.includes('shell = "bash"'), 'top-level key preserved');
});

// CX11 default adapter instance exported
test('CX11 default adapter instance exported', () => {
  assert.ok(adapter instanceof CodexAdapter);
  assert.equal(adapter.platform, 'codex');
});

// CX17 全链路 install → doctor 断言四落点 → uninstall 无残留 + config.toml 还原
test('CX17 full install → uninstall round-trip leaves no residue', async () => {
  const tmp = mkTmp(); setHome(tmp);
  const home = tmp;
  // agent
  const agentDir = mkAgentCap(tmp, tmp);
  await runInstall({ platform: 'codex', capId: 'foo.bar', capDir: agentDir, opsforgeHome: tmp, repoRoot: tmp });
  const agentToml = path.join(home, '.codex', 'agents', 'bar.toml');
  assert.ok(fs.existsSync(agentToml), 'agent toml landed');

  // skill（无 ~/.agents → 单落点）
  const tmp2 = mkTmp();
  const skillCapDir = mkSkillCap(tmp2, tmp, { id: 'itl-eng.coderskill' });
  await runInstall({ platform: 'codex', capId: 'itl-eng.coderskill', capDir: skillCapDir, opsforgeHome: tmp, repoRoot: tmp2 });
  const skillDir = path.join(home, '.codex', 'skills', 'coderskill');
  assert.ok(fs.existsSync(path.join(skillDir, 'SKILL.md')), 'skill dir landed');
  assert.ok(fs.existsSync(path.join(skillDir, 'scripts', 'run.mjs')), 'skill scripts landed');

  // mcp
  const tmp3 = mkTmp();
  const mcpCapDir = mkMcpCap(tmp3, tmp, { entrypoint: 'server.mjs' });
  const cfgPath = path.join(home, '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, 'shell = "bash"\n');
  const beforeCfg = fs.readFileSync(cfgPath, 'utf8');
  await runInstall({ platform: 'codex', capId: 'itl-eng.coder', capDir: mcpCapDir, opsforgeHome: tmp, repoRoot: tmp3 });
  const midCfg = fs.readFileSync(cfgPath, 'utf8');
  assert.ok(midCfg.includes('[mcp_servers.coder]'), 'mcp block landed');

  // uninstall（agent + skill + mcp），mcp 走 manifest 记录的 mcp_keys
  const { uninstall: runUninstall } = await import('../../install.mjs');
  await runUninstall({ platform: 'codex', capId: 'foo.bar', opsforgeHome: tmp });
  await runUninstall({ platform: 'codex', capId: 'itl-eng.coderskill', opsforgeHome: tmp });
  await runUninstall({ platform: 'codex', capId: 'itl-eng.coder', opsforgeHome: tmp });
  assert.ok(!fs.existsSync(agentToml), 'agent toml removed');
  assert.ok(!fs.existsSync(skillDir), 'skill dir removed');
  const finalCfg = fs.readFileSync(cfgPath, 'utf8');
  assert.ok(!finalCfg.includes('mcp_servers.coder'), 'mcp block removed');
  assert.equal(finalCfg, beforeCfg, 'config.toml byte-restored');
});