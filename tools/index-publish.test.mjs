// tools/index-publish.test.mjs — Slice A1: index 生成（buildIndex + publishIndex + CLI argv）.
// A1-U1 shape、A1-U2 产出 + ajv schema 校验、A1-U3 无敏感字段、A1-C1/C2 CLI argv spawn（MEMORY 强制）.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { buildIndex, publishIndex, validateIndex, validateCapability } from './index-publish.mjs';
import { buildCatalogSnapshot, catalogSummary } from './catalog-model.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'index-publish.mjs');

function loadSchema() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schema', 'index.schema.json'), 'utf8'));
}

// A1-U1: buildIndex 返回 catalogSummary 形 index + publicEntry 数组（含 detail/usage）.
test('A1-U1 buildIndex returns catalogSummary-shaped index + full publicEntry capabilities', async () => {
  const now = new Date('2026-08-07T00:00:00.000Z');
  const { index, capabilities } = await buildIndex({ repoRoot: REPO_ROOT, now });
  const snapshot = await buildCatalogSnapshot({ repoRoot: REPO_ROOT, now });
  const summary = catalogSummary(snapshot);
  // index 形与 catalogSummary 同（无 detail/qualityChecks/dependencies/usage）。
  assert.deepEqual(index.version, summary.version);
  assert.equal(index.count, summary.count);
  assert.equal(index.capabilities.length, summary.capabilities.length);
  for (const sum of index.capabilities) {
    assert.equal(sum.detail, undefined, 'summary must not carry detail');
    assert.equal(sum.usage, undefined, 'summary must not carry usage');
    assert.equal(sum.qualityChecks, undefined, 'summary must not carry qualityChecks');
    assert.equal(sum.dependencies, undefined, 'summary must not carry dependencies');
  }
  // capabilities = 完整 publicEntry（含 detail/usage/qualityChecks/dependencies）。
  assert.ok(capabilities.length > 0, 'expected at least one released capability');
  for (const cap of capabilities) {
    assert.ok(typeof cap.detail === 'string', 'publicEntry must carry detail');
    assert.ok(cap.usage && typeof cap.usage === 'object', 'publicEntry must carry usage');
    assert.ok(cap.qualityChecks && typeof cap.qualityChecks === 'object');
    assert.ok(Array.isArray(cap.dependencies));
  }
});

// A1-U2: publishIndex 产出 index.json + capabilities/*.json，ajv schema 校验通过.
test('A1-U2 publishIndex writes index.json + capabilities/*.json, schema-valid', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-index-'));
  try {
    const r = await publishIndex({ repoRoot: REPO_ROOT, outDir: tmp });
    const indexPath = path.join(tmp, 'index.json');
    assert.ok(fs.existsSync(indexPath), 'index.json not produced');
    const indexJson = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    // ajv schema 校验通过.
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(loadSchema());
    assert.ok(validate(indexJson), `index.json schema invalid: ${JSON.stringify(validate.errors)}`);
    // capabilities/<id>.json 产出 + 校验（用 fullEntry 子 schema）.
    assert.equal(r.capabilityFiles.length, indexJson.capabilities.length);
    for (const cap of indexJson.capabilities) {
      const capPath = path.join(tmp, 'capabilities', `${cap.id}.json`);
      assert.ok(fs.existsSync(capPath), `capabilities/${cap.id}.json not produced`);
      const capJson = JSON.parse(fs.readFileSync(capPath, 'utf8'));
      assert.ok(validateCapability(capJson), `capabilities/${cap.id}.json schema invalid`);
      // 完整 publicEntry 含 detail/usage.
      assert.ok(typeof capJson.detail === 'string');
      assert.ok(capJson.usage && typeof capJson.usage === 'object');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// A1-U3: 无敏感字段泄露——index.json summary 不含 dir/owner/installHint/intakeScope.
test('A1-U3 index.json summary carries no sensitive internal fields', async () => {
  const { index, capabilities } = await buildIndex({ repoRoot: REPO_ROOT });
  const SENSITIVE = ['dir', 'owner', 'customer', 'intakeScope', 'installHint'];
  for (const sum of index.capabilities) {
    for (const f of SENSITIVE) {
      assert.equal(sum[f], undefined, `index summary leaked ${f}`);
    }
  }
  // capabilities/<id>.json (publicEntry) 也不含 dir/owner/customer/intakeScope.
  for (const cap of capabilities) {
    for (const f of ['dir', 'owner', 'customer', 'intakeScope']) {
      assert.equal(cap[f], undefined, `publicEntry leaked ${f}`);
    }
  }
});

// A1-U3b: validateIndex 拒绝损坏/投毒数据.
test('A1-U3b validateIndex rejects tampered/incomplete index', async () => {
  const good = (await buildIndex({ repoRoot: REPO_ROOT })).index;
  assert.ok(validateIndex(good), 'clean index should validate');
  const bad = JSON.parse(JSON.stringify(good));
  bad.capabilities[0].detail = 'should not be in summary'; // summary 无 detail 字段 → additionalProperties:false 拒绝
  assert.equal(validateIndex(bad), false, 'summary with detail must be rejected (additionalProperties:false)');
  const bad2 = JSON.parse(JSON.stringify(good));
  delete bad2.version;
  assert.equal(validateIndex(bad2), false, 'missing required field must be rejected');
  assert.equal(validateIndex({}), false, 'empty object must be rejected');
  // fullEntry 校验：缺 detail/usage 的"完整项"必须被拒绝.
  const badCap = JSON.parse(JSON.stringify(good.capabilities[0]));
  assert.equal(validateCapability(badCap), false, 'summary item must not pass fullEntry validation (missing detail/usage)');
});

// A1-C1: CLI argv spawn — node tools/index-publish.mjs（默认 outDir）.
test('A1-C1 CLI argv: node tools/index-publish.mjs produces index.json (default outDir)', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: 60000, cwd: REPO_ROOT });
  assert.equal(r.status, 0, `exit non-zero: ${r.stderr || ''}`);
  const dist = path.join(REPO_ROOT, 'web', 'catalog', 'dist');
  assert.ok(fs.existsSync(path.join(dist, 'index.json')), 'default dist/index.json missing');
  assert.ok(fs.existsSync(path.join(dist, 'capabilities')), 'default dist/capabilities/ missing');
});

// A1-C2: CLI argv spawn — --out-dir <tmp>.
test('A1-C2 CLI argv: --out-dir <tmp> writes to specified dir', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-index-cli-'));
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--out-dir', tmp], { encoding: 'utf8', timeout: 60000, cwd: REPO_ROOT });
    assert.equal(r.status, 0, `exit non-zero: ${r.stderr || ''}`);
    assert.ok(fs.existsSync(path.join(tmp, 'index.json')), 'index.json not in --out-dir');
    const idx = JSON.parse(fs.readFileSync(path.join(tmp, 'index.json'), 'utf8'));
    assert.ok(idx.capabilities.length > 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
