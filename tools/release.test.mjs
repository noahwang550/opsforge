// tools/release.test.mjs — Phase 1.5: release + registry aggregation tests (RL1–RL8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { release, aggregateAll } from './release.mjs';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-rel-'));
}

function mkReleasedCap(tmp, slug, name, version = '1.0.0') {
  const dir = path.join(tmp, 'packs', slug, 'agents', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'capability.yaml'), yaml.dump({
    id: `${slug}.${name}`, version, kind: 'agent', pack: slug, owner: slug,
    display_name: name, display_name_zh: name, display_name_en: name,
    description: 'desc', platforms: ['claude-code'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  fs.writeFileSync(path.join(dir, 'source.md'), '---\nid: ' + slug + '.' + name + '\n---\nbody');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), `# ${name}\n`);
  return dir;
}

// RL1 release registers a capability in registry.yaml
test('RL1 release registers a capability', () => {
  const tmp = mkTmp();
  const dir = mkReleasedCap(tmp, 'foo', 'bar', '1.0.0');
  const r = release(dir, { repoRoot: tmp });
  assert.equal(r.registered, true);
  assert.equal(r.id, 'foo.bar');
  assert.equal(r.version, '1.0.0');
  const regPath = path.join(tmp, 'registry.yaml');
  assert.ok(fs.existsSync(regPath));
  const reg = yaml.load(fs.readFileSync(regPath, 'utf8'));
  assert.ok(reg.capabilities['foo.bar']);
  assert.equal(reg.capabilities['foo.bar'].current, '1.0.0');
});

// RL2 release blocks on failed validation-report
test('RL2 release blocks on failed validation-report', () => {
  const tmp = mkTmp();
  const dir = mkReleasedCap(tmp, 'foo', 'bar');
  fs.writeFileSync(path.join(dir, 'validation-report.json'), JSON.stringify({ verdict: 'fail' }));
  const r = release(dir, { repoRoot: tmp });
  assert.equal(r.registered, false);
  assert.ok(r.reason.includes('validation-report'));
});

// RL3 release blocks on failed security-report
test('RL3 release blocks on failed security-report', () => {
  const tmp = mkTmp();
  const dir = mkReleasedCap(tmp, 'foo', 'bar');
  fs.writeFileSync(path.join(dir, 'security-report.json'), JSON.stringify({ verdict: 'block' }));
  const r = release(dir, { repoRoot: tmp });
  assert.equal(r.registered, false);
  assert.ok(r.reason.includes('security-report'));
});

// RL4 release allows when reports absent (greenfield seeding)
test('RL4 release allows when reports absent', () => {
  const tmp = mkTmp();
  const dir = mkReleasedCap(tmp, 'foo', 'bar');
  const r = release(dir, { repoRoot: tmp });
  assert.equal(r.registered, true);
});

// RL5 release blocks on invalid semver
test('RL5 release blocks on invalid semver', () => {
  const tmp = mkTmp();
  const dir = mkReleasedCap(tmp, 'foo', 'bar', 'not-semver');
  const r = release(dir, { repoRoot: tmp });
  assert.equal(r.registered, false);
  assert.ok(r.reason.includes('semver'));
});

// RL6 aggregateAll scans packs/ and writes registry.yaml + registry-brands.yaml
test('RL6 aggregateAll writes registry.yaml + registry-brands.yaml', () => {
  const tmp = mkTmp();
  mkReleasedCap(tmp, 'foo', 'bar');
  mkReleasedCap(tmp, 'foo', 'baz');
  const { registry, registryBrands } = aggregateAll({ repoRoot: tmp });
  assert.ok(registry.capabilities['foo.bar']);
  assert.ok(registry.capabilities['foo.baz']);
  assert.ok(fs.existsSync(path.join(tmp, 'registry.yaml')));
  assert.ok(fs.existsSync(path.join(tmp, 'registry-brands.yaml')));
  assert.deepEqual(Object.keys(registryBrands.brands), []);
});

// RL7 aggregateAll registry entries have current + history + changelog_index
test('RL7 registry entries have required fields', () => {
  const tmp = mkTmp();
  mkReleasedCap(tmp, 'foo', 'bar');
  const { registry } = aggregateAll({ repoRoot: tmp });
  const e = registry.capabilities['foo.bar'];
  assert.ok(e.current);
  assert.ok(Array.isArray(e.history));
  assert.ok(e.changelog_index);
});

// RL8 registry-brands.yaml has empty brands when no brand caps
test('RL8 registry-brands.yaml empty brands when no brand caps', () => {
  const tmp = mkTmp();
  mkReleasedCap(tmp, 'foo', 'bar');
  const { registryBrands } = aggregateAll({ repoRoot: tmp });
  assert.deepEqual(registryBrands.brands, {});
  const brandsYaml = fs.readFileSync(path.join(tmp, 'registry-brands.yaml'), 'utf8');
  assert.match(brandsYaml, /brands:\s*\{\}/);
});

// RL_gate: aggregateAll blocks cap with failed validation-report (P0-5)
test('RL_gate aggregateAll blocks cap with failed validation-report', () => {
  const tmp = mkTmp();
  const dir = mkReleasedCap(tmp, 'foo', 'bar');
  // Write a failing validation-report.json
  fs.writeFileSync(path.join(dir, 'validation-report.json'), JSON.stringify({ verdict: 'fail' }));
  const { registry } = aggregateAll({ repoRoot: tmp });
  assert.ok(!registry.capabilities['foo.bar'], 'cap with failed validation-report should NOT be registered');
});

// RL_state1 D3: release() advances .opsforge-state.json to state:"released".
// Bug: release() never touched .opsforge-state.json, so the three-state flow stalled at "staged".
test('RL_state1 release advances .opsforge-state.json to released', () => {
  const tmp = mkTmp();
  const dir = mkReleasedCap(tmp, 'foo', 'bar', '1.0.0');
  fs.writeFileSync(path.join(dir, '.opsforge-state.json'), JSON.stringify({
    state: 'staged',
    history: [{ ts: '2026-01-01T00:00:00Z', from: 'draft', to: 'staged', pr: null }],
  }));
  const r = release(dir, { repoRoot: tmp });
  assert.equal(r.registered, true);
  const st = JSON.parse(fs.readFileSync(path.join(dir, '.opsforge-state.json'), 'utf8'));
  assert.equal(st.state, 'released', `state should be released; got ${st.state}`);
  const last = st.history[st.history.length - 1];
  assert.equal(last.to, 'released');
  assert.equal(last.from, 'staged');
});

// RL_state2 D3: aggregateAll advances .opsforge-state.json to state:"registry" after success.
test('RL_state2 aggregateAll advances .opsforge-state.json to registry', () => {
  const tmp = mkTmp();
  const dir = mkReleasedCap(tmp, 'foo', 'bar', '1.0.0');
  fs.writeFileSync(path.join(dir, '.opsforge-state.json'), JSON.stringify({
    state: 'released',
    history: [{ ts: '2026-01-01T00:00:00Z', from: 'staged', to: 'released', pr: null }],
  }));
  aggregateAll({ repoRoot: tmp });
  const st = JSON.parse(fs.readFileSync(path.join(dir, '.opsforge-state.json'), 'utf8'));
  assert.equal(st.state, 'registry', `state should be registry; got ${st.state}`);
  const last = st.history[st.history.length - 1];
  assert.equal(last.to, 'registry');
  assert.equal(last.from, 'released');
});

// RL_eval Phase 2.2: a failed eval-report blocks registration (3-report gate).
test('RL_eval release blocks on failed eval-report', () => {
  const tmp = mkTmp();
  const dir = mkReleasedCap(tmp, 'foo', 'bar');
  fs.writeFileSync(path.join(dir, 'eval-report.json'), JSON.stringify({ verdict: 'fail' }));
  const r = release(dir, { repoRoot: tmp });
  assert.equal(r.registered, false);
  assert.ok(r.reason.includes('eval-report'));
});

// RL_eval2 Phase 2.2: a passing eval-report allows registration.
test('RL_eval2 release allows on passing eval-report', () => {
  const tmp = mkTmp();
  const dir = mkReleasedCap(tmp, 'foo', 'bar');
  fs.writeFileSync(path.join(dir, 'eval-report.json'), JSON.stringify({ verdict: 'pass' }));
  const r = release(dir, { repoRoot: tmp });
  assert.equal(r.registered, true);
});

// RL_eval3 Phase 2.2: a pending eval-report does NOT block (static-only CI reality).
test('RL_eval3 release allows on pending eval-report', () => {
  const tmp = mkTmp();
  const dir = mkReleasedCap(tmp, 'foo', 'bar');
  fs.writeFileSync(path.join(dir, 'eval-report.json'), JSON.stringify({ verdict: 'pending' }));
  const r = release(dir, { repoRoot: tmp });
  assert.equal(r.registered, true);
});
