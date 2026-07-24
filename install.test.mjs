// install.test.mjs — Phase 1.4: install.mjs tests (IN1–IN12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { install, uninstall, list, doctor } from './install.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INSTALL_MJS = path.resolve(__dirname, 'install.mjs');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-inst-'));
}

function mkRepo(tmp) {
  // Create a minimal repo with a released agent capability
  const capDir = path.join(tmp, 'packs', 'foo', 'agents', 'bar');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'foo.bar', version: '1.0.0', kind: 'agent', pack: 'foo', owner: 'foo',
    display_name: 'Bar', display_name_zh: 'Bar', display_name_en: 'Bar',
    description: 'desc', platforms: ['claude-code'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  fs.writeFileSync(path.join(capDir, 'source.md'), '---\nid: foo.bar\n---\nThis is the agent body content for testing.');
  fs.mkdirSync(path.join(capDir, 'tests'), { recursive: true });
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(capDir, 'tests', `case-0${i + 1}.yaml`), yaml.dump({
      name: `case-${i}`, input: `input-${i}`, expect: 'exact', expected: `result-${i}`,
    }));
  }
  fs.writeFileSync(path.join(capDir, 'CHANGELOG.md'), '# bar\n');
  return { tmp, capDir };
}

// IN1 install writes artifacts to ~/.claude/
test('IN1 install writes agent artifact to ~/.claude/agents/', async () => {
  const { tmp } = mkRepo(mkTmp());
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  const r = await install({ platform: 'claude-code', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home });
  assert.ok(r.installed.length > 0);
  const agentPath = path.join(home, '.claude', 'agents', 'bar.md');
  assert.ok(fs.existsSync(agentPath), 'agent file should exist');
});

// IN2 install writes manifest to ~/.opsforge/manifests/
test('IN2 install writes per-project manifest', async () => {
  const { tmp } = mkRepo(mkTmp());
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  await install({ platform: 'claude-code', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home, project: 'myproj' });
  const manifestPath = path.join(home, 'manifests', 'myproj.manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest should exist');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(m.manifest_version, '1');
  assert.equal(m.platform, 'claude-code');
  assert.ok(m.capabilities.find(c => c.id === 'foo.bar'));
});

// IN3 install is idempotent — second run no new files
test('IN3 install is idempotent', async () => {
  const { tmp } = mkRepo(mkTmp());
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  await install({ platform: 'claude-code', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home });
  const agentPath = path.join(home, '.claude', 'agents', 'bar.md');
  const content1 = fs.readFileSync(agentPath, 'utf8');
  await install({ platform: 'claude-code', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home });
  const content2 = fs.readFileSync(agentPath, 'utf8');
  assert.equal(content1, content2, 'second install should not change content');
});

// IN4 uninstall removes artifacts
test('IN4 uninstall removes agent artifact', async () => {
  const { tmp } = mkRepo(mkTmp());
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  await install({ platform: 'claude-code', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home });
  const agentPath = path.join(home, '.claude', 'agents', 'bar.md');
  assert.ok(fs.existsSync(agentPath));
  await uninstall({ platform: 'claude-code', capId: 'foo.bar', opsforgeHome: home });
  assert.ok(!fs.existsSync(agentPath), 'agent file should be removed');
});

// IN5 list returns installed capabilities
test('IN5 list returns installed capabilities', async () => {
  const { tmp } = mkRepo(mkTmp());
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  await install({ platform: 'claude-code', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home });
  const r = await list({ platform: 'claude-code', opsforgeHome: home });
  assert.ok(r.list.find(c => c.id === 'foo.bar'));
});

// IN6 doctor reports healthy when all installed
test('IN6 doctor reports healthy when all good', async () => {
  const { tmp } = mkRepo(mkTmp());
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  await install({ platform: 'claude-code', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home });
  const r = await doctor({ platform: 'claude-code', opsforgeHome: home });
  assert.equal(r.healthy, true, `issues: ${JSON.stringify(r.issues)}`);
});

// IN7 install throws on unknown capId
test('IN7 install throws on unknown capId', async () => {
  const tmp = mkTmp();
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  await assert.rejects(() => install({ platform: 'claude-code', capId: 'nonexistent.cap', repoRoot: tmp, opsforgeHome: home }), /not found/);
});

// IN8 install throws on invalid capId (path traversal)
test('IN8 install throws on invalid capId', async () => {
  const tmp = mkTmp();
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  await assert.rejects(() => install({ platform: 'claude-code', capId: '../etc/passwd', repoRoot: tmp, opsforgeHome: home }), /path-guard|invalid/i);
});

// IN8b P1-2: install throws on invalid --brand (path traversal)
test('IN8b install throws on invalid brand (path traversal)', async () => {
  const tmp = mkTmp();
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  await assert.rejects(() => install({ platform: 'claude-code', capId: 'foo.bar', brand: '../etc', repoRoot: tmp, opsforgeHome: home }), /brand/);
});

// IN9 P0-1: uninstall via CLI with @version succeeds
test('IN9 uninstall via main() CLI with @version succeeds', () => {
  const { tmp } = mkRepo(mkTmp());
  const home = mkTmp();
  // Install first
  const ri = spawnSync(process.execPath, [INSTALL_MJS, '--install', 'foo.bar@1.0.0', '--platform', 'claude-code'], {
    env: { ...process.env, OPSFORGE_HOME: home }, cwd: tmp, encoding: 'utf8',
  });
  assert.equal(ri.status, 0, `install failed: ${ri.stderr}`);
  // Uninstall with @version — must succeed (P0-1 fix strips @version)
  const ru = spawnSync(process.execPath, [INSTALL_MJS, '--uninstall', 'foo.bar@1.0.0'], {
    env: { ...process.env, OPSFORGE_HOME: home }, cwd: tmp, encoding: 'utf8',
  });
  assert.equal(ru.status, 0, `uninstall failed: ${ru.stderr}`);
  assert.doesNotMatch(ru.stderr, /path-guard/i, 'must not reject @version');
});

// IN10 P0-2: workflow install expands ~ to real path
test('IN10 workflow install expands ~ in targetPath', async () => {
  const tmp = mkTmp();
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  // Create a workflow cap
  const wfDir = path.join(tmp, 'packs', 'foo', 'workflows', 'bar');
  fs.mkdirSync(wfDir, { recursive: true });
  fs.mkdirSync(path.join(wfDir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(wfDir, 'workflow.yaml'), yaml.dump({
    id: 'foo.bar', version: '1.0.0', kind: 'workflow', pack: 'foo', owner: 'foo',
    display_name: 'Bar', display_name_zh: 'Bar', display_name_en: 'Bar',
    description: 'desc', platforms: ['claude-code'],
    params_schema: 'params.schema.json',
    steps: [{ id: 's1', capability: 'foo.baz', inputs: {}, outputs: ['out'] }],
    outputs: {}, tests: 'tests/', changelog: 'CHANGELOG.md',
    source: { origin: 'original', upstream_ref: null },
  }));
  fs.writeFileSync(path.join(wfDir, 'CHANGELOG.md'), '# bar\n');
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(wfDir, 'tests', `case-0${i+1}.yaml`), yaml.dump({
      name: `case-${i}`, input: `input-${i}`, expect: 'exact', expected: `result-${i}`,
    }));
  }
  const r = await install({ platform: 'claude-code', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home });
  // Command file must exist at expanded path (NOT ~/.claude/... literal)
  const cmdPath = path.join(home, '.claude', 'commands', 'workflow-bar.md');
  assert.ok(fs.existsSync(cmdPath), `workflow command file should exist at ${cmdPath}`);
});

// IN11 P0-3: doctor expands ~ in artifact paths
test('IN11 doctor expands ~ in artifact paths and reports missing', async () => {
  const tmp = mkTmp();
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, 'manifests'), { recursive: true });
  // Seed manifest with literal-~ artifact that does NOT exist expanded
  const manifest = {
    manifest_version: '1', project: 'default', platform: 'claude-code', brand: null,
    installer_version: '0.1.0',
    capabilities: [{
      id: 'foo.bar', version: '1.0.0', source_commit: 'unknown',
      customer: null, security_policy: {}, owner_profile: 'default',
      installed_at: '2026-01-01T00:00:00Z', mcp_keys: [], effectiveness_flag: null,
      artifacts: ['~/.claude/agents/nonexistent.md'], deps_missing: [],
    }],
  };
  fs.writeFileSync(path.join(home, 'manifests', 'default.manifest.json'), JSON.stringify(manifest));
  const r = await doctor({ platform: 'claude-code', opsforgeHome: home });
  assert.equal(r.healthy, false);
  assert.ok(r.issues.some(i => i.check === 'artifact_missing'), 'should report artifact_missing');
});

// IN12 P1-3: workflow install records deps_missing for nonexistent step cap
test('IN12 workflow install records deps_missing for unresolvable dep', async () => {
  const tmp = mkTmp();
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  // Create a workflow cap with a step referencing a nonexistent capability
  const wfDir = path.join(tmp, 'packs', 'foo', 'workflows', 'bar');
  fs.mkdirSync(wfDir, { recursive: true });
  fs.mkdirSync(path.join(wfDir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(wfDir, 'workflow.yaml'), yaml.dump({
    id: 'foo.bar', version: '1.0.0', kind: 'workflow', pack: 'foo', owner: 'foo',
    display_name: 'Bar', display_name_zh: 'Bar', display_name_en: 'Bar',
    description: 'desc', platforms: ['claude-code'],
    params_schema: 'params.schema.json',
    steps: [{ id: 's1', capability: 'nonexistent.dep', inputs: {}, outputs: ['out'] }],
    outputs: {}, tests: 'tests/', changelog: 'CHANGELOG.md',
    source: { origin: 'original', upstream_ref: null },
  }));
  fs.writeFileSync(path.join(wfDir, 'CHANGELOG.md'), '# bar\n');
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(wfDir, 'tests', `case-0${i+1}.yaml`), yaml.dump({
      name: `case-${i}`, input: `input-${i}`, expect: 'exact', expected: `result-${i}`,
    }));
  }
  await install({ platform: 'claude-code', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home });
  // Check manifest has deps_missing
  const manifestPath = path.join(home, 'manifests', 'default.manifest.json');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entry = m.capabilities.find(c => c.id === 'foo.bar');
  assert.ok(entry.deps_missing && entry.deps_missing.includes('nonexistent.dep'), `deps_missing should include nonexistent.dep: ${JSON.stringify(entry.deps_missing)}`);
  // Doctor should surface this
  const r = await doctor({ platform: 'claude-code', opsforgeHome: home });
  assert.equal(r.healthy, false);
  assert.ok(r.issues.some(i => i.check === 'deps_missing'), 'doctor should report deps_missing');
});

// IN_source_commit P1-1: source_commit is real sha or 'unknown'
test('IN_source_commit source_commit is real sha or unknown', async () => {
  const { tmp } = mkRepo(mkTmp());
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  await install({ platform: 'claude-code', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home });
  const m = JSON.parse(fs.readFileSync(path.join(home, 'manifests', 'default.manifest.json'), 'utf8'));
  const entry = m.capabilities.find(c => c.id === 'foo.bar');
  assert.ok(entry.source_commit !== 'head', 'source_commit should not be literal "head"');
  assert.ok(entry.source_commit === 'unknown' || /^[0-9a-f]{7,}$/.test(entry.source_commit), `source_commit "${entry.source_commit}" should be sha or 'unknown'`);
});

// ---------- Phase 2.3: install-layer profile consumption ----------
// Build a repo with two capabilities: foo.bar depends on foo.baz.

function mkRepoWithDeps(tmp) {
  // foo.bar agent depends on foo.baz agent
  for (const name of ['bar', 'baz']) {
    const capDir = path.join(tmp, 'packs', 'foo', 'agents', name);
    fs.mkdirSync(path.join(capDir, 'tests'), { recursive: true });
    const deps = name === 'bar' ? ['foo.baz@^1.0.0'] : [];
    fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
      id: `foo.${name}`, version: '1.0.0', kind: 'agent', pack: 'foo', owner: 'foo',
      display_name: name, display_name_zh: name, display_name_en: name,
      description: 'desc', platforms: ['claude-code'],
      entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
      depends_on: deps, source: { origin: 'original', upstream_ref: null },
    }));
    fs.writeFileSync(path.join(capDir, 'source.md'), `---\nid: foo.${name}\n---\nThis is the ${name} agent body content for testing purposes.`);
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(path.join(capDir, 'tests', `case-0${i + 1}.yaml`), yaml.dump({
        name: `case-${i}`, input: `input-${i}`, expect: 'exact', expected: `result-${i}`,
      }));
    }
    fs.writeFileSync(path.join(capDir, 'CHANGELOG.md'), `# ${name}\n`);
  }
  // registry.yaml so resolveProfile can read versions
  fs.writeFileSync(path.join(tmp, 'registry.yaml'), yaml.dump({
    capabilities: {
      'foo.bar': { current: '1.0.0', history: [], changelog_index: '' },
      'foo.baz': { current: '1.0.0', history: [], changelog_index: '' },
    },
  }));
  return tmp;
}

// INP1 installProfile resolves a profile.yaml + installs the resolved set
test('INP1 installProfile resolves + installs the profile capability set', async () => {
  const tmp = mkRepoWithDeps(mkTmp());
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const profilePath = path.join(tmp, 'profile.yaml');
  fs.writeFileSync(profilePath, yaml.dump({
    profile: 'demo', display_name: 'Demo', display_name_zh: '演示',
    capabilities: ['foo.bar@^1.0.0'],
  }));
  const { installProfile } = await import('./install.mjs');
  const r = await installProfile({ profilePath, platform: 'claude-code', repoRoot: tmp, opsforgeHome: home });
  // Both foo.bar and foo.baz should be installed (baz via transitive dep)
  const m = JSON.parse(fs.readFileSync(path.join(home, 'manifests', 'default.manifest.json'), 'utf8'));
  const ids = m.capabilities.map((c) => c.id).sort();
  assert.deepEqual(ids, ['foo.bar', 'foo.baz']);
  // profile.lock.json written next to profile.yaml
  const lockPath = path.join(tmp, 'profile.lock.json');
  assert.ok(fs.existsSync(lockPath), 'profile.lock.json should be written');
});

// INP2 installProfile --profile-save writes the lock to a custom path
test('INP2 installProfile --profile-save writes lock to custom path', async () => {
  const tmp = mkRepoWithDeps(mkTmp());
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const profilePath = path.join(tmp, 'profile.yaml');
  fs.writeFileSync(profilePath, yaml.dump({
    profile: 'demo', display_name: 'Demo', display_name_zh: '演示',
    capabilities: ['foo.baz@^1.0.0'],
  }));
  const savePath = path.join(tmp, 'custom.lock.json');
  const { installProfile } = await import('./install.mjs');
  await installProfile({ profilePath, platform: 'claude-code', repoRoot: tmp, opsforgeHome: home, lockPath: savePath });
  assert.ok(fs.existsSync(savePath), 'custom lock path should be written');
});

// INP3 installProfile --profile-lock reuses an existing lock (no re-resolve)
test('INP3 installProfile --profile-lock reuses existing lock', async () => {
  const tmp = mkRepoWithDeps(mkTmp());
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const profilePath = path.join(tmp, 'profile.yaml');
  fs.writeFileSync(profilePath, yaml.dump({ profile: 'demo', display_name: 'D', display_name_zh: 'D', capabilities: [] }));
  const lockPath = path.join(tmp, 'profile.lock.json');
  fs.writeFileSync(lockPath, JSON.stringify({
    profile: 'demo',
    resolved: [{ id: 'foo.baz', version: '1.0.0', via: 'direct' }],
    topological: ['foo.baz'],
  }));
  const { installProfile } = await import('./install.mjs');
  const r = await installProfile({ profilePath, platform: 'claude-code', repoRoot: tmp, opsforgeHome: home, lockPath, useLock: true });
  const m = JSON.parse(fs.readFileSync(path.join(home, 'manifests', 'default.manifest.json'), 'utf8'));
  assert.ok(m.capabilities.find((c) => c.id === 'foo.baz'), 'should install foo.baz from the lock');
  assert.ok(!m.capabilities.find((c) => c.id === 'foo.bar'), 'should NOT install foo.bar (lock only had baz)');
});

// INP4 installProfile --fresh re-resolves even when a lock exists
test('INP4 installProfile --fresh re-resolves ignoring stale lock', async () => {
  const tmp = mkRepoWithDeps(mkTmp());
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const profilePath = path.join(tmp, 'profile.yaml');
  fs.writeFileSync(profilePath, yaml.dump({ profile: 'demo', display_name: 'D', display_name_zh: 'D', capabilities: ['foo.bar@^1.0.0'] }));
  const lockPath = path.join(tmp, 'profile.lock.json');
  // Stale lock with only baz
  fs.writeFileSync(lockPath, JSON.stringify({ profile: 'demo', resolved: [{ id: 'foo.baz', version: '1.0.0', via: 'direct' }], topological: ['foo.baz'] }));
  const { installProfile } = await import('./install.mjs');
  await installProfile({ profilePath, platform: 'claude-code', repoRoot: tmp, opsforgeHome: home, lockPath, fresh: true });
  const m = JSON.parse(fs.readFileSync(path.join(home, 'manifests', 'default.manifest.json'), 'utf8'));
  assert.ok(m.capabilities.find((c) => c.id === 'foo.bar'), 'fresh re-resolve should install foo.bar (from profile, not stale lock)');
});

// INP5 installProfile CLI flag --profile works end-to-end
test('INP5 installProfile via CLI --profile works end-to-end', () => {
  const tmp = mkRepoWithDeps(mkTmp());
  const home = mkTmp();
  const profilePath = path.join(tmp, 'profile.yaml');
  fs.writeFileSync(profilePath, yaml.dump({
    profile: 'demo', display_name: 'Demo', display_name_zh: '演示',
    capabilities: ['foo.baz@^1.0.0'],
  }));
  const r = spawnSync(process.execPath, [INSTALL_MJS, '--profile', profilePath, '--platform', 'claude-code'], {
    env: { ...process.env, OPSFORGE_HOME: home }, cwd: tmp, encoding: 'utf8',
  });
  assert.equal(r.status, 0, `CLI --profile failed: ${r.stderr}`);
  // CLI uses resolveOpsforgeHome() = <OPSFORGE_HOME>/.opsforge
  const manifestPath = path.join(home, '.opsforge', 'manifests', 'default.manifest.json');
  assert.ok(fs.existsSync(manifestPath), `manifest should exist at ${manifestPath}; stderr=${r.stderr}`);
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(m.capabilities.find((c) => c.id === 'foo.baz'));
});

// ---------- Phase 3.2: opsforge-feedback MCP + effectiveness scan ----------

// FB1 install auto-injects opsforge-feedback MCP on a feedback_hook-supporting platform
test('FB1 install injects opsforge-feedback MCP into ~/.claude.json', async () => {
  const { tmp } = mkRepo(mkTmp());
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  await install({ platform: 'claude-code', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home });
  const cfg = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
  assert.ok(cfg.mcpServers && cfg.mcpServers['opsforge-feedback'], 'opsforge-feedback MCP should be injected');
});

// FB2 doctor effectiveness scan flags degraded when <70% pass over last 20 ratings
test('FB2 doctor flags effectiveness:degraded when pass rate <70%', async () => {
  const tmp = mkTmp();
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, 'feedback'), { recursive: true });
  // Write 20 ratings: 10 pass, 10 fail → 50% < 70%
  const lines = [];
  for (let i = 0; i < 10; i++) lines.push(JSON.stringify({ cap_id: 'foo.bar', rating: 'up', ts: new Date().toISOString() }));
  for (let i = 0; i < 10; i++) lines.push(JSON.stringify({ cap_id: 'foo.bar', rating: 'down', ts: new Date().toISOString() }));
  fs.writeFileSync(path.join(home, 'feedback', 'ratings.jsonl'), lines.join('\n') + '\n');
  const r = await doctor({ platform: 'claude-code', opsforgeHome: home });
  assert.equal(r.healthy, false);
  assert.ok(r.issues.some((i) => i.check === 'effectiveness_degraded'), 'should flag effectiveness_degraded');
});

// FB3 doctor healthy effectiveness when >=70% pass
test('FB3 doctor effectiveness healthy when >=70% pass', async () => {
  const tmp = mkTmp();
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, 'feedback'), { recursive: true });
  const lines = [];
  for (let i = 0; i < 15; i++) lines.push(JSON.stringify({ cap_id: 'foo.bar', rating: 'up', ts: new Date().toISOString() }));
  for (let i = 0; i < 5; i++) lines.push(JSON.stringify({ cap_id: 'foo.bar', rating: 'down', ts: new Date().toISOString() }));
  fs.writeFileSync(path.join(home, 'feedback', 'ratings.jsonl'), lines.join('\n') + '\n');
  const r = await doctor({ platform: 'claude-code', opsforgeHome: home });
  assert.ok(!r.issues.some((i) => i.check === 'effectiveness_degraded'), 'should NOT flag effectiveness at 75%');
});

// FB4 recordFeedback appends a rating to ratings.jsonl
test('FB4 recordFeedback appends a rating', async () => {
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  const { recordFeedback } = await import('./install.mjs');
  await recordFeedback({ capId: 'foo.bar', rating: 'up', opsforgeHome: home });
  await recordFeedback({ capId: 'foo.bar', rating: 'down', opsforgeHome: home });
  const lines = fs.readFileSync(path.join(home, 'feedback', 'ratings.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.equal(first.cap_id, 'foo.bar');
  assert.equal(first.rating, 'up');
});

// ---------- Phase 3.3: --downgrade ----------

// DG1 install --downgrade on a Tier-2 platform installs with degradation instead of failing conform
test('DG1 install --downgrade installs agent on codex via manual-paste', async () => {
  const tmp = mkTmp();
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  // agent with requires:hard agent_file (unsupported on codex)
  const capDir = path.join(tmp, 'packs', 'foo', 'agents', 'bar');
  fs.mkdirSync(path.join(capDir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'foo.bar', version: '1.0.0', kind: 'agent', pack: 'foo', owner: 'foo',
    display_name: 'Bar', display_name_zh: 'Bar', display_name_en: 'Bar',
    description: 'desc', platforms: ['codex'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
    requires: [{ point: 'agent_file', severity: 'hard' }],
  }));
  fs.writeFileSync(path.join(capDir, 'source.md'), '---\nid: foo.bar\n---\nagent body content here.');
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(capDir, 'tests', `case-0${i+1}.yaml`), yaml.dump({ name: `c${i}`, input: `i${i}`, expect: 'exact', expected: `e${i}` }));
  fs.writeFileSync(path.join(capDir, 'CHANGELOG.md'), '# bar\n');
  const { install } = await import('./install.mjs');
  // Without --downgrade: conform fails (requires:hard agent_file unsupported on codex)
  await assert.rejects(() => install({ platform: 'codex', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home }), /agent_file|conform/i);
  // With --downgrade: installs (manual-paste artifact, nothing written to disk but success)
  const r = await install({ platform: 'codex', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home, downgrade: true });
  assert.ok(Array.isArray(r.installed));
  // manifest records the cap with a degradation note
  const m = JSON.parse(fs.readFileSync(path.join(home, 'manifests', 'default.manifest.json'), 'utf8'));
  const entry = m.capabilities.find((c) => c.id === 'foo.bar');
  assert.ok(entry, 'manifest should record the downgraded install');
});

// ---------- F2: dify platform reachability ----------

// F2a install on dify (Tier-3) resolves the adapter and writes a manifest entry
test('F2a install on dify resolves adapter + writes manifest entry', async () => {
  const tmp = mkTmp();
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  const capDir = path.join(tmp, 'packs', 'foo', 'agents', 'bar');
  fs.mkdirSync(path.join(capDir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'foo.bar', version: '1.0.0', kind: 'agent', pack: 'foo', owner: 'foo',
    display_name: 'Bar', display_name_zh: 'Bar', display_name_en: 'Bar',
    description: 'desc', platforms: ['dify'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  fs.writeFileSync(path.join(capDir, 'source.md'), '---\nid: foo.bar\n---\nagent body content here.');
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(capDir, 'tests', `case-0${i+1}.yaml`), yaml.dump({ name: `c${i}`, input: `i${i}`, expect: 'exact', expected: `e${i}` }));
  fs.writeFileSync(path.join(capDir, 'CHANGELOG.md'), '# bar\n');
  const { install } = await import('./install.mjs');
  const r = await install({ platform: 'dify', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home });
  assert.ok(Array.isArray(r.installed));
  const m = JSON.parse(fs.readFileSync(path.join(home, 'manifests', 'default.manifest.json'), 'utf8'));
  assert.ok(m.capabilities.find((c) => c.id === 'foo.bar'), 'manifest should record the dify install');
});

// ---------- F4: manual-paste pasteInstructions persisted ----------

// F4a install on Tier-3 dify writes paste-<slug>.md and surfaces it in installed[]
test('F4a install on dify writes paste-<slug>.md + surfaces in installed[]', async () => {
  const tmp = mkTmp();
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  const capDir = path.join(tmp, 'packs', 'foo', 'agents', 'bar');
  fs.mkdirSync(path.join(capDir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'foo.bar', version: '1.0.0', kind: 'agent', pack: 'foo', owner: 'foo',
    display_name: 'Bar', display_name_zh: 'Bar', display_name_en: 'Bar',
    description: 'desc', platforms: ['dify'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  fs.writeFileSync(path.join(capDir, 'source.md'), '---\nid: foo.bar\n---\nagent body content here.');
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(capDir, 'tests', `case-0${i+1}.yaml`), yaml.dump({ name: `c${i}`, input: `i${i}`, expect: 'exact', expected: `e${i}` }));
  fs.writeFileSync(path.join(capDir, 'CHANGELOG.md'), '# bar\n');
  const { install } = await import('./install.mjs');
  const r = await install({ platform: 'dify', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home });
  // A paste file should be written under <opsforgeHome>/paste/<project>/<slug>.md
  const pastePath = path.join(home, 'paste', 'default', 'bar.md');
  assert.ok(fs.existsSync(pastePath), `paste file should exist at ${pastePath}`);
  const paste = fs.readFileSync(pastePath, 'utf8');
  assert.ok(paste.includes('agent body content'), 'paste file should contain the capability body');
  // installed[] should surface the paste path
  assert.ok(r.installed.includes(pastePath), `installed[] should include the paste path; got ${JSON.stringify(r.installed)}`);
  // manifest entry should record the paste path in artifacts
  const m = JSON.parse(fs.readFileSync(path.join(home, 'manifests', 'default.manifest.json'), 'utf8'));
  const entry = m.capabilities.find((c) => c.id === 'foo.bar');
  assert.ok(entry.artifacts.includes(pastePath), 'manifest artifacts should include the paste path');
});

// F4b install on Tier-1 claude-code does NOT write a paste file (no regression)
test('F4b install on claude-code does NOT write a paste file', async () => {
  const { tmp } = mkRepo(mkTmp());
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  await install({ platform: 'claude-code', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home });
  const pasteDir = path.join(home, 'paste');
  assert.ok(!fs.existsSync(pasteDir), 'no paste dir should be created on Tier-1 (claude-code)');
});
