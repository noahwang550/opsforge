// tools/install-registry.test.mjs — Phase 3.6 落点 6: install.mjs registry 回退。
// 仓库 fresh 优先，home 副本次之（避免 stale 覆盖）。TDD。NIT 7: moved into tools/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { readRegistryForInstall } from '../install.mjs';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-reg-'));
}

// RF1: repo registry wins over home registry (repo fresh 优先).
test('RF1 readRegistryForInstall prefers repo registry over home', () => {
  const repo = mkTmp();
  const home = mkTmp();
  fs.writeFileSync(path.join(repo, 'registry.yaml'), yaml.dump({ capabilities: { 'repo.foo': { current: '1.0.0' } } }));
  fs.writeFileSync(path.join(home, 'registry.yaml'), yaml.dump({ capabilities: { 'home.bar': { current: '2.0.0' } } }));
  const reg = readRegistryForInstall(repo, home);
  assert.ok(reg.capabilities['repo.foo'], 'repo entry present');
  assert.ok(!reg.capabilities['home.bar'], 'home must not shadow repo');
});

// RF2: falls back to home registry when repo has none.
test('RF2 readRegistryForInstall falls back to home registry', () => {
  const repo = mkTmp();
  const home = mkTmp();
  fs.writeFileSync(path.join(home, 'registry.yaml'), yaml.dump({ capabilities: { 'home.bar': { current: '2.0.0' } } }));
  const reg = readRegistryForInstall(repo, home);
  assert.ok(reg.capabilities['home.bar'], 'home fallback entry present');
});

// RF3: returns null/empty when neither exists.
test('RF3 readRegistryForInstall returns null when neither exists', () => {
  const repo = mkTmp();
  const home = mkTmp();
  const reg = readRegistryForInstall(repo, home);
  assert.equal(reg, null);
});

// RF4: returns repo registry when only repo has one (no home registry).
test('RF4 readRegistryForInstall returns repo when only repo has registry', () => {
  const repo = mkTmp();
  const home = mkTmp();
  fs.writeFileSync(path.join(repo, 'registry.yaml'), yaml.dump({ capabilities: { 'repo.baz': { current: '3.0.0' } } }));
  const reg = readRegistryForInstall(repo, home);
  assert.ok(reg.capabilities['repo.baz']);
});

// ---------- P1-B: findCapabilitySource + installFromGit ----------

// RF5 P1-B: findCapabilitySource searches _staged/third-party/ (not _drafts/).
test('RF5 findCapabilitySource searches _staged/third-party/', async () => {
  const { findCapabilitySource } = await import('../install.mjs');
  const repo = mkTmp();
  // Create a staged third-party capability.
  const capDir = path.join(repo, 'packs', '_staged', 'third-party', 'agents', 'stagedbot');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'third-party.stagedbot', version: '0.1.0', kind: 'agent', pack: 'third-party',
    owner: 'third-party', display_name: 'B', display_name_zh: 'B', display_name_en: 'B',
    description: 'd', platforms: ['claude-code'], entrypoint: 'source.md',
    tests: 'tests/', changelog: 'CHANGELOG.md', depends_on: [],
    source: { origin: 'third-party', upstream_ref: null },
  }));
  const found = findCapabilitySource('third-party.stagedbot', repo);
  assert.ok(found, 'findCapabilitySource should find the staged third-party cap');
  assert.ok(found.includes('stagedbot'), 'found path should include the cap name');
  assert.ok(found.includes('_staged'), 'found path should be _staged, not _drafts');
});

// RF6 P1-B: findCapabilitySource does NOT search _drafts/third-party/ (drafts not installable).
test('RF6 findCapabilitySource does NOT search _drafts/third-party/', async () => {
  const { findCapabilitySource } = await import('../install.mjs');
  const repo = mkTmp();
  // Create a draft third-party capability (draft state — not installable).
  const capDir = path.join(repo, 'packs', '_drafts', 'third-party', 'agents', 'draftbot');
  fs.mkdirSync(capDir, { recursive: true });
  fs.writeFileSync(path.join(capDir, 'capability.yaml'), yaml.dump({
    id: 'third-party.draftbot', version: '0.1.0', kind: 'agent', pack: 'third-party',
    owner: 'third-party', display_name: 'B', display_name_zh: 'B', display_name_en: 'B',
    description: 'd', platforms: ['claude-code'], entrypoint: 'source.md',
    tests: 'tests/', changelog: 'CHANGELOG.md', depends_on: [],
    source: { origin: 'third-party', upstream_ref: null },
  }));
  const found = findCapabilitySource('third-party.draftbot', repo);
  assert.equal(found, null, 'findCapabilitySource must NOT find drafts (drafts are not installable)');
});

// RF7 P1-B: installFromGit clones-to-temp → install → cleanup temp.
test('RF7 installFromGit clones-to-temp then cleans up', async () => {
  const { installFromGit } = await import('../install.mjs');
  const repo = mkTmp();
  const home = mkTmp();
  const origHome = process.env.OPSFORGE_HOME;
  process.env.OPSFORGE_HOME = home;
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  // Mock fetchUpstream via injected execFile that creates a fake clone at the dest path.
  const dest = path.join(repo, 'fake-clone');
  const mockExecFile = (cmd, args, opts) => {
    if (cmd === 'git' && args[0] === 'clone') {
      // args[3] is the dest path (args = ['clone','--depth','1',url,dest]).
      const cloneDest = args[4] || dest;
      fs.mkdirSync(cloneDest, { recursive: true });
      // Create the capability dir inside the "clone".
      const cap = path.join(cloneDest, 'agents', 'gitbot');
      fs.mkdirSync(path.join(cap, 'tests'), { recursive: true });
      fs.writeFileSync(path.join(cap, 'capability.yaml'), yaml.dump({
        id: 'third-party.gitbot', version: '0.1.0', kind: 'agent', pack: 'third-party',
        owner: 'third-party', display_name: 'B', display_name_zh: 'B', display_name_en: 'B',
        description: 'd', platforms: ['claude-code'], entrypoint: 'source.md',
        tests: 'tests/', changelog: 'CHANGELOG.md', depends_on: [],
        source: { origin: 'third-party', upstream_ref: null },
      }));
      fs.writeFileSync(path.join(cap, 'source.md'), '---\nid: third-party.gitbot\n---\nbody');
      fs.writeFileSync(path.join(cap, 'CHANGELOG.md'), '# bot\n');
      for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(cap, 'tests', `case-0${i+1}.yaml`), yaml.dump({ name: `c${i}`, input: `i${i}`, expect: 'exact', expected: `e${i}` }));
      return '';
    }
    if (cmd === 'git' && args[0] === 'rev-parse') return 'abc1234\n';
    return '';
  };
  try {
    const r = await installFromGit('https://github.com/upstream/gitbot.git', 'agents', 'gitbot', {
      platform: 'claude-code', project: 'default', repoRoot: repo, opsforgeHome: home,
      execFile: mockExecFile, dest,
    });
    assert.ok(r.installed.length > 0, 'should install artifacts');
    // Agent artifact should exist after install (adapter writes to home/.claude/agents/).
    const agentPath = path.join(home, '.claude', 'agents', 'gitbot.md');
    assert.ok(fs.existsSync(agentPath), 'agent artifact should exist after installFromGit');
    // Temp clone dir should be cleaned up (best-effort).
    assert.ok(!fs.existsSync(dest), 'temp clone dir should be cleaned up after installFromGit');
  } finally {
    if (origHome === undefined) delete process.env.OPSFORGE_HOME;
    else process.env.OPSFORGE_HOME = origHome;
  }
});
