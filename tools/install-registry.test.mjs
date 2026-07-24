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
