// tools/opsforge-runtime.test.mjs — Phase 3.6 落点 2: runtime thin wrapper.
// resolveWorkDir 三级回退 + registry 优先级 + install/list/doctor 转发。TDD。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  resolveWorkDir,
  readRegistry,
  runInstall,
  runList,
  runDoctor,
} from './opsforge-runtime.mjs';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-rt-'));
}

function mkRepo(root) {
  for (const d of ['templates', 'schema', 'tools', 'packs']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  return root;
}

// RT1: OPSFORGE_WORKDIR env wins over cwd and home workdir.
test('RT1 resolveWorkDir env override wins', () => {
  const envDir = mkTmp();
  const home = mkTmp();
  const cwd = mkRepo(mkTmp());
  const origEnv = process.env.OPSFORGE_WORKDIR;
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_WORKDIR = envDir;
  process.env.OPSFORGE_HOME = home;
  try {
    const r = resolveWorkDir({ cwd, opsforgeHome: home });
    assert.equal(r.dir, envDir);
    assert.equal(r.source, 'env');
  } finally {
    if (origEnv === undefined) delete process.env.OPSFORGE_WORKDIR; else process.env.OPSFORGE_WORKDIR = origEnv;
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
});

// RT2: no env, home workdir absent, cwd is a valid repo → cwd (载体 A).
test('RT2 resolveWorkDir cwd repo fallback (载体 A)', () => {
  const home = mkTmp();
  const cwd = mkRepo(mkTmp());
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  try {
    const r = resolveWorkDir({ cwd, opsforgeHome: home });
    assert.equal(r.dir, cwd);
    assert.equal(r.source, 'cwd');
  } finally {
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
});

// RT3: no env, cwd is a valid repo → cwd wins (repo authoritative, 载体 A).
// MINOR 3: cwd-is-repo now checked before home-workdir-exists.
test('RT3 resolveWorkDir cwd repo wins over home workdir when cwd is a repo', () => {
  const home = mkTmp();
  fs.mkdirSync(path.join(home, 'opsforge-workdir'), { recursive: true });
  const cwd = mkRepo(mkTmp());
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  try {
    const r = resolveWorkDir({ cwd, opsforgeHome: home });
    assert.equal(r.dir, cwd);
    assert.equal(r.source, 'cwd');
  } finally {
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
});

// RT3b: no env, cwd NOT a repo, home workdir exists → home workdir (in-platform).
test('RT3b resolveWorkDir home workdir when cwd not a repo', () => {
  const home = mkTmp();
  fs.mkdirSync(path.join(home, 'opsforge-workdir'), { recursive: true });
  const cwd = mkTmp(); // not a repo
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  try {
    const r = resolveWorkDir({ cwd, opsforgeHome: home });
    assert.equal(r.dir, path.join(home, 'opsforge-workdir'));
    assert.equal(r.source, 'home');
  } finally {
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
});

// RT4: no env, home workdir absent, cwd NOT a repo → creates home workdir + writes bootstrap.json.
test('RT4 resolveWorkDir creates home workdir on first in-platform launch', () => {
  const home = mkTmp();
  const cwd = mkTmp(); // no templates/schema/tools
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  try {
    const r = resolveWorkDir({ cwd, opsforgeHome: home, platform: 'claude-code' });
    assert.equal(r.source, 'home-bootstrap');
    assert.ok(fs.existsSync(path.join(home, 'opsforge-workdir', '.opsforge-bootstrap.json')));
    const bj = JSON.parse(fs.readFileSync(path.join(home, 'opsforge-workdir', '.opsforge-bootstrap.json'), 'utf8'));
    assert.equal(bj.source_platform, 'claude-code');
    assert.equal(bj.carrier_type, 'B');
  } finally {
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
});

// RT5: explicit carrier='A' (CLI), no env, no home workdir, cwd not a repo → fail-loud Chinese.
test('RT5 resolveWorkDir fail-loud Chinese when CLI carrier A and cwd not a repo', () => {
  const home = mkTmp();
  const cwd = mkTmp();
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  try {
    assert.throws(() => resolveWorkDir({ cwd, opsforgeHome: home, carrier: 'A' }), /不是 OpsForge 仓库/);
  } finally {
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
});

// RT6: readRegistry — repo registry.yaml wins over home registry.yaml.
// MINOR 4: readRegistry now delegates to install.mjs readRegistryForInstall (async).
test('RT6 readRegistry prefers repo registry over home registry', async () => {
  const repo = mkTmp();
  const home = mkTmp();
  fs.writeFileSync(path.join(repo, 'registry.yaml'), yaml.dump({ capabilities: { 'repo.foo': { current: '1.0.0' } } }));
  fs.writeFileSync(path.join(home, 'registry.yaml'), yaml.dump({ capabilities: { 'home.bar': { current: '2.0.0' } } }));
  const reg = await readRegistry({ workDir: repo, opsforgeHome: home });
  assert.ok(reg.capabilities['repo.foo'], 'repo registry entry present');
  assert.ok(!reg.capabilities['home.bar'], 'home registry should NOT shadow repo');
});

// RT6b: readRegistry falls back to home registry when repo has none.
test('RT6b readRegistry falls back to home registry', async () => {
  const repo = mkTmp();
  const home = mkTmp();
  fs.writeFileSync(path.join(home, 'registry.yaml'), yaml.dump({ capabilities: { 'home.bar': { current: '2.0.0' } } }));
  const reg = await readRegistry({ workDir: repo, opsforgeHome: home });
  assert.ok(reg.capabilities['home.bar'], 'home registry fallback entry present');
});

// RT6c: readRegistry returns empty registry when neither exists.
test('RT6c readRegistry returns empty when neither exists', async () => {
  const repo = mkTmp();
  const home = mkTmp();
  const reg = await readRegistry({ workDir: repo, opsforgeHome: home });
  assert.deepEqual(reg, { capabilities: {} });
});

// RT7: runInstall forwards to install.mjs install() with workDir as repoRoot.
test('RT7 runInstall forwards to install.mjs install()', async () => {
  const repo = mkRepo(mkTmp());
  const home = mkTmp();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const capDir = path.join(repo, 'packs', 'foo', 'agents', 'bar');
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
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  try {
    const r = await runInstall({ capId: 'foo.bar', project: 'default', workDir: repo, opsforgeHome: home, platform: 'claude-code' });
    assert.ok(r.installed.length > 0);
    assert.ok(fs.existsSync(path.join(home, '.claude', 'agents', 'bar.md')));
  } finally {
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
});

// RT8: runList forwards to install.mjs list().
test('RT8 runList forwards to install.mjs list()', async () => {
  const home = mkTmp();
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  // seed a manifest
  const manifestsDir = path.join(home, 'manifests');
  fs.mkdirSync(manifestsDir, { recursive: true });
  fs.writeFileSync(path.join(manifestsDir, 'default.manifest.json'), JSON.stringify({
    manifest_version: '1', project: 'default', platform: 'claude-code', brand: null,
    installer_version: '0.1.0',
    capabilities: [{ id: 'foo.bar', version: '1.0.0', installed_at: '2026-01-01T00:00:00Z' }],
  }));
  try {
    const r = await runList({ project: 'default', opsforgeHome: home });
    assert.equal(r.list.length, 1);
    assert.equal(r.list[0].id, 'foo.bar');
  } finally {
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
});

// RT9: runDoctor forwards to install.mjs doctor().
test('RT9 runDoctor forwards to install.mjs doctor()', async () => {
  const home = mkTmp();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  try {
    const r = await runDoctor({ platform: 'claude-code', project: 'default', opsforgeHome: home });
    assert.equal(r.healthy, true, 'empty manifest + writable platform → healthy');
  } finally {
    if (origHome === undefined) delete process.env.OPSFORGE_HOME; else process.env.OPSFORGE_HOME = origHome;
  }
});
