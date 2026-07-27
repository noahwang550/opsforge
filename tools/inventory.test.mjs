// tools/inventory.test.mjs — 动态能力清单测试（Phase 3.6 收尾）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { buildInventory, renderReadmeBlock, renderDiscoverAll } from './inventory.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INVENTORY = path.resolve(__dirname, 'inventory.mjs');

function mkRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-inv-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"test"}');
  return root;
}

function mkCap(root, slug, name, opts = {}) {
  const brand = opts.brand || null;
  const state = opts.state || 'released';
  const body = opts.body || `## 能力说明\n\n${name} 详细说明内容\n\n## 适用场景\n\n- 场景一\n- 场景二`;
  let dir;
  if (brand) dir = path.join(root, 'customers', brand, 'packs', brand, 'agents', name);
  else if (state === 'draft') dir = path.join(root, 'packs', '_drafts', slug, name);
  else if (state === 'staged') dir = path.join(root, 'packs', '_staged', slug, name);
  else dir = path.join(root, 'packs', slug, 'agents', name);
  fs.mkdirSync(dir, { recursive: true });
  const id = `${brand || slug}.${name}`;
  fs.writeFileSync(path.join(dir, 'capability.yaml'), yaml.dump({
    id, version: '1.0.0', kind: 'agent', pack: brand || slug, owner: brand || slug,
    display_name: name, display_name_zh: `${name}中`, display_name_en: name,
    description: `desc ${name}`, platforms: ['claude-code'],
    entrypoint: 'source.md', tests: 'tests/', changelog: 'CHANGELOG.md',
    depends_on: [], source: { origin: 'original', upstream_ref: null },
  }));
  fs.writeFileSync(path.join(dir, 'source.md'), `---\nid: ${id}\n---\n${body}`);
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(dir, 'tests', `c${i}.yaml`), yaml.dump({ name: `c${i}`, input: `i${i}`, expect: 'exact', expected: `e${i}` }));
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), `# ${name}\n`);
  return dir;
}

function writeRegistry(root, ids) {
  const caps = {};
  for (const id of ids) caps[id] = { current: '1.0.0', history: [], changelog_index: 'packs/x/agents/y/CHANGELOG.md' };
  fs.writeFileSync(path.join(root, 'registry.yaml'), yaml.dump({ capabilities: caps }));
}

// T_inv1 buildInventory maps a released cap with detail + scenarios + state.
test('T_inv1 buildInventory extracts detail/scenarios for released cap', async () => {
  const root = mkRepo();
  mkCap(root, 'foo', 'bar');
  writeRegistry(root, ['foo.bar']);
  const inv = await buildInventory({ repoRoot: root });
  assert.equal(inv.general.length, 1, `general should have 1; got ${inv.general.length}`);
  const e = inv.general[0];
  assert.equal(e.id, 'foo.bar');
  assert.equal(e.state, 'released');
  assert.ok(e.detail.includes('详细说明'), `detail missing; got ${e.detail}`);
  assert.ok(e.scenarios.includes('场景一'));
  assert.equal(e.scenarioTag, '场景一');
  assert.equal(e.display_name_zh, 'bar中');
});

// T_inv2 drafts excluded by default; included with --include-drafts.
test('T_inv2 drafts excluded by default, included with --include-drafts', async () => {
  const root = mkRepo();
  mkCap(root, 'foo', 'bar', { state: 'draft' });
  writeRegistry(root, []);
  const inv = await buildInventory({ repoRoot: root });
  assert.equal(inv.all.length, 0, 'drafts must not appear by default');
  const inv2 = await buildInventory({ repoRoot: root, includeDrafts: true });
  assert.equal(inv2.all.length, 1);
  assert.equal(inv2.all[0].state, 'draft');
});

// T_inv3 brand cap grouped under brands, not general.
test('T_inv3 brand cap grouped under brands', async () => {
  const root = mkRepo();
  mkCap(root, 'acme', 'bot', { brand: 'acme' });
  writeRegistry(root, ['acme.bot']);
  const inv = await buildInventory({ repoRoot: root });
  assert.equal(inv.general.length, 0);
  assert.ok(inv.brands.acme && inv.brands.acme.length === 1, 'brand cap should be under brands.acme');
  assert.equal(inv.brands.acme[0].scope, 'brand');
});

// T_inv4 README --readme inserts markers + --check-readme passes; stale fails.
test('T_inv4 README drift gate (insert + check + stale)', () => {
  const root = mkRepo();
  mkCap(root, 'foo', 'bar');
  writeRegistry(root, ['foo.bar']);
  fs.writeFileSync(path.join(root, 'README.md'), '# Proj\n\nintro\n\n## 文档导览\n\n- x\n');
  // insert
  let r = spawnSync(process.execPath, [INVENTORY, '--readme', '--repo-root', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, `--readme failed: ${r.stderr}`);
  let readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /opsforge:capability-inventory start/);
  assert.match(readme, /\| `foo.bar` \|/);
  assert.match(readme, /场景一/); // 适用场景 column present
  // check up-to-date
  r = spawnSync(process.execPath, [INVENTORY, '--check-readme', '--repo-root', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, `--check-readme should pass when fresh: ${r.stdout}${r.stderr}`);
  // stale: hand-edit inside the block
  readme = readme.replace('场景一', 'TAMPERED');
  fs.writeFileSync(path.join(root, 'README.md'), readme);
  r = spawnSync(process.execPath, [INVENTORY, '--check-readme', '--repo-root', root], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, `--check-readme should fail when stale: ${r.stdout}${r.stderr}`);
  // content outside the block is preserved
  assert.match(readme, /^# Proj\n/);
  assert.match(readme, /## 文档导览\n/);
});

// T_inv5 --check-readme fails when markers missing.
test('T_inv5 --check-readme fails when markers missing', () => {
  const root = mkRepo();
  mkCap(root, 'foo', 'bar');
  writeRegistry(root, ['foo.bar']);
  fs.writeFileSync(path.join(root, 'README.md'), '# Proj\n\nno markers here\n');
  const r = spawnSync(process.execPath, [INVENTORY, '--check-readme', '--repo-root', root], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'should fail when markers missing');
  assert.match(r.stderr, /markers missing/);
});

// T_inv6 renderReadmeBlock includes 适用场景 column header + brand section.
test('T_inv6 renderReadmeBlock has 适用场景 column + brand section', async () => {
  const root = mkRepo();
  mkCap(root, 'foo', 'bar');
  mkCap(root, 'acme', 'bot', { brand: 'acme' });
  writeRegistry(root, ['foo.bar', 'acme.bot']);
  const inv = await buildInventory({ repoRoot: root });
  const md = renderReadmeBlock(inv);
  assert.match(md, /\| id \| 中文名 \| 类型 \| 平台 \| 适用场景 \| 状态 \| 版本 \|/);
  assert.match(md, /### 通用能力/);
  assert.match(md, /### 品牌定制：acme/);
  assert.match(md, /`acme.bot`/);
});

// T_inv7 renderDiscoverAll has grouped cards + 质量灯 + 平台.
test('T_inv7 renderDiscoverAll renders grouped cards with light + platform', async () => {
  const root = mkRepo();
  mkCap(root, 'foo', 'bar');
  writeRegistry(root, ['foo.bar']);
  const inv = await buildInventory({ repoRoot: root });
  const out = renderDiscoverAll(inv);
  assert.match(out, /=== 通用能力 ===/);
  assert.match(out, /【agent类】/);
  assert.match(out, /▌ foo\.bar/);
  assert.match(out, /【能力说明】/);
  assert.match(out, /【适用场景】/);
  assert.match(out, /平台: claude-code\(T1\)/);
});
