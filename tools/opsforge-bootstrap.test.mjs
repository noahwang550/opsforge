// tools/opsforge-bootstrap.test.mjs — Phase 3.6 落点 1: bootstrap idempotency +
// multi-platform config dir + artifact landing + path safety + 副本真跑. TDD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { bootstrap } from './opsforge-bootstrap.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-boot-'));
}

/** withHome: run fn with OPSFORGE_HOME isolated to a tmp home; always restore (NIT 6). */
async function withHome(home, fn) {
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  try {
    return await fn();
  } finally {
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
}

/** Build a minimal fixture repo containing the 3 opsforge-meta caps + runtime stubs. */
function buildFixtureRepo(root) {
  // registry + registry-brands
  fs.writeFileSync(path.join(root, 'registry.yaml'), yaml.dump({
    capabilities: {
      'opsforge-meta.opsforge': { current: '1.0.0' },
      'opsforge-meta.opsforge-wizard': { current: '1.0.0' },
      'opsforge-meta.opsforge-installer': { current: '1.0.0' },
    },
  }));
  fs.writeFileSync(path.join(root, 'registry-brands.yaml'), yaml.dump({ brands: {} }));
  // runtime subtree stubs (bootstrap copies these byte-for-byte; content not executed here)
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools', 'opsforge-runtime.mjs'), '// opsforge-runtime.mjs fixture\n');
  fs.writeFileSync(path.join(root, 'tools', 'paths.mjs'), '// paths.mjs fixture\n');

  // 3 caps under packs/opsforge-meta/
  const agentDir = path.join(root, 'packs', 'opsforge-meta', 'agents', 'opsforge');
  const installerDir = path.join(root, 'packs', 'opsforge-meta', 'agents', 'opsforge-installer');
  const skillDir = path.join(root, 'packs', 'opsforge-meta', 'skills', 'opsforge-wizard');
  for (const d of [agentDir, installerDir, skillDir]) {
    fs.mkdirSync(d, { recursive: true });
    fs.mkdirSync(path.join(d, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(d, 'CHANGELOG.md'), `# changelog\n`);
  }
  // agent: opsforge (menu)
  fs.writeFileSync(path.join(agentDir, 'capability.yaml'), yaml.dump({
    id: 'opsforge-meta.opsforge', version: '1.0.0', kind: 'agent', pack: 'opsforge-meta',
    owner: 'steering', display_name: 'OpsForge', display_name_zh: 'OpsForge 向导',
    display_name_en: 'OpsForge', description: 'top menu agent that launches the opsforge wizard',
    platforms: ['claude-code'], entrypoint: 'source.md', tests: 'tests/',
    changelog: 'CHANGELOG.md', depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  fs.writeFileSync(path.join(agentDir, 'source.md'),
    '---\nid: opsforge-meta.opsforge\n---\nYou are the OpsForge top-menu agent. Launch the wizard via @opsforge-wizard.');
  // agent: opsforge-installer
  fs.writeFileSync(path.join(installerDir, 'capability.yaml'), yaml.dump({
    id: 'opsforge-meta.opsforge-installer', version: '1.0.0', kind: 'agent', pack: 'opsforge-meta',
    owner: 'steering', display_name: 'OpsForge Installer',
    display_name_zh: 'OpsForge 安装器', display_name_en: 'OpsForge Installer',
    description: 'installer agent that wraps bootstrap and runtime calls for non-cwd platforms',
    platforms: ['claude-code'], entrypoint: 'source.md', tests: 'tests/',
    changelog: 'CHANGELOG.md', depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  fs.writeFileSync(path.join(installerDir, 'source.md'),
    '---\nid: opsforge-meta.opsforge-installer\n---\nYou are the OpsForge installer agent. Call bootstrap then runtime.');
  // skill: opsforge-wizard
  const skillFm = [
    '---',
    'id: opsforge-meta.opsforge-wizard',
    'version: 1.0.0',
    'kind: skill',
    'pack: opsforge-meta',
    'owner: steering',
    'display_name: OpsForge Wizard',
    'display_name_zh: OpsForge 向导',
    'display_name_en: OpsForge Wizard',
    'description: interactive wizard skill that guides business authors through capability creation',
    'platforms: [claude-code]',
    'entrypoint: SKILL.md',
    'tests: tests/',
    'changelog: CHANGELOG.md',
    'depends_on: []',
    'source:',
    '  origin: original',
    '  upstream_ref: null',
    '---',
    'You are the OpsForge wizard skill. Present the 6-option top menu in Chinese.',
  ].join('\n');
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillFm);
  // tests (3 cases each, non-trivial)
  for (const [d, prefix] of [[agentDir, 'a'], [installerDir, 'i'], [skillDir, 's']]) {
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(path.join(d, 'tests', `case-0${i+1}.yaml`), yaml.dump({
        name: `${prefix}-case-0${i+1}`, input: { q: `q${i}` }, expect: 'exact',
        expected: `resp ${i} with substance`,
      }));
    }
  }
  return root;
}

// BT1: bootstrap installs the opsforge-meta caps into the platform config dir.
test('BT1 bootstrap installs opsforge-meta caps into platform config dir', async () => {
  const repo = mkTmp();
  const home = mkTmp();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  buildFixtureRepo(repo);
  await withHome(home, () => bootstrap({ platform: 'claude-code', project: 'default', repoRoot: repo, opsforgeHome: home }));
  assert.ok(fs.existsSync(path.join(home, '.claude', 'agents', 'opsforge.md')), 'opsforge agent file');
  assert.ok(fs.existsSync(path.join(home, '.claude', 'agents', 'opsforge-installer.md')), 'opsforge-installer agent file');
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'opsforge-wizard', 'SKILL.md')), 'opsforge-wizard skill file');
});

// BT2: bootstrap is idempotent — second call does not rewrite (content-hash compare).
test('BT2 bootstrap is idempotent (second call skips rewrites)', async () => {
  const repo = mkTmp();
  const home = mkTmp();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  buildFixtureRepo(repo);
  await withHome(home, () => bootstrap({ platform: 'claude-code', repoRoot: repo, opsforgeHome: home }));
  const r2 = await withHome(home, () => bootstrap({ platform: 'claude-code', repoRoot: repo, opsforgeHome: home }));
  assert.ok(!r2.rewritten || r2.rewritten.length === 0, 'second bootstrap should not rewrite any runtime file');
  assert.ok(r2.copied.length === 0 || r2.skipped.length > 0, 'runtime files already present — copy skipped');
});

// BT3: bootstrap copies runtime wrapper (layout-preserving) + registry (flat) + .runtime-root.json.
test('BT3 bootstrap copies runtime tree + registry flat + runtime-root.json', async () => {
  const repo = mkTmp();
  const home = mkTmp();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  buildFixtureRepo(repo);
  await withHome(home, () => bootstrap({ platform: 'claude-code', repoRoot: repo, opsforgeHome: home }));
  // runtime subtree preserves layout under runtime/tools/
  assert.ok(fs.existsSync(path.join(home, 'runtime', 'tools', 'opsforge-runtime.mjs')), 'opsforge-runtime.mjs copied to runtime/tools/');
  assert.ok(fs.existsSync(path.join(home, 'runtime', 'tools', 'paths.mjs')), 'paths.mjs copied to runtime/tools/');
  // registry flat at home root (install.mjs readRegistryForInstall home fallback reads here)
  assert.ok(fs.existsSync(path.join(home, 'registry.yaml')), 'registry.yaml copied flat to home root');
  assert.ok(fs.existsSync(path.join(home, 'registry-brands.yaml')), 'registry-brands.yaml copied flat');
  // .runtime-root.json records the repo root
  assert.ok(fs.existsSync(path.join(home, '.runtime-root.json')), '.runtime-root.json written');
  const root = JSON.parse(fs.readFileSync(path.join(home, '.runtime-root.json'), 'utf8'));
  assert.equal(root.runtimeRoot, repo, '.runtime-root.json points to bootstrap repo root');
});

// BT4: bootstrap rejects an invalid platform (path/adapter safety).
test('BT4 bootstrap rejects unknown platform', async () => {
  const repo = mkTmp();
  const home = mkTmp();
  buildFixtureRepo(repo);
  await assert.rejects(() => withHome(home, () => bootstrap({ platform: 'bogus-platform', repoRoot: repo, opsforgeHome: home })));
});

// BT5: bootstrap with no caps present (empty repo) does not throw — graceful skip (ENOCAPSOURCE).
test('BT5 bootstrap gracefully handles missing opsforge-meta caps', async () => {
  const repo = mkTmp();
  const home = mkTmp();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  // no caps, just runtime files
  fs.writeFileSync(path.join(repo, 'registry.yaml'), 'capabilities: {}\n');
  fs.writeFileSync(path.join(repo, 'registry-brands.yaml'), 'brands: {}\n');
  fs.mkdirSync(path.join(repo, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tools', 'opsforge-runtime.mjs'), '// x\n');
  fs.writeFileSync(path.join(repo, 'tools', 'paths.mjs'), '// x\n');
  const r = await withHome(home, () => bootstrap({ platform: 'claude-code', repoRoot: repo, opsforgeHome: home }));
  assert.equal(r.installed.length, 0, 'no caps to install');
  assert.ok(r.copied.length >= 4, 'runtime files still copied');
});

// BT6: bootstrap against the REAL repo installs the 3 opsforge-meta caps (eat own dogfood).
test('BT6 bootstrap installs real opsforge-meta caps from the repo', async () => {
  const home = mkTmp();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  await withHome(home, async () => {
    const r = await bootstrap({ platform: 'claude-code', repoRoot: REPO_ROOT, opsforgeHome: home });
    assert.equal(r.installed.length, 3, 'should install all 3 meta caps');
    assert.ok(fs.existsSync(path.join(home, '.claude', 'agents', 'opsforge.md')), 'real opsforge agent');
    assert.ok(fs.existsSync(path.join(home, '.claude', 'agents', 'opsforge-installer.md')), 'real installer agent');
    assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'opsforge-wizard', 'SKILL.md')), 'real wizard skill');
    // runtime subtree + runtime-root from real repo
    assert.ok(fs.existsSync(path.join(home, 'runtime', 'tools', 'opsforge-runtime.mjs')), 'real opsforge-runtime.mjs copied');
    assert.ok(fs.existsSync(path.join(home, 'runtime', 'tools', 'paths.mjs')), 'real paths.mjs copied');
    assert.ok(fs.existsSync(path.join(home, 'registry.yaml')), 'real registry.yaml copied');
    const root = JSON.parse(fs.readFileSync(path.join(home, '.runtime-root.json'), 'utf8'));
    assert.equal(root.runtimeRoot, REPO_ROOT, 'runtime-root points to real repo');
  });
});

// BT7 CRITICAL 回归: 真跑 ~/.opsforge/ 副本 —— 从非仓库 cwd import 被复制的
// opsforge-runtime.mjs，调 runList/runInstall，断言不抛 ERR_MODULE_NOT_FOUND + 制品落盘。
test('BT7 runtime copy runs from ~/.opsforge/ in non-repo cwd (no ERR_MODULE_NOT_FOUND)', async () => {
  const home = mkTmp();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  // 1. bootstrap against the REAL repo → copies runtime wrapper + writes .runtime-root.json
  await withHome(home, () => bootstrap({ platform: 'claude-code', repoRoot: REPO_ROOT, opsforgeHome: home }));
  // 2. build a fixture capability repo (source of the cap to install)
  const capRepo = mkTmp();
  for (const d of ['templates', 'schema', 'tools', 'packs']) fs.mkdirSync(path.join(capRepo, d), { recursive: true });
  const capDir = path.join(capRepo, 'packs', 'foo', 'agents', 'bar');
  fs.mkdirSync(path.join(capDir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'foo.bar', version: '1.0.0', kind: 'agent', pack: 'foo', owner: 'foo',
    display_name: 'Bar', display_name_zh: 'Bar', display_name_en: 'Bar',
    description: 'desc', platforms: ['claude-code'], entrypoint: 'source.md',
    tests: 'tests/', changelog: 'CHANGELOG.md', depends_on: [],
    source: { origin: 'original', upstream_ref: null },
  }));
  fs.writeFileSync(path.join(capDir, 'source.md'), '---\nid: foo.bar\n---\nagent body content here.');
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(capDir, 'tests', `case-0${i+1}.yaml`), yaml.dump({ name: `c${i}`, input: `i${i}`, expect: 'exact', expected: `e${i}` }));
  fs.writeFileSync(path.join(capDir, 'CHANGELOG.md'), '# bar\n');
  // 3. switch to a NON-repo cwd (simulates platform installer agent running outside the repo)
  const nonRepoCwd = mkTmp();
  const origCwd = process.cwd();
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  process.chdir(nonRepoCwd);
  try {
    // 4. import the COPIED runtime module (not the repo one) — URL-distinct from repo module
    const copiedRuntimeUrl = pathToFileURL(path.join(home, 'runtime', 'tools', 'opsforge-runtime.mjs')).href;
    const mod = await import(copiedRuntimeUrl);
    // 5. runList must not throw ERR_MODULE_NOT_FOUND — delegates to repo install.mjs via .runtime-root.json
    const listResult = await mod.runList({ project: 'default', opsforgeHome: home });
    assert.ok(Array.isArray(listResult.list), 'runList returns a list array');
    // 6. runInstall installs a real cap from capRepo → artifact lands at home/.claude/agents/bar.md
    const instResult = await mod.runInstall({ capId: 'foo.bar', project: 'default', workDir: capRepo, opsforgeHome: home, platform: 'claude-code' });
    assert.ok(instResult.installed.length > 0, 'runInstall installed artifacts');
    assert.ok(fs.existsSync(path.join(home, '.claude', 'agents', 'bar.md')), 'real agent artifact landed');
  } finally {
    process.chdir(origCwd);
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
});
